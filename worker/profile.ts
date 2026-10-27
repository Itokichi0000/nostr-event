// outbox ジョブ fetch_profile: kind 0（表示名）と kind 10002（NIP-65 リレー）を取得
import { eq } from "drizzle-orm";
import type { SimplePool } from "nostr-tools/pool";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { accounts, type OutboxJob } from "@/lib/db/schema";
import { KIND_PROFILE, KIND_RELAY_LIST } from "@/lib/nostr/nip52";
import { parseRelayList } from "@/lib/nostr/relays";
import { verifyEvent } from "nostr-tools/pure";

export async function handleFetchProfile(job: OutboxJob, pool: SimplePool): Promise<void> {
  const { pubkey } = job.payload as { pubkey: string };
  const relays = config.indexRelays;
  if (!relays.length) return;
  const found = await pool.querySync(relays, { kinds: [KIND_PROFILE, KIND_RELAY_LIST], authors: [pubkey] }, { maxWait: 6000 });
  const latest = (kind: number) =>
    found
      .filter((e) => e.kind === kind && e.pubkey === pubkey && verifyEvent(e))
      .sort((a, b) => b.created_at - a.created_at)[0];
  const profile = latest(KIND_PROFILE);
  const relayList = latest(KIND_RELAY_LIST);
  const update: Partial<typeof accounts.$inferInsert> = { profileFetchedAt: new Date() };
  if (profile) {
    try {
      const meta = JSON.parse(profile.content) as { display_name?: unknown; name?: unknown; picture?: unknown };
      const name = typeof meta.display_name === "string" && meta.display_name.trim() ? meta.display_name : meta.name;
      if (typeof name === "string" && name.trim()) update.displayName = name.trim().slice(0, 60);
      if (typeof meta.picture === "string" && meta.picture.startsWith("https://") && meta.picture.length < 1024) {
        update.picture = meta.picture;
      }
    } catch {
      // 不正な kind 0 は無視
    }
  }
  if (relayList) update.nip65Relays = parseRelayList(relayList.tags);
  await getDb().update(accounts).set(update).where(eq(accounts.nostrPubkey, pubkey));
}
