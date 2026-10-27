// リレーから受信した Nostr イベントの取り込み（ワーカー用）。
// 署名検証 → nostr_events へ id 主キーで挿入（重複は無視）→ 種別ごとに反映。
// 別リレー由来の同一イベントや古い再送では、DB も通知も増えない。
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { events, externalRsvps, nostrEvents, registrations } from "../db/schema";
import {
  KIND_DATE_EVENT,
  KIND_RSVP,
  KIND_TIME_EVENT,
  coordinateOf,
  parseCalendarEvent,
  parseRsvp,
  type SignedEvent,
} from "../nostr/nip52";
import { parseVerifiedEvent } from "../nostr/verify";
import { applyExternalCalendarUpdate } from "./events";
import { createNotification } from "./notifications";

export type IngestResult = "invalid" | "duplicate" | "ignored" | "rsvp_linked" | "rsvp_external" | "rsvp_stale" | "calendar_updated";

export async function ingestNostrEvent(input: unknown): Promise<IngestResult> {
  const ev = parseVerifiedEvent(input);
  if (!ev) return "invalid";
  if (ev.kind === KIND_RSVP) return ingestRsvp(ev);
  if (ev.kind === KIND_DATE_EVENT || ev.kind === KIND_TIME_EVENT) return ingestCalendar(ev);
  return "ignored";
}

async function insertRaw(ev: SignedEvent, coordinate: string): Promise<boolean> {
  const rows = await getDb()
    .insert(nostrEvents)
    .values({ id: ev.id, kind: ev.kind, pubkey: ev.pubkey, createdAt: new Date(ev.created_at * 1000), raw: ev, coordinate })
    .onConflictDoNothing()
    .returning({ id: nostrEvents.id });
  return rows.length > 0;
}

async function ingestRsvp(ev: SignedEvent): Promise<IngestResult> {
  const rsvp = parseRsvp(ev);
  if (!rsvp) return "invalid";
  const [target] = await getDb().select().from(events).where(eq(events.nostrCoordinate, rsvp.coordinate)).limit(1);
  if (!target) return "ignored";
  if (!(await insertRaw(ev, rsvp.coordinate))) return "duplicate";

  return getDb().transaction(async (tx) => {
    // このアプリで申込済みの本人 → 公開RSVPと連携済みとして扱い、人数は足さない
    const [reg] = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, target.id), eq(registrations.nostrPubkey, rsvp.pubkey)))
      .for("update");
    if (reg) {
      if (reg.publicRsvpEventId !== ev.id) {
        await tx
          .update(registrations)
          .set({ publicRsvpStatus: rsvp.status, publicRsvpEventId: ev.id, publicRsvpD: reg.publicRsvpD ?? rsvp.d })
          .where(eq(registrations.id, reg.id));
      }
      return "rsvp_linked";
    }

    const [prev] = await tx
      .select()
      .from(externalRsvps)
      .where(and(eq(externalRsvps.eventId, target.id), eq(externalRsvps.attendeePubkey, rsvp.pubkey)))
      .for("update");
    // (イベント, 参加者) ごとに最新の意思表示だけ保持。別 d でも同一人物として集約
    if (prev && (prev.latestCreatedAt > ev.created_at || (prev.latestCreatedAt === ev.created_at && prev.latestEventId <= ev.id))) {
      return "rsvp_stale";
    }
    const values = {
      eventId: target.id,
      attendeePubkey: rsvp.pubkey,
      rsvpD: rsvp.d,
      latestEventId: ev.id,
      intent: rsvp.status,
      referencedEventId: rsvp.eventId,
      latestCreatedAt: ev.created_at,
      seenAt: new Date(),
    };
    if (prev) await tx.update(externalRsvps).set(values).where(eq(externalRsvps.id, prev.id));
    else await tx.insert(externalRsvps).values(values);

    // 意思表示が変わったときだけ通知（定員は消費しない・自動確定しない）
    if (rsvp.status !== "declined" && prev?.intent !== rsvp.status) {
      await createNotification(tx, {
        recipientAccountId: target.ownerAccountId,
        type: "external_rsvp",
        dedupeKey: `external_rsvp:${ev.id}`,
        eventId: target.id,
        payload: { intent: rsvp.status },
      });
    }
    return "rsvp_external";
  });
}

async function ingestCalendar(ev: SignedEvent): Promise<IngestResult> {
  const parsed = parseCalendarEvent(ev);
  if (!parsed) return "invalid";
  const coordinate = coordinateOf(ev.kind, ev.pubkey, parsed.d);
  const [target] = await getDb().select().from(events).where(eq(events.nostrCoordinate, coordinate)).limit(1);
  // 署名者 = 座標の pubkey なので、本人による更新のみ反映される
  if (!target || target.ownerPubkey !== ev.pubkey) return "ignored";
  if (!(await insertRaw(ev, coordinate))) return "duplicate";
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(events).where(eq(events.id, target.id)).for("update");
    const applied = await applyExternalCalendarUpdate(tx, locked!, ev, parsed);
    return applied ? "calendar_updated" : "ignored";
  });
}
