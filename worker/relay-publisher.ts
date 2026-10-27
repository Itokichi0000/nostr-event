// outbox ジョブ relay_publish: 署名済みイベントを各リレーへ送り、リレー単位で結果を記録する。
// 1リレー以上で OK true を確認したら published。全失敗なら failed とし主催者に警告。
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { accounts, events, nostrEvents, relayPublishAttempts, type OutboxJob } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { readRelays, uniqueRelays, writeRelays } from "@/lib/nostr/relays";
import { createNotification } from "@/lib/services/notifications";
import type { RelayPublisher } from "./nostr-io";

async function accountRelays(pubkey: string) {
  const [a] = await getDb().select().from(accounts).where(eq(accounts.nostrPubkey, pubkey)).limit(1);
  return { custom: a?.customRelays ?? null, nip65: a?.nip65Relays ?? null };
}

export async function targetRelaysFor(purpose: "calendar" | "rsvp", signerPubkey: string, ownerPubkey: string): Promise<string[]> {
  const signer = await accountRelays(signerPubkey);
  const mine = signer.custom?.length ? signer.custom : writeRelays(signer.nip65);
  if (purpose === "rsvp") {
    // 参加表明は主催者の受信リレーにも届ける（NIP-65）
    const owner = await accountRelays(ownerPubkey);
    return uniqueRelays(mine, readRelays(owner.nip65), config.fallbackRelays);
  }
  return uniqueRelays(mine, config.fallbackRelays);
}

export async function handleRelayPublish(job: OutboxJob, publish: RelayPublisher): Promise<void> {
  const db = getDb();
  const { nostrEventId, eventId, purpose, resetFailed } = job.payload as {
    nostrEventId: string;
    eventId: string;
    purpose: "calendar" | "rsvp";
    resetFailed?: boolean;
  };
  const [ne] = await db.select().from(nostrEvents).where(eq(nostrEvents.id, nostrEventId)).limit(1);
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ne || !ev) return;

  const relays = await targetRelaysFor(purpose, ne.pubkey, ev.ownerPubkey);
  if (relays.length) {
    await db
      .insert(relayPublishAttempts)
      .values(relays.map((relayUrl) => ({ nostrEventId, relayUrl })))
      .onConflictDoNothing();
  }
  if (resetFailed) {
    await db
      .update(relayPublishAttempts)
      .set({ status: "pending" })
      .where(and(eq(relayPublishAttempts.nostrEventId, nostrEventId), eq(relayPublishAttempts.status, "failed")));
  }
  const attempts = await db.select().from(relayPublishAttempts).where(eq(relayPublishAttempts.nostrEventId, nostrEventId));

  // 成功済みリレーには再送しない。未成功のものだけ、署名済みイベントをそのまま再配信
  await Promise.all(
    attempts
      .filter((a) => a.status !== "ok")
      .map(async (a) => {
        try {
          await publish(a.relayUrl, ne.raw);
          await db
            .update(relayPublishAttempts)
            .set({ status: "ok", attempts: sql`${relayPublishAttempts.attempts} + 1`, ackedAt: new Date(), lastError: null })
            .where(and(eq(relayPublishAttempts.nostrEventId, nostrEventId), eq(relayPublishAttempts.relayUrl, a.relayUrl)));
        } catch (e) {
          await db
            .update(relayPublishAttempts)
            .set({
              status: "failed",
              attempts: sql`${relayPublishAttempts.attempts} + 1`,
              lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300),
              nextRetryAt: new Date(Date.now() + 60_000),
            })
            .where(and(eq(relayPublishAttempts.nostrEventId, nostrEventId), eq(relayPublishAttempts.relayUrl, a.relayUrl)));
        }
      }),
  );

  const after = await db.select().from(relayPublishAttempts).where(eq(relayPublishAttempts.nostrEventId, nostrEventId));
  const okCount = after.filter((a) => a.status === "ok").length;
  const allOk = after.length > 0 && okCount === after.length;
  const lastAttempt = job.attempts >= job.maxAttempts;

  if (purpose === "calendar") {
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      // 後から新しい版が署名された場合、古い版の結果で状態を上書きしない
      if (!cur || cur.latestNostrEventId !== nostrEventId) return;
      if (okCount > 0) {
        await tx
          .update(events)
          .set({
            nostrPublishState: allOk ? "success" : "partial",
            status: cur.status === "publishing" ? "published" : cur.status,
            updatedAt: new Date(),
          })
          .where(eq(events.id, eventId));
      } else if (lastAttempt || after.length === 0) {
        await tx.update(events).set({ nostrPublishState: "failed" }).where(eq(events.id, eventId));
        await createNotification(tx, {
          recipientAccountId: cur.ownerAccountId,
          type: "publish_failed",
          dedupeKey: `publish_failed:${nostrEventId}:${job.id}`,
          eventId,
        });
      }
    });
  }

  if (!allOk && !lastAttempt && after.length > 0) {
    throw new Error(`relay publish incomplete: ${okCount}/${after.length} ok`);
  }
}
