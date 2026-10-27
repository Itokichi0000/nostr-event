import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { errors } from "../api";
import { getDb } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { sha256Hex } from "../security/tokens";

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((v) => v.startsWith("https://"), "endpoint must be https"),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

export async function subscribePush(accountId: string, input: unknown, userAgent: string | null) {
  const sub = pushSubscriptionSchema.parse(input);
  const endpointHash = sha256Hex(sub.endpoint);
  // 同じ端末が別アカウントでログインし直した場合は付け替える
  const [row] = await getDb()
    .insert(pushSubscriptions)
    .values({
      accountId,
      endpointHash,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpointHash,
      set: { accountId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, enabled: true, userAgent: userAgent?.slice(0, 300) ?? null },
    })
    .returning({ id: pushSubscriptions.id });
  return { id: row!.id };
}

export async function listPushSubscriptions(accountId: string) {
  const rows = await getDb()
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      endpointHash: pushSubscriptions.endpointHash,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
      lastFailureAt: pushSubscriptions.lastFailureAt,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.accountId, accountId), eq(pushSubscriptions.enabled, true)))
    .orderBy(desc(pushSubscriptions.createdAt));
  return rows;
}

export async function deletePushSubscription(accountId: string, id: string) {
  const rows = await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.accountId, accountId)))
    .returning({ id: pushSubscriptions.id });
  if (!rows.length) throw errors.notFound("端末");
}

export async function deletePushSubscriptionByEndpoint(accountId: string, endpoint: string) {
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpointHash, sha256Hex(endpoint)), eq(pushSubscriptions.accountId, accountId)));
}
