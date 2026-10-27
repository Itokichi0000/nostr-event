// 常駐ワーカー: outbox（リレー公開・Web Push・プロフィール取得）とリレー監視。
// 起動: pnpm worker
import "dotenv/config";
import { sql } from "drizzle-orm";
import { closeDb, getDb, getSql } from "@/lib/db/client";
import { dispatchPush, PushNotConfigured, webPushSender, type PushSender } from "@/lib/push/dispatcher";
import { pruneAuthReplays } from "@/lib/services/auth";
import { pruneNotifications } from "@/lib/services/notifications";
import { OUTBOX_CHANNEL } from "@/lib/services/outbox";
import { createPool, publishToRelay } from "./nostr-io";
import { Skip, startOutboxLoop } from "./outbox";
import { handleFetchProfile } from "./profile";
import { RelayListener } from "./relay-listener";
import { handleRelayPublish } from "./relay-publisher";

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function main() {
  const pool = createPool();
  let sender: PushSender | null = null;
  try {
    sender = webPushSender();
  } catch (e) {
    if (e instanceof PushNotConfigured) log("[push] VAPID 未設定のため Web Push は送信しません（アプリ内通知は有効）");
    else throw e;
  }

  const outbox = startOutboxLoop(
    {
      relay_publish: (job) => handleRelayPublish(job, publishToRelay),
      push: async (job) => {
        if (!sender) throw new Skip("vapid_not_configured");
        const r = await dispatchPush(String(job.payload.notificationId), sender);
        return `sent=${r.sent} removed=${r.removed} skipped=${r.skipped}`;
      },
      fetch_profile: (job) => handleFetchProfile(job, pool),
    },
    {
      log,
      wake: (cb) => {
        getSql()
          .listen(OUTBOX_CHANNEL, () => cb())
          .catch((e) => log(`[outbox] LISTEN failed, polling only: ${e}`));
      },
    },
  );

  const listener = new RelayListener(pool, log);
  await listener.start().catch((e) => log(`[listener] start failed: ${e}`));

  const housekeeping = setInterval(async () => {
    try {
      await pruneAuthReplays();
      await pruneNotifications(getDb());
      await getDb().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
      await getDb().execute(
        sql`update events set status = 'ended', updated_at = now() where status = 'published' and end_at < now() - interval '1 day'`,
      );
    } catch (e) {
      log(`[housekeeping] ${e}`);
    }
  }, 10 * 60_000);

  log("worker started");
  const shutdown = async () => {
    log("shutting down…");
    clearInterval(housekeeping);
    listener.stop();
    await outbox.stop();
    pool.destroy();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
