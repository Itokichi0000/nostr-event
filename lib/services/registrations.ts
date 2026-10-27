// 正式参加登録（DB が正本）。定員・承認・キャンセル待ちはイベント行の FOR UPDATE で直列化する。
// Nostr RSVP（31925）の accepted とここでの confirmed は別概念。
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nip19 } from "nostr-tools";
import { ApiError, errors } from "../api";
import type { SessionUser } from "../auth/session";
import { config } from "../config";
import { getDb, type Tx } from "../db/client";
import {
  accounts,
  checkins,
  events,
  externalRsvps,
  nostrEvents,
  registrations,
  revokedTickets,
  tickets,
  type EventRow,
  type Registration,
} from "../db/schema";
import { buildRsvp, matchesTemplate, type EventTemplate, type RsvpStatus } from "../nostr/nip52";
import { parseVerifiedEvent } from "../nostr/verify";
import { generateToken, hashToken, looksLikeToken, sha256Hex } from "../security/tokens";
import { registrationSchema } from "../validation";
import { createNotification, type NotificationType } from "./notifications";
import { enqueueJob } from "./outbox";

export type RegistrationStatus = Registration["status"];
const ACTIVE: RegistrationStatus[] = ["pending", "confirmed", "waitlisted"];
/** ゲストの通信再試行でチケットを再発行してよい期間 */
const IDEMPOTENT_REISSUE_MS = 15 * 60 * 1000;

export function ticketUrl(token: string): string {
  return `${config.appUrl}/ticket/${token}`;
}

export function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

async function lockEvent(tx: Tx, eventId: string): Promise<EventRow> {
  const [e] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
  if (!e) throw errors.notFound("イベント");
  return e;
}

async function confirmedCount(tx: Tx, eventId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "confirmed")));
  return r?.n ?? 0;
}

function hasSeat(e: EventRow, confirmed: number): boolean {
  return e.capacity === null || confirmed < e.capacity;
}

async function issueTicket(tx: Tx, registrationId: string): Promise<string> {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const [existing] = await tx.select().from(tickets).where(eq(tickets.registrationId, registrationId)).for("update");
  if (existing) {
    // 以前のQRは失効（「古いチケット」と判別できるよう記録）
    await tx.insert(revokedTickets).values({ tokenHash: existing.tokenHash, registrationId }).onConflictDoNothing();
    await tx.update(tickets).set({ tokenHash, createdAt: new Date(), revokedAt: null }).where(eq(tickets.id, existing.id));
  } else {
    await tx.insert(tickets).values({ registrationId, tokenHash });
  }
  return token;
}

function ownerNotificationType(status: RegistrationStatus): NotificationType {
  if (status === "pending") return "registration_pending";
  if (status === "waitlisted") return "registration_waitlisted";
  return "registration_confirmed";
}

export type RegisterResult = {
  registrationId: string;
  eventId: string;
  status: RegistrationStatus;
  /** 新規発行時のみ。一覧APIなどからは返さない */
  ticketUrl: string | null;
  alreadyRegistered: boolean;
};

function isRegistrationOpen(e: EventRow, now = new Date()): boolean {
  return e.status === "published" && now < e.startAt;
}

