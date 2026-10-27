import { and, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { errors } from "../api";
import type { SessionUser } from "../auth/session";
import { getDb } from "../db/client";
import { accounts, checkins, events, registrations, revokedTickets, tickets, type EventRow } from "../db/schema";
import { hashToken, looksLikeToken } from "../security/tokens";
import { createNotification } from "./notifications";
import { shortNpub } from "./registrations";

export type CheckinResult =
  | { result: "ok"; registrationId: string; displayName: string; checkedInAt: string }
  | { result: "already"; registrationId: string; displayName: string; checkedInAt: string }
  | { result: "invalid"; reason: "unknown_ticket" | "other_event" | "revoked_ticket" }
  | { result: "not_confirmed"; registrationId: string; displayName: string; status: string }
  | { result: "outside_window"; opensAt: string; closesAt: string }
  | { result: "event_cancelled" };

const TWO_HOURS = 2 * 60 * 60 * 1000;

export function checkinWindow(e: Pick<EventRow, "startAt" | "endAt" | "checkinOpenAt" | "checkinCloseAt">) {
  return {
    opensAt: e.checkinOpenAt ?? new Date(e.startAt.getTime() - TWO_HOURS),
    closesAt: e.checkinCloseAt ?? new Date(e.endAt.getTime() + TWO_HOURS),
  };
}

export const checkinInputSchema = z.union([
  z.object({ token: z.string().min(1).max(2048) }),
  z.object({ registrationId: z.uuid() }),
]);

/** QR の内容（チケットURL or トークン）からトークンを取り出す */
export function extractToken(scanned: string): string | null {
  const s = scanned.trim();
  if (looksLikeToken(s)) return s;
  try {
    const u = new URL(s);
    const m = /\/ticket\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    return m && looksLikeToken(m[1]!) ? m[1]! : null;
  } catch {
    return null;
  }
}

/**
 * 受付（主催者のみ）。checkins.registration_id の UNIQUE で原子的に1回だけ記録する。
 * 2回目以降は「受付済み」を返し、件数も通知も増えない。
 */
export async function checkIn(actor: SessionUser, eventId: string, input: unknown): Promise<CheckinResult> {
  const body = checkinInputSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!e) throw errors.notFound("イベント");
    if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
    if (e.status === "cancelled") return { result: "event_cancelled" };

    let registrationId: string | null = null;
    const method = "token" in body ? "qr" : "manual";
    if ("token" in body) {
      const token = extractToken(body.token);
      if (!token) return { result: "invalid", reason: "unknown_ticket" };
      const hash = hashToken(token);
      const [t] = await tx.select().from(tickets).where(eq(tickets.tokenHash, hash)).limit(1);
      if (!t) {
        const [rev] = await tx.select().from(revokedTickets).where(eq(revokedTickets.tokenHash, hash)).limit(1);
        return { result: "invalid", reason: rev ? "revoked_ticket" : "unknown_ticket" };
      }
      registrationId = t.registrationId;
    } else {
      registrationId = body.registrationId;
    }

    const [reg] = await tx
      .select({ r: registrations, accountName: accounts.displayName })
      .from(registrations)
      .leftJoin(accounts, eq(accounts.id, registrations.accountId))
      .where(eq(registrations.id, registrationId))
      .limit(1);
    if (!reg) return { result: "invalid", reason: "unknown_ticket" };
    // 別イベントのQRは無効（存在の有無も漏らさない）
    if (reg.r.eventId !== e.id) return { result: "invalid", reason: "other_event" };
    const displayName = reg.r.guestName ?? reg.accountName ?? (reg.r.nostrPubkey ? shortNpub(reg.r.nostrPubkey) : "");

    const [existing] = await tx.select().from(checkins).where(eq(checkins.registrationId, reg.r.id)).limit(1);
    if (existing) {
      return { result: "already", registrationId: reg.r.id, displayName, checkedInAt: existing.checkedInAt.toISOString() };
    }
    if (reg.r.status !== "confirmed") {
      return { result: "not_confirmed", registrationId: reg.r.id, displayName, status: reg.r.status };
    }
    const { opensAt, closesAt } = checkinWindow(e);
    const now = new Date();
    if (now < opensAt || now > closesAt) {
      return { result: "outside_window", opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() };
    }

    const inserted = await tx
      .insert(checkins)
      .values({ eventId: e.id, registrationId: reg.r.id, operatorAccountId: actor.accountId, method })
      .onConflictDoNothing({ target: checkins.registrationId })
      .returning();
    const row = inserted[0];
    if (!row) {
      // 同時スキャンで先を越された
      const [again] = await tx.select().from(checkins).where(eq(checkins.registrationId, reg.r.id)).limit(1);
      return { result: "already", registrationId: reg.r.id, displayName, checkedInAt: again!.checkedInAt.toISOString() };
    }
    await createNotification(tx, {
      recipientAccountId: e.ownerAccountId,
      type: "checkin_created",
      dedupeKey: `checkin:${row.id}`,
      eventId: e.id,
      registrationId: reg.r.id,
    });
    return { result: "ok", registrationId: reg.r.id, displayName, checkedInAt: row.checkedInAt.toISOString() };
  });
}

/** 受付画面の名前検索（確定者のみ） */
export async function searchAttendees(actor: SessionUser, eventId: string, q: string) {
  const db = getDb();
  const [e] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!e) throw errors.notFound("イベント");
  if (e.ownerAccountId !== actor.accountId) throw errors.forbidden();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%`;
  const rows = await db
    .select({
      id: registrations.id,
      guestName: registrations.guestName,
      accountName: accounts.displayName,
      nostrPubkey: registrations.nostrPubkey,
      status: registrations.status,
      checkedInAt: checkins.checkedInAt,
    })
    .from(registrations)
    .leftJoin(accounts, eq(accounts.id, registrations.accountId))
    .leftJoin(checkins, eq(checkins.registrationId, registrations.id))
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "confirmed"),
        q ? or(ilike(registrations.guestName, like), ilike(accounts.displayName, like)) : undefined,
      ),
    )
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    displayName: r.guestName ?? r.accountName ?? (r.nostrPubkey ? shortNpub(r.nostrPubkey) : ""),
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
  }));
}
