import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { getDb } from "../db/client";
import { events, notifications } from "../db/schema";
import { enqueueJob } from "./outbox";

export type NotificationType =
  | "registration_confirmed"
  | "registration_pending"
  | "registration_waitlisted"
  | "registration_cancelled"
  | "waitlist_promoted"
  | "checkin_created"
  | "external_rsvp"
  | "publish_failed"
  | "event_cancelled"
  | "my_registration_approved"
  | "my_registration_rejected"
  | "my_registration_promoted"
  | "test";

// Web Push を送る種別（リレー公開失敗は通常プッシュしない）
const PUSH_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "registration_confirmed",
  "registration_pending",
  "registration_waitlisted",
  "registration_cancelled",
  "waitlist_promoted",
  "checkin_created",
  "external_rsvp",
  "event_cancelled",
  "my_registration_approved",
  "my_registration_rejected",
  "my_registration_promoted",
  "test",
]);

export type CreateNotificationInput = {
  recipientAccountId: string;
  type: NotificationType;
  dedupeKey: string;
  eventId?: string | null;
  registrationId?: string | null;
  /** 最小限の情報のみ（ゲストのメール・チケットは入れない） */
  payload?: Record<string, unknown>;
};

/**
 * 通知レコードと Push 配送ジョブを同一トランザクションで作る。
 * dedupe_key の UNIQUE 制約で、再試行・リレー再受信・二重スキャンでも1件だけになる。
 */
export async function createNotification(tx: DbOrTx, input: CreateNotificationInput): Promise<string | null> {
  const rows = await tx
    .insert(notifications)
    .values({
      recipientAccountId: input.recipientAccountId,
      type: input.type,
      dedupeKey: input.dedupeKey,
      eventId: input.eventId ?? null,
      registrationId: input.registrationId ?? null,
      payload: input.payload ?? {},
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  const id = rows[0]?.id ?? null;
  if (id && PUSH_TYPES.has(input.type)) {
    await enqueueJob(tx, { kind: "push", dedupeKey: `push:${id}`, payload: { notificationId: id }, maxAttempts: 8 });
  }
  return id;
}

export type NotificationItem = {
  id: string;
  type: string;
  eventId: string | null;
  eventTitle: string | null;
  registrationId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(accountId: string, opts: { cursor?: string | null; limit?: number }) {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  let cursorCond;
  if (opts.cursor) {
    const [ts, id] = Buffer.from(opts.cursor, "base64url").toString().split("|");
    if (ts && id) {
      const d = new Date(ts);
      cursorCond = or(lt(notifications.createdAt, d), and(eq(notifications.createdAt, d), lt(notifications.id, id)));
    }
  }
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      eventId: notifications.eventId,
      eventTitle: events.title,
      registrationId: notifications.registrationId,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(events, eq(events.id, notifications.eventId))
    .where(and(eq(notifications.recipientAccountId, accountId), cursorCond))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null;
  const items: NotificationItem[] = page.map((r) => ({
    ...r,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, nextCursor, unreadCount: await unreadCount(accountId) };
}

export async function unreadCount(accountId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientAccountId, accountId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markRead(accountId: string, ids: string[] | "all"): Promise<number> {
  const db = getDb();
  const base = and(eq(notifications.recipientAccountId, accountId), isNull(notifications.readAt));
  const where = ids === "all" ? base : and(base, inArray(notifications.id, ids));
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
  return rows.length;
}

/** 30日より古い既読通知を削除（ワーカーの定期処理） */
export async function pruneNotifications(db: DbOrTx, days = 30): Promise<void> {
  await db.execute(sql`delete from notifications where created_at < now() - make_interval(days => ${days}) and read_at is not null`);
}