export async function register(eventId: string, input: unknown, actor: SessionUser | null): Promise<RegisterResult> {
  const body = registrationSchema.parse(input);
  if (body.mode === "nostr" && !actor) throw errors.unauthorized();

  return getDb().transaction(async (tx) => {
    const e = await lockEvent(tx, eventId);
    if (e.status === "draft" || e.status === "publishing") throw errors.notFound("イベント");
    if (e.status === "cancelled") throw errors.conflict("event_cancelled", "このイベントは中止になりました");
    if (!isRegistrationOpen(e)) throw errors.conflict("registration_closed", "申込受付は終了しました");
    if (body.mode === "guest" && !e.allowGuest) {
      throw errors.conflict("guest_not_allowed", "このイベントは Nostr アカウントでの申込のみ受け付けています");
    }

    // 1) 同じ idempotency key の再送 → 既存の申込を返す
    const [dup] = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, e.id), eq(registrations.idempotencyKey, body.idempotencyKey)))
      .for("update");
    if (dup) {
      const sameActor = body.mode === "nostr" ? dup.nostrPubkey === actor!.pubkey : dup.source === "app_guest";
      if (!sameActor) throw errors.conflict("idempotency_conflict", "リクエストが重複しています。ページを再読み込みしてください");
      const fresh = Date.now() - dup.createdAt.getTime() < IDEMPOTENT_REISSUE_MS;
      // 応答を受け取れなかった再送に限り、新しいチケットを発行（古いものは失効）
      const token = body.mode === "nostr" || fresh ? await issueTicket(tx, dup.id) : null;
      return {
        registrationId: dup.id,
        eventId: e.id,
        status: dup.status,
        ticketUrl: token ? ticketUrl(token) : null,
        alreadyRegistered: true,
      };
    }

    const confirmed = await confirmedCount(tx, e.id);
    const status: RegistrationStatus =
      e.approvalMode === "manual" ? "pending" : hasSeat(e, confirmed) ? "confirmed" : "waitlisted";
    const now = new Date();
    const timestamps = {
      confirmedAt: status === "confirmed" ? now : null,
      waitlistedAt: status === "waitlisted" ? now : null,
    };

    let reg: Registration;
    if (body.mode === "nostr") {
      const [existing] = await tx
        .select()
        .from(registrations)
        .where(and(eq(registrations.eventId, e.id), eq(registrations.nostrPubkey, actor!.pubkey)))
        .for("update");
      if (existing && ACTIVE.includes(existing.status)) {
        return { registrationId: existing.id, eventId: e.id, status: existing.status, ticketUrl: null, alreadyRegistered: true };
      }
      if (existing?.status === "rejected") {
        throw errors.conflict("rejected", "このイベントへの申込は主催者により承認されませんでした");
      }
      if (existing) {
        // キャンセル後の再申込は同じ行を再利用（(event_id, pubkey) 一意）
        [reg] = (await tx
          .update(registrations)
          .set({ status, ...timestamps, cancelledAt: null, idempotencyKey: body.idempotencyKey, updatedAt: now })
          .where(eq(registrations.id, existing.id))
          .returning()) as [Registration];
      } else {
        [reg] = (await tx
          .insert(registrations)
          .values({
            eventId: e.id,
            accountId: actor!.accountId,
            nostrPubkey: actor!.pubkey,
            source: "app_nostr",
            status,
            ...timestamps,
            idempotencyKey: body.idempotencyKey,
          })
          .returning()) as [Registration];
      }
    } else {
      [reg] = (await tx
        .insert(registrations)
        .values({
          eventId: e.id,
          guestName: body.displayName,
          guestEmail: body.email,
          source: "app_guest",
          status,
          ...timestamps,
          idempotencyKey: body.idempotencyKey,
        })
        .returning()) as [Registration];
    }

    const token = await issueTicket(tx, reg.id);
    await createNotification(tx, {
      recipientAccountId: e.ownerAccountId,
      type: ownerNotificationType(status),
      dedupeKey: `registration:${reg.id}:${status}:${now.getTime()}`,
      eventId: e.id,
      registrationId: reg.id,
      payload: { status },
    });
    return { registrationId: reg.id, eventId: e.id, status, ticketUrl: ticketUrl(token), alreadyRegistered: false };
  });
}

/** 空席の分だけキャンセル待ちを先着順に繰り上げる（呼び出し元でイベント行をロック済みであること） */
export async function promoteWaitlist(tx: Tx, e: EventRow): Promise<string[]> {
  if (e.status === "cancelled") return [];
  const confirmed = await confirmedCount(tx, e.id);
  const free = e.capacity === null ? 1000 : e.capacity - confirmed;
  if (free <= 0) return [];
  const waiting = await tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, e.id), eq(registrations.status, "waitlisted")))
    .orderBy(asc(registrations.waitlistedAt), asc(registrations.createdAt))
    .limit(free)
    .for("update");
  const now = new Date();
  for (const r of waiting) {
    await tx
      .update(registrations)
      .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
      .where(eq(registrations.id, r.id));
    await createNotification(tx, {
      recipientAccountId: e.ownerAccountId,
      type: "waitlist_promoted",
      dedupeKey: `promoted:${r.id}:${now.getTime()}`,
      eventId: e.id,
      registrationId: r.id,
    });
    if (r.accountId) {
      await createNotification(tx, {
        recipientAccountId: r.accountId,
        type: "my_registration_promoted",
        dedupeKey: `my_promoted:${r.id}:${now.getTime()}`,
        eventId: e.id,
        registrationId: r.id,
      });
    }
  }
  return waiting.map((r) => r.id);
}

type RegistrationAuth = { actor: SessionUser | null; ticketToken?: string | null };

