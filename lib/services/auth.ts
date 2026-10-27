import { sql } from "drizzle-orm";
import { ApiError } from "../api";
import { Nip98Error, verifyNip98 } from "../auth/nip98";
import { createSession } from "../auth/session";
import { config, NIP98_WINDOW_SEC } from "../config";
import { getDb } from "../db/client";
import { accounts, authReplays } from "../db/schema";
import { enqueueJob } from "./outbox";

export const AUTH_PATH = "/api/auth/nostr";

/**
 * NIP-98 でログイン。u タグは APP_URL 基準の絶対URL（逆プロキシ配下でも一致させるため）。
 * 署名・kind・時刻・URL・メソッド・リプレイをすべて検証する。
 */
export async function loginWithNip98(authorization: string | null, signerType: string | null) {
  let ev;
  try {
    ev = verifyNip98(authorization, { url: `${config.appUrl}${AUTH_PATH}`, method: "POST", windowSec: NIP98_WINDOW_SEC });
  } catch (e) {
    if (e instanceof Nip98Error) throw new ApiError(401, "nip98_" + e.reason, "Nostr の署名を確認できませんでした。もう一度お試しください");
    throw e;
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const fresh = await tx.insert(authReplays).values({ eventId: ev.id }).onConflictDoNothing().returning();
    if (!fresh.length) throw new ApiError(401, "nip98_replay", "この署名は既に使用されています。もう一度お試しください");
    const [account] = await tx
      .insert(accounts)
      .values({ nostrPubkey: ev.pubkey })
      .onConflictDoUpdate({ target: accounts.nostrPubkey, set: { nostrPubkey: sql`excluded.nostr_pubkey` } })
      .returning();
    // プロフィール名・NIP-65 リレーをワーカーで取得（1日1回まで）
    const day = new Date().toISOString().slice(0, 10);
    await enqueueJob(tx, {
      kind: "fetch_profile",
      dedupeKey: `fetch_profile:${ev.pubkey}:${day}`,
      payload: { pubkey: ev.pubkey },
      maxAttempts: 3,
    });
    const session = await createSession(tx, account!.id, signerType);
    return { account: account!, ...session };
  });
}

export async function pruneAuthReplays(): Promise<void> {
  await getDb().execute(sql`delete from auth_replays where seen_at < now() - interval '10 minutes'`);
}
