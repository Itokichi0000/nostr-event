import { and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { nip19 } from "nostr-tools";
import { ApiError, errors } from "../api";
import type { SessionUser } from "../auth/session";
import { config } from "../config";
import { getDb, type DbOrTx, type Tx } from "../db/client";
import { accounts, checkins, events, externalRsvps, nostrEvents, registrations, type EventRow } from "../db/schema";
import {
  allDayRange,
  buildCalendarEvent,
  calendarKind,
  coordinateOf,
  matchesTemplate,
  randomId,
  type EventTemplate,
  type SignedEvent,
} from "../nostr/nip52";
import { parseVerifiedEvent } from "../nostr/verify";
import { generateToken } from "../security/tokens";
import { utcToZoned } from "../time";
import { eventFormSchema, toRange, type EventForm } from "../validation";
import { createNotification } from "./notifications";
import { enqueueJob } from "./outbox";
import { promoteWaitlist } from "./registrations";

export class SignatureRequired extends ApiError {
  constructor(template: EventTemplate) {
    super(428, "signature_required", "Nostr の署名が必要です", { template });
  }
}

function eventToCalendarInput(e: EventRow) {
  return {
    d: e.nostrD!,
    title: e.title,
    summary: e.summary,
    description: e.description,
    imageUrl: e.imageUrl,
    location: e.location,
    hashtags: e.tags,
    startAt: e.startAt,
    endAt: e.endAt,
    timezone: e.timezone,
    isAllDay: e.isAllDay,
    cancelled: e.status === "cancelled",
  };
}

/** DB の内容から署名用の雛形を作る（created_at は直前の版より必ず新しくする） */
export function templateForEvent(e: EventRow, override?: Partial<EventRow>): EventTemplate {
  const merged = { ...e, ...override };
  const now = Math.floor(Date.now() / 1000);
  const createdAt = Math.max(now, (e.latestNostrCreatedAt ?? 0) + 1);
  return buildCalendarEvent(eventToCalendarInput(merged), createdAt);
}

function verifySignedForEvent(e: EventRow, signedInput: unknown, expected: EventTemplate): SignedEvent {
  const signed = parseVerifiedEvent(signedInput);
  if (!signed) throw new ApiError(400, "invalid_signature", "署名を検証できませんでした");
  if (signed.pubkey !== e.ownerPubkey) throw new ApiError(400, "wrong_signer", "主催者本人の鍵で署名してください");
  if (!matchesTemplate(signed, expected)) throw new ApiError(400, "template_mismatch", "署名内容がイベント情報と一致しません。もう一度お試しください");
  const now = Math.floor(Date.now() / 1000);
  if (signed.created_at <= (e.latestNostrCreatedAt ?? 0)) throw new ApiError(400, "stale_signature", "古い署名です。もう一度お試しください");
  if (signed.created_at > now + 600) throw new ApiError(400, "future_signature", "端末の時刻を確認してください");
  return signed;
}

async function storeSignedAndEnqueue(tx: Tx, e: EventRow, signed: SignedEvent): Promise<void> {
  await tx
    .insert(nostrEvents)
    .values({
      id: signed.id,
      kind: signed.kind,
      pubkey: signed.pubkey,
      createdAt: new Date(signed.created_at * 1000),
      raw: signed,
      coordinate: e.nostrCoordinate,
    })
    .onConflictDoNothing();
  await enqueueJob(tx, {
    kind: "relay_publish",
    dedupeKey: `relay_publish:${signed.id}`,
    payload: { nostrEventId: signed.id, eventId: e.id, purpose: "calendar" },
    maxAttempts: 8,
  });
}

async function lockOwnedEvent(tx: Tx, actor: SessionUser, id: string): Promise<EventRow> {
  const [e] = await tx.select().from(events).where(eq(events.id, id)).for("update");
  if (!e) throw errors.notFound("イベント");
  if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
  return e;
}

function formToColumns(f: EventForm) {
  const { startAt, endAt } = toRange(f);
  return {
    title: f.title,
    summary: f.summary,
    description: f.description,
    imageUrl: f.imageUrl,
    location: f.location,
    tags: f.hashtags,
    startAt,
    endAt,
    timezone: f.timezone,
    isAllDay: f.isAllDay,
    capacity: f.capacity,
    approvalMode: f.approvalMode,
    allowGuest: f.allowGuest,
  };
}

function assertImageUrl(url: string | null) {
  if (!url) return;
  const u = new URL(url);
  if (u.protocol !== "https:" && u.origin !== config.appOrigin) {
    throw errors.invalid("画像URLは https:// で始まる必要があります");
  }
}

export async function createEvent(actor: SessionUser, input: unknown) {
  const form = eventFormSchema.parse(input);
  assertImageUrl(form.imageUrl);
  const cols = formToColumns(form);
  const isPublic = form.visibility === "public_nostr";
  const kind = calendarKind(form.isAllDay);
  const d = randomId(12);
  const [row] = await getDb()
    .insert(events)
    .values({
      ...cols,
      // 公開イベントは短めの推測しにくいID、限定リンクは十分長いランダム値
      slug: isPublic ? generateToken(8) : generateToken(16),
      ownerAccountId: actor.accountId,
      ownerPubkey: actor.pubkey,
      visibility: form.visibility,
      status: isPublic ? "draft" : "published",
      nostrKind: isPublic ? kind : null,
      nostrD: isPublic ? d : null,
      nostrCoordinate: isPublic ? coordinateOf(kind, actor.pubkey, d) : null,
    })
    .returning();
  return { event: row!, template: isPublic ? templateForEvent(row!) : null };
}

/** ドラフトの公開（署名済み NIP-52 を受け取る）。署名がなければ 428 + 雛形を返す */
export async function publishEvent(actor: SessionUser, id: string, signedInput: unknown) {
  return getDb().transaction(async (tx) => {
    const e = await lockOwnedEvent(tx, actor, id);
    if (e.visibility !== "public_nostr") throw errors.invalid("限定リンクのイベントは Nostr に公開できません");
    if (e.status === "cancelled") throw errors.conflict("cancelled", "キャンセル済みのイベントです");
    if (e.status !== "draft" && e.nostrPublishState !== "failed") {
      throw errors.conflict("already_published", "既に公開処理済みです");
    }
    const expected = templateForEvent(e);
    if (!signedInput) throw new SignatureRequired(expected);
    const signed = verifySignedForEvent(e, signedInput, expected);
    const [updated] = await tx
      .update(events)
      .set({
        status: "publishing",
        latestNostrEventId: signed.id,
        latestNostrCreatedAt: signed.created_at,
        nostrPublishState: "pending",
        updatedAt: new Date(),
      })
      .where(eq(events.id, e.id))
      .returning();
    await storeSignedAndEnqueue(tx, e, signed);
    return updated!;
  });
}

/** リレー公開の再試行（署名済みイベントをそのまま再配信） */
export async function retryPublish(actor: SessionUser, id: string) {
  return getDb().transaction(async (tx) => {
    const e = await lockOwnedEvent(tx, actor, id);
    if (!e.latestNostrEventId) throw errors.conflict("not_signed", "まだ署名されていません");
    await tx.update(events).set({ nostrPublishState: "pending" }).where(eq(events.id, e.id));
    await enqueueJob(tx, {
      kind: "relay_publish",
      dedupeKey: `relay_publish:${e.latestNostrEventId}:retry:${Date.now()}`,
      payload: { nostrEventId: e.latestNostrEventId, eventId: e.id, purpose: "calendar", resetFailed: true },
      maxAttempts: 8,
    });
    return { ok: true };
  });
}

const NOSTR_FIELDS = ["title", "summary", "description", "imageUrl", "location", "tags", "startAt", "endAt", "timezone", "isAllDay"] as const;

function publicFieldsChanged(e: EventRow, cols: ReturnType<typeof formToColumns>): boolean {
  return NOSTR_FIELDS.some((k) => {
    const a = e[k];
    const b = cols[k];
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) return a.join("\u0000") !== b.join("\u0000");
    return a !== b;
  });
}