async function findTicketRegistrationId(tx: Tx, token: string): Promise<string | null> {
  if (!looksLikeToken(token)) return null;
  const [t] = await tx
    .select({ registrationId: tickets.registrationId })
    .from(tickets)
    .where(eq(tickets.tokenHash, hashToken(token)))
    .limit(1);
  return t?.registrationId ?? null;
}

/** 本人確認: Nostr セッションの pubkey 一致、または有効なチケットトークン */
async function assertRegistrant(tx: Tx, reg: Registration, auth: RegistrationAuth): Promise<void> {
  if (auth.actor && reg.accountId && reg.accountId === auth.actor.accountId) return;
  if (auth.ticketToken && (await findTicketRegistrationId(tx, auth.ticketToken)) === reg.id) return;
  throw errors.forbidden();
}

export async function cancelRegistration(registrationId: string, auth: RegistrationAuth) {
  return getDb().transaction(async (tx) => {
    const [peek] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
    if (!peek) throw errors.notFound("申込");
    // ロック順序を統一（イベント → 申込）してデッドロックを避ける
    const e = await lockEvent(tx, peek.eventId);
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    await assertRegistrant(tx, reg!, auth);
    if (reg!.status === "cancelled") return { status: reg!.status, promoted: [] as string[] };
    if (reg!.status === "rejected") throw errors.conflict("rejected", "この申込は承認されませんでした");
    const [ci] = await tx.select().from(checkins).where(eq(checkins.registrationId, reg!.id)).limit(1);
    if (ci) throw errors.conflict("already_checked_in", "受付済みの申込は取り消せません");

    const now = new Date();
    await tx
      .update(registrations)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(registrations.id, reg!.id));
    await createNotification(tx, {
      recipientAccountId: e.ownerAccountId,
      type: "registration_cancelled",
      dedupeKey: `cancelled:${reg!.id}:${now.getTime()}`,
      eventId: e.id,
      registrationId: reg!.id,
    });
    const promoted = reg!.status === "confirmed" ? await promoteWaitlist(tx, e) : [];
    return { status: "cancelled" as const, promoted };
  });
}

export type OwnerAction = "approve" | "reject";

export async function decideRegistration(actor: SessionUser, registrationId: string, action: OwnerAction) {
  return getDb().transaction(async (tx) => {
    const [peek] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
    if (!peek) throw errors.notFound("申込");
    const e = await lockEvent(tx, peek.eventId);
    if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    const now = new Date();

    if (action === "approve") {
      if (reg!.status === "confirmed") return { status: reg!.status };
      if (reg!.status !== "pending" && reg!.status !== "waitlisted") {
        throw errors.conflict("invalid_transition", "この申込は承認できない状態です");
      }
      // 承認時に定員を再検証。満席ならキャンセル待ちへ
      const seat = hasSeat(e, await confirmedCount(tx, e.id));
      const status: RegistrationStatus = seat ? "confirmed" : "waitlisted";
      await tx
        .update(registrations)
        .set({
          status,
          confirmedAt: seat ? now : reg!.confirmedAt,
          waitlistedAt: seat ? reg!.waitlistedAt : (reg!.waitlistedAt ?? now),
          updatedAt: now,
        })
        .where(eq(registrations.id, reg!.id));
      if (reg!.accountId && seat) {
        await createNotification(tx, {
          recipientAccountId: reg!.accountId,
          type: "my_registration_approved",
          dedupeKey: `approved:${reg!.id}:${now.getTime()}`,
          eventId: e.id,
          registrationId: reg!.id,
        });
      }
      return { status };
    }

    if (reg!.status === "rejected") return { status: reg!.status };
    if (reg!.status === "cancelled") throw errors.conflict("invalid_transition", "キャンセル済みの申込です");
    const [ci] = await tx.select().from(checkins).where(eq(checkins.registrationId, reg!.id)).limit(1);
    if (ci) throw errors.conflict("already_checked_in", "受付済みの申込は却下できません");
    await tx.update(registrations).set({ status: "rejected", updatedAt: now }).where(eq(registrations.id, reg!.id));
    if (reg!.accountId) {
      await createNotification(tx, {
        recipientAccountId: reg!.accountId,
        type: "my_registration_rejected",
        dedupeKey: `rejected:${reg!.id}:${now.getTime()}`,
        eventId: e.id,
        registrationId: reg!.id,
      });
    }
    if (reg!.status === "confirmed") await promoteWaitlist(tx, e);
    return { status: "rejected" as const };
  });
}

