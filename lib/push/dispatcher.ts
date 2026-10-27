// 通知1件を、受信者の許可済み全端末へ Web Push 配送する（ワーカー用）。
// push_deliveries で端末単位の配送済みを記録し、ジョブ再試行で二重送信しない。
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { config } from "../config";
import { getDb } from "../db/client";
import { events, notifications, pushDeliveries, pushSubscriptions } from "../db/schema";
import { pushPayload } from "./messages";

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  opts: { TTL: number; urgency: "high" | "normal" },
) => Promise<{ statusCode: number }>;

export class PushNotConfigured extends Error {}

export function webPushSender(): PushSender {
  const v = config.vapid;
  if (!v.publicKey || !v.privateKey) throw new PushNotConfigured("VAPID keys are not configured");
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
}

export type DispatchResult = { sent: number; removed: number; failed: number; skipped: number };

export async function dispatchPush(notificationId: string, send: PushSender): Promise<DispatchResult> {
  const db = getDb();
  const [n] = await db
    .select({ n: notifications, ownerId: events.ownerAccountId })
    .from(notifications)
    .leftJoin(events, eq(events.id, notifications.eventId))
    .where(eq(notifications.id, notificationId))
    .limit(1);
  const result: DispatchResult = { sent: 0, removed: 0, failed: 0, skipped: 0 };
  if (!n) return result;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.accountId, n.n.recipientAccountId), eq(pushSubscriptions.enabled, true)));
  const delivered = new Set(
    (await db.select().from(pushDeliveries).where(eq(pushDeliveries.notificationId, notificationId))).map((d) => d.subscriptionId),
  );
  const payload = JSON.stringify(pushPayload(n.n, n.ownerId === n.n.recipientAccountId));
  const errors: string[] = [];
  for (const s of subs) {
    if (delivered.has(s.id)) {
      result.skipped++;
      continue;
    }
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 24 * 3600,
        urgency: n.n.type === "checkin_created" ? "high" : "normal",
      });
      await db.insert(pushDeliveries).values({ notificationId, subscriptionId: s.id }).onConflictDoNothing();
      await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      result.sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // 失効した購読は削除
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        result.removed++;
      } else {
        await db.update(pushSubscriptions).set({ lastFailureAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
        result.failed++;
        errors.push(`${status ?? "network"}`);
      }
    }
  }
  if (result.failed > 0) {
    // 429 / 5xx / 通信障害 → ジョブごと再試行（配送済み端末はスキップされる）
    throw new Error(`push failed for ${result.failed} device(s): ${errors.join(",")}`);
  }
  return result;
}