export async function updateEvent(actor: SessionUser, id: string, input: unknown, signedInput: unknown) {
  const form = eventFormSchema.parse(input);
  assertImageUrl(form.imageUrl);
  const cols = formToColumns(form);
  return getDb().transaction(async (tx) => {
    const e = await lockOwnedEvent(tx, actor, id);
    if (e.status === "cancelled") throw errors.conflict("cancelled", "キャンセル済みのイベントは編集できません");
    if (form.visibility !== e.visibility) {
      throw errors.conflict("visibility_locked", "公開範囲は作成後に変更できません（Nostr 上の公開は取り消せないため）");
    }
    if (e.isAllDay !== cols.isAllDay && e.visibility === "public_nostr" && e.status !== "draft") {
      throw errors.conflict("kind_locked", "公開後に「終日」と「時刻指定」は切り替えられません");
    }
    if (cols.capacity !== null && cols.capacity !== e.capacity) {
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(registrations)
        .where(and(eq(registrations.eventId, e.id), eq(registrations.status, "confirmed")));
      if ((c?.n ?? 0) > cols.capacity) {
        throw errors.conflict("capacity_below_confirmed", `参加確定者（${c?.n}人）より少ない定員にはできません`);
      }
    }

    const needsSignature = e.visibility === "public_nostr" && e.status !== "draft" && publicFieldsChanged(e, cols);
    let nostrUpdate: Partial<EventRow> = {};
    if (needsSignature) {
      const expected = templateForEvent(e, cols);
      if (!signedInput) throw new SignatureRequired(expected);
      const signed = verifySignedForEvent(e, signedInput, expected);
      await storeSignedAndEnqueue(tx, e, signed);
      nostrUpdate = { latestNostrEventId: signed.id, latestNostrCreatedAt: signed.created_at, nostrPublishState: "pending" };
    }
    // 下書き中の終日切替は kind が変わるので座標を作り直す
    const kindUpdate: Partial<EventRow> = {};
    if (e.visibility === "public_nostr" && e.status === "draft" && e.isAllDay !== cols.isAllDay) {
      const kind = calendarKind(cols.isAllDay);
      kindUpdate.nostrKind = kind;
      kindUpdate.nostrCoordinate = coordinateOf(kind, e.ownerPubkey, e.nostrD!);
    }
    const [updated] = await tx
      .update(events)
      .set({ ...cols, ...nostrUpdate, ...kindUpdate, updatedAt: new Date() })
      .where(eq(events.id, e.id))
      .returning();
    if (cols.capacity === null || (e.capacity !== null && cols.capacity > e.capacity)) {
      await promoteWaitlist(tx, updated!);
    }
    return updated!;
  });
}