export async function rotateTicket(registrationId: string, auth: RegistrationAuth): Promise<{ ticketUrl: string }> {
  return getDb().transaction(async (tx) => {
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    if (!reg) throw errors.notFound("申込");
    await assertRegistrant(tx, reg, auth);
    return { ticketUrl: ticketUrl(await issueTicket(tx, reg.id)) };
  });
}

// ---- 参加者一覧（主催者のみ） ----

export async function listRegistrationsForOwner(actor: SessionUser, eventId: string) {
  const db = getDb();
  const [e] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!e) throw errors.notFound("イベント");
  if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
  const rows = await db
    .select({
      id: registrations.id,
      source: registrations.source,
      status: registrations.status,
      guestName: registrations.guestName,
      guestEmail: registrations.guestEmail,
      nostrPubkey: registrations.nostrPubkey,
      accountName: accounts.displayName,
      publicRsvpStatus: registrations.publicRsvpStatus,
      createdAt: registrations.createdAt,
      checkedInAt: checkins.checkedInAt,
    })
    .from(registrations)
    .leftJoin(accounts, eq(accounts.id, registrations.accountId))
    .leftJoin(checkins, eq(checkins.registrationId, registrations.id))
    .where(eq(registrations.eventId, eventId))
    .orderBy(asc(registrations.createdAt));
  const externalRows = await db
    .select()
    .from(externalRsvps)
    .where(
      and(
        eq(externalRsvps.eventId, eventId),
        sql`not exists (select 1 from registrations r where r.event_id = ${externalRsvps.eventId} and r.nostr_pubkey = ${externalRsvps.attendeePubkey})`,
      ),
    )
    .orderBy(asc(externalRsvps.seenAt));
  return {
    registrations: rows.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      displayName: r.guestName ?? r.accountName ?? (r.nostrPubkey ? shortNpub(r.nostrPubkey) : "—"),
      email: r.guestEmail,
      npub: r.nostrPubkey ? nip19.npubEncode(r.nostrPubkey) : null,
      publicRsvp: r.publicRsvpStatus,
      createdAt: r.createdAt.toISOString(),
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
    })),
    externalRsvps: externalRows.map((x) => ({
      npub: nip19.npubEncode(x.attendeePubkey),
      displayName: shortNpub(x.attendeePubkey),
      intent: x.intent,
      seenAt: x.seenAt.toISOString(),
      // RSVP が古い版を参照している場合に表示
      refersToOldVersion: x.referencedEventId !== null && x.referencedEventId !== e.latestNostrEventId,
    })),
  };
}

export async function listMyRegistrations(actor: SessionUser) {
  const rows = await getDb()
    .select({
      id: registrations.id,
      status: registrations.status,
      createdAt: registrations.createdAt,
      eventId: events.id,
      slug: events.slug,
      title: events.title,
      startAt: events.startAt,
      endAt: events.endAt,
      timezone: events.timezone,
      isAllDay: events.isAllDay,
      eventStatus: events.status,
      location: events.location,
      checkedInAt: checkins.checkedInAt,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(checkins, eq(checkins.registrationId, registrations.id))
    .where(and(eq(registrations.accountId, actor.accountId), inArray(registrations.status, ["pending", "confirmed", "waitlisted"])))
    .orderBy(asc(events.startAt));
  // 秘密のチケットURLは返さない（表示時に rotate で再発行）
  return rows;
}

export async function getMyRegistrationForEvent(actor: SessionUser, eventId: string) {
  const [r] = await getDb()
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.accountId, actor.accountId)))
    .limit(1);
  return r ?? null;
}

// ---- チケット表示 ----

export type TicketView = {
  state: "valid" | "revoked" | "not_found";
  registration?: {
    id: string;
    status: RegistrationStatus;
    displayName: string;
    source: "app_nostr" | "app_guest";
    nostrPubkey: string | null;
    publicRsvpStatus: RsvpStatus | null;
    checkedInAt: string | null;
  };
  event?: EventRow;
};

export async function getTicketView(token: string): Promise<TicketView> {
  if (!looksLikeToken(token)) return { state: "not_found" };
  const db = getDb();
  const hash = hashToken(token);
  const [row] = await db
    .select({ reg: registrations, event: events, accountName: accounts.displayName, checkedInAt: checkins.checkedInAt })
    .from(tickets)
    .innerJoin(registrations, eq(registrations.id, tickets.registrationId))
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(accounts, eq(accounts.id, registrations.accountId))
    .leftJoin(checkins, eq(checkins.registrationId, registrations.id))
    .where(eq(tickets.tokenHash, hash))
    .limit(1);
  if (!row) {
    const [rev] = await db.select().from(revokedTickets).where(eq(revokedTickets.tokenHash, hash)).limit(1);
    return { state: rev ? "revoked" : "not_found" };
  }
  return {
    state: "valid",
    event: row.event,
    registration: {
      id: row.reg.id,
      status: row.reg.status,
      displayName: row.reg.guestName ?? row.accountName ?? (row.reg.nostrPubkey ? shortNpub(row.reg.nostrPubkey) : ""),
      source: row.reg.source,
      nostrPubkey: row.reg.nostrPubkey,
      publicRsvpStatus: row.reg.publicRsvpStatus,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
    },
  };
}

// ---- 公開RSVP（本人が明示的に選んだ場合のみ） ----

/** 申込IDから導出する安定した RSVP の d（申込IDそのものは公開しない） */
export function rsvpDFor(registrationId: string): string {
  return sha256Hex(`gather-rsvp:${registrationId}`).slice(0, 32);
}

function rsvpTemplate(e: EventRow, status: RsvpStatus, d: string, prevCreatedAt: number): EventTemplate {
  // 置換可能イベントは created_at が新しい方が残るので、前の版より必ず後にする
  const createdAt = Math.max(Math.floor(Date.now() / 1000), prevCreatedAt + 1);
  return buildRsvp(
    { coordinate: e.nostrCoordinate!, d, status, organizerPubkey: e.ownerPubkey, eventId: e.latestNostrEventId },
    createdAt,
  );
}

export async function publishRsvp(actor: SessionUser, registrationId: string, body: { status: RsvpStatus; signedEvent?: unknown }) {
  return getDb().transaction(async (tx) => {
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    if (!reg) throw errors.notFound("申込");
    if (reg.accountId !== actor.accountId || reg.nostrPubkey !== actor.pubkey) throw errors.forbidden();
    const [e] = await tx.select().from(events).where(eq(events.id, reg.eventId)).limit(1);
    if (!e || e.visibility !== "public_nostr" || !e.nostrCoordinate || !e.latestNostrEventId) {
      throw errors.conflict("not_public", "このイベントは Nostr に公開されていません");
    }
    if (body.status !== "declined" && !ACTIVE.includes(reg.status)) {
      throw errors.conflict("not_active", "有効な申込がありません");
    }
    // d は申込ごとに固定（署名前後・取消の declined でも同じ値を再利用する）
    const d = reg.publicRsvpD ?? rsvpDFor(reg.id);
    const [prev] = reg.publicRsvpEventId
      ? await tx.select({ createdAt: nostrEvents.createdAt }).from(nostrEvents).where(eq(nostrEvents.id, reg.publicRsvpEventId))
      : [];
    const prevCreatedAt = prev ? Math.floor(prev.createdAt.getTime() / 1000) : 0;
    const expected = rsvpTemplate(e, body.status, d, prevCreatedAt);
    if (!body.signedEvent) throw new ApiError(428, "signature_required", "Nostr の署名が必要です", { template: expected });
    const signed = parseVerifiedEvent(body.signedEvent);
    if (!signed) throw new ApiError(400, "invalid_signature", "署名を検証できませんでした");
    if (signed.pubkey !== reg.nostrPubkey) throw new ApiError(400, "wrong_signer", "申込したアカウントで署名してください");
    if (!matchesTemplate(signed, expected)) throw new ApiError(400, "template_mismatch", "署名内容が一致しません");
    if (signed.created_at <= prevCreatedAt || Math.abs(signed.created_at - Math.floor(Date.now() / 1000)) > 600) {
      throw new ApiError(400, "stale_signature", "署名の時刻が古すぎます");
    }
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
    await tx
      .update(registrations)
      .set({ publicRsvpD: d, publicRsvpEventId: signed.id, publicRsvpStatus: body.status, updatedAt: new Date() })
      .where(eq(registrations.id, reg.id));
    await enqueueJob(tx, {
      kind: "relay_publish",
      dedupeKey: `relay_publish:${signed.id}`,
      payload: { nostrEventId: signed.id, eventId: e.id, purpose: "rsvp" },
      maxAttempts: 8,
    });
    return { status: body.status, nostrEventId: signed.id };
  });
}