export async function cancelEvent(actor: SessionUser, id: string, opts: { signedEvent?: unknown; skipNostr?: boolean }) {
  return getDb().transaction(async (tx) => {
    const e = await lockOwnedEvent(tx, actor, id);
    if (e.status === "cancelled") return e;
    let nostrUpdate: Partial<EventRow> = {};
    const published = e.visibility === "public_nostr" && e.latestNostrEventId !== null;
    if (published && !opts.skipNostr) {
      const expected = templateForEvent(e, { status: "cancelled" });
      if (!opts.signedEvent) throw new SignatureRequired(expected);
      const signed = verifySignedForEvent(e, opts.signedEvent, expected);
      await storeSignedAndEnqueue(tx, e, signed);
      nostrUpdate = { latestNostrEventId: signed.id, latestNostrCreatedAt: signed.created_at, nostrPublishState: "pending" };
    }
    const now = new Date();
    const [updated] = await tx
      .update(events)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now, ...nostrUpdate })
      .where(eq(events.id, e.id))
      .returning();
    // Nostr ログインの参加者へ通知（ゲストはチケット画面に表示）
    const regs = await tx
      .select({ id: registrations.id, accountId: registrations.accountId })
      .from(registrations)
      .where(and(eq(registrations.eventId, e.id), inArray(registrations.status, ["pending", "confirmed", "waitlisted"])));
    for (const r of regs) {
      if (!r.accountId) continue;
      await createNotification(tx, {
        recipientAccountId: r.accountId,
        type: "event_cancelled",
        dedupeKey: `event_cancelled:${e.id}:${r.id}`,
        eventId: e.id,
        registrationId: r.id,
      });
    }
    return updated!;
  });
}

// ---- 読み取り ----

export type EventStats = {
  confirmed: number;
  pending: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
  checkedIn: number;
  externalRsvps: number;
};

export async function eventStats(db: DbOrTx, eventId: string): Promise<EventStats> {
  const counts = await db
    .select({ status: registrations.status, n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(eq(registrations.eventId, eventId))
    .groupBy(registrations.status);
  const by = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>;
  const [ci] = await db.select({ n: sql<number>`count(*)::int` }).from(checkins).where(eq(checkins.eventId, eventId));
  // アプリ申込と同じ pubkey の外部RSVPは重複カウントしない
  const [ext] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(externalRsvps)
    .where(
      and(
        eq(externalRsvps.eventId, eventId),
        inArray(externalRsvps.intent, ["accepted", "tentative"]),
        sql`not exists (select 1 from registrations r where r.event_id = ${externalRsvps.eventId} and r.nostr_pubkey = ${externalRsvps.attendeePubkey})`,
      ),
    );
  return {
    confirmed: by.confirmed ?? 0,
    pending: by.pending ?? 0,
    waitlisted: by.waitlisted ?? 0,
    cancelled: by.cancelled ?? 0,
    rejected: by.rejected ?? 0,
    checkedIn: ci?.n ?? 0,
    externalRsvps: ext?.n ?? 0,
  };
}

export async function getEventBySlug(slug: string) {
  const [row] = await getDb()
    .select({ event: events, ownerName: accounts.displayName, ownerPicture: accounts.picture })
    .from(events)
    .innerJoin(accounts, eq(accounts.id, events.ownerAccountId))
    .where(eq(events.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getEventByCoordinate(kind: number, pubkey: string, d: string) {
  const [row] = await getDb()
    .select()
    .from(events)
    .where(and(eq(events.nostrKind, kind), eq(events.ownerPubkey, pubkey), eq(events.nostrD, d)))
    .limit(1);
  return row ?? null;
}

export async function getOwnedEvent(actor: SessionUser, id: string): Promise<EventRow> {
  const [e] = await getDb().select().from(events).where(eq(events.id, id)).limit(1);
  if (!e) throw errors.notFound("イベント");
  if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
  return e;
}

/** 公開ページに出してよいイベントか（下書き・公開処理中は主催者のみ） */
export function isPubliclyVisible(e: EventRow): boolean {
  return e.status === "published" || e.status === "cancelled" || e.status === "ended";
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type ListFilter = "upcoming" | "week" | "past";

export async function listPublicEvents(opts: { q?: string; tag?: string; filter?: ListFilter; limit?: number }) {
  const now = new Date();
  const conds: SQL[] = [eq(events.visibility, "public_nostr"), inArray(events.status, ["published", "cancelled", "ended"])];
  const filter = opts.filter ?? "upcoming";
  if (filter === "past") conds.push(lte(events.endAt, now));
  else conds.push(gt(events.endAt, now));
  if (filter === "week") conds.push(lte(events.startAt, new Date(now.getTime() + 7 * 86400 * 1000)));
  if (opts.q) {
    const like = `%${escapeLike(opts.q.slice(0, 100))}%`;
    conds.push(or(ilike(events.title, like), ilike(events.summary, like), ilike(events.location, like), ilike(events.description, like))!);
  }
  if (opts.tag) conds.push(sql`${events.tags} ? ${opts.tag.toLowerCase()}`);
  const rows = await getDb()
    .select({
      event: events,
      ownerName: accounts.displayName,
      confirmed: sql<number>`(select count(*)::int from registrations r where r.event_id = ${events.id} and r.status = 'confirmed')`,
    })
    .from(events)
    .innerJoin(accounts, eq(accounts.id, events.ownerAccountId))
    .where(and(...conds))
    .orderBy(filter === "past" ? desc(events.startAt) : asc(events.startAt))
    .limit(Math.min(opts.limit ?? 50, 100));
  return rows;
}

export async function listOwnedEvents(accountId: string) {
  return getDb()
    .select({
      event: events,
      confirmed: sql<number>`(select count(*)::int from registrations r where r.event_id = ${events.id} and r.status = 'confirmed')`,
      pending: sql<number>`(select count(*)::int from registrations r where r.event_id = ${events.id} and r.status = 'pending')`,
      checkedIn: sql<number>`(select count(*)::int from checkins c where c.event_id = ${events.id})`,
    })
    .from(events)
    .where(eq(events.ownerAccountId, accountId))
    .orderBy(desc(events.startAt));
}

export function naddrFor(e: Pick<EventRow, "nostrKind" | "ownerPubkey" | "nostrD">, relays: string[] = []): string | null {
  if (e.nostrKind === null || e.nostrD === null) return null;
  return nip19.naddrEncode({
    kind: e.nostrKind,
    pubkey: e.ownerPubkey,
    identifier: e.nostrD,
    relays: relays.filter((r) => r.startsWith("wss://")).slice(0, 2),
  });
}

/** 編集フォーム用に DB の値をフォーム値へ戻す */
export function eventToForm(e: EventRow) {
  const s = utcToZoned(e.startAt, e.timezone);
  const endInstant = e.isAllDay ? new Date(e.endAt.getTime() - 1) : e.endAt;
  const en = utcToZoned(endInstant, e.timezone);
  return {
    title: e.title,
    summary: e.summary ?? "",
    description: e.description,
    imageUrl: e.imageUrl ?? "",
    location: e.location ?? "",
    hashtags: e.tags,
    isAllDay: e.isAllDay,
    startDate: s.date,
    startTime: e.isAllDay ? "19:00" : s.time,
    endDate: en.date,
    endTime: e.isAllDay ? "21:00" : en.time,
    timezone: e.timezone,
    capacity: e.capacity,
    approvalMode: e.approvalMode,
    allowGuest: e.allowGuest,
    visibility: e.visibility,
  };
}

/** 外部クライアントで同じ座標が更新された場合の反映（アプリ固有設定は上書きしない） */
export async function applyExternalCalendarUpdate(
  tx: Tx,
  e: EventRow,
  signed: SignedEvent,
  parsed: {
    title: string;
    summary: string | null;
    description: string;
    imageUrl: string | null;
    location: string | null;
    hashtags: string[];
    startAt: Date;
    endAt: Date;
    timezone: string | null;
    isAllDay: boolean;
  },
): Promise<boolean> {
  if (signed.created_at <= (e.latestNostrCreatedAt ?? 0)) return false;
  let { startAt, endAt } = parsed;
  if (parsed.isAllDay) {
    // 日付ベースは UTC 0:00 で解析されるので、イベントのタイムゾーンへ置き直す
    const s = startAt.toISOString().slice(0, 10);
    const last = new Date(endAt.getTime() - 86400 * 1000).toISOString().slice(0, 10);
    ({ startAt, endAt } = allDayRange(s, last < s ? s : last, e.timezone));
  }
  await tx
    .update(events)
    .set({
      title: parsed.title.slice(0, 120),
      summary: parsed.summary?.slice(0, 280) ?? null,
      description: parsed.description.slice(0, 20000),
      imageUrl: parsed.imageUrl,
      location: parsed.location?.slice(0, 300) ?? null,
      tags: parsed.hashtags.slice(0, 10),
      startAt,
      endAt: endAt < startAt ? startAt : endAt,
      timezone: parsed.isAllDay ? e.timezone : (parsed.timezone ?? e.timezone),
      latestNostrEventId: signed.id,
      latestNostrCreatedAt: signed.created_at,
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, e.id), or(isNull(events.latestNostrCreatedAt), sql`${events.latestNostrCreatedAt} < ${signed.created_at}`)));
  return true;
}
