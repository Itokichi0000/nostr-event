import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { notifications, outboxJobs, pushDeliveries, pushSubscriptions, sessions } from "@/lib/db/schema";
import { dispatchPush, type PushSender } from "@/lib/push/dispatcher";
import { subscribePush } from "@/lib/push/subscriptions";
import { loginWithNip98 } from "@/lib/services/auth";
import { createEvent } from "@/lib/services/events";
import { createNotification, listNotifications, markRead, unreadCount } from "@/lib/services/notifications";
import { enqueueJob } from "@/lib/services/outbox";
import { register } from "@/lib/services/registrations";
import { findSession } from "@/lib/auth/session";
import { runOutboxOnce } from "@/worker/outbox";
import { eventInput, makeUser, resetDb, type TestUser } from "../support/db";

let owner: TestUser;
beforeEach(async () => {
  await resetDb();
  owner = await makeUser("主催者");
});

const sub = (n: number) => ({ endpoint: `https://push.example.com/sub/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

describe("通知の冪等性", () => {
  it("同じ dedupe_key の通知は1件だけ、Push ジョブも1件だけ", async () => {
    const db = getDb();
    for (let i = 0; i < 3; i++) {
      await db.transaction((tx) =>
        createNotification(tx, { recipientAccountId: owner.accountId, type: "checkin_created", dedupeKey: "checkin:same" }),
      );
    }
    expect(await db.select().from(notifications)).toHaveLength(1);
    expect(await db.select().from(outboxJobs)).toHaveLength(1);
  });

  it("一覧はカーソルでページングでき、既読化で未読数が減る。他人の通知は見えない", async () => {
    const { event } = await createEvent(owner, eventInput());
    for (let i = 0; i < 5; i++) await register(event.id, { mode: "guest", displayName: `g${i}`, idempotencyKey: randomUUID() }, null);
    const p1 = await listNotifications(owner.accountId, { limit: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p1.unreadCount).toBe(5);
    const p2 = await listNotifications(owner.accountId, { limit: 3, cursor: p1.nextCursor });
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(5);
    // ゲストのメール等は payload に入らない
    expect(JSON.stringify(p1.items)).not.toContain("@");

    const stranger = await makeUser();
    expect((await listNotifications(stranger.accountId, {})).items).toHaveLength(0);
    expect(await markRead(stranger.accountId, [p1.items[0]!.id])).toBe(0);

    expect(await markRead(owner.accountId, [p1.items[0]!.id])).toBe(1);
    expect(await unreadCount(owner.accountId)).toBe(4);
    await markRead(owner.accountId, "all");
    expect(await unreadCount(owner.accountId)).toBe(0);
  });
});

describe("Web Push 配送", () => {
  async function notify() {
    return getDb().transaction((tx) =>
      createNotification(tx, { recipientAccountId: owner.accountId, type: "checkin_created", dedupeKey: `c:${randomUUID()}` }),
    );
  }

  it("全端末へ送信し、ロック画面向けに個人情報を含まない文面にする", async () => {
    await subscribePush(owner.accountId, sub(1), "PC");
    await subscribePush(owner.accountId, sub(2), "Phone");
    const id = (await notify())!;
    const sent: string[] = [];
    const sender: PushSender = async (s, payload) => {
      sent.push(s.endpoint);
      expect(JSON.parse(payload)).toMatchObject({ body: "参加者がチェックインしました" });
      return { statusCode: 201 };
    };
    expect(await dispatchPush(id, sender)).toMatchObject({ sent: 2 });
    expect(sent).toHaveLength(2);
  });

  it("410 の購読は削除、5xx は再試行時に未配送の端末だけへ送る", async () => {
    await subscribePush(owner.accountId, sub(1), "gone");
    await subscribePush(owner.accountId, sub(2), "flaky");
    await subscribePush(owner.accountId, sub(3), "ok");
    const id = (await notify())!;
    const calls: string[] = [];
    let flakyFails = true;
    const sender: PushSender = async (s) => {
      calls.push(s.endpoint);
      if (s.endpoint.endsWith("/1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("/2") && flakyFails) throw Object.assign(new Error("busy"), { statusCode: 503 });
      return { statusCode: 201 };
    };
    await expect(dispatchPush(id, sender)).rejects.toThrow(/push failed/);
    expect(await getDb().select().from(pushSubscriptions)).toHaveLength(2);
    flakyFails = false;
    calls.length = 0;
    const r = await dispatchPush(id, sender);
    expect(calls).toEqual(["https://push.example.com/sub/2"]); // 配送済みの /3 には再送しない
    expect(r).toMatchObject({ sent: 1, skipped: 1 });
    expect(await getDb().select().from(pushDeliveries)).toHaveLength(2);
  });

  it("Push 購読がなくてもアプリ内通知は残る", async () => {
    const id = (await notify())!;
    expect(await dispatchPush(id, async () => ({ statusCode: 201 }))).toMatchObject({ sent: 0 });
    expect((await listNotifications(owner.accountId, {})).items).toHaveLength(1);
  });

  it("同じ端末を別アカウントで登録し直すと付け替わる", async () => {
    const other = await makeUser();
    await subscribePush(owner.accountId, sub(9), null);
    await subscribePush(other.accountId, sub(9), null);
    const rows = await getDb().select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accountId).toBe(other.accountId);
  });
});

describe("outbox", () => {
  it("複数ワーカーが同時に処理しても各ジョブは1回だけ実行される", async () => {
    const db = getDb();
    for (let i = 0; i < 30; i++) await enqueueJob(db, { kind: "push", dedupeKey: `job:${i}`, payload: { i } });
    const seen: number[] = [];
    const handler = async (job: { payload: Record<string, unknown> }) => {
      seen.push(job.payload.i as number);
      await new Promise((r) => setTimeout(r, 5));
    };
    let total = 0;
    for (let round = 0; round < 5; round++) {
      const counts = await Promise.all([1, 2, 3].map(() => runOutboxOnce({ push: handler }, { batch: 4 })));
      total += counts.reduce((a, b) => a + b, 0);
    }
    expect(total).toBe(30);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(outboxJobs).where(sql`processed_at is null`);
    expect(left!.n).toBe(0);
  });

  it("失敗はバックオフで再試行、ワーカー停止で残ったロックは時間経過で再取得される", async () => {
    const db = getDb();
    await enqueueJob(db, { kind: "push", dedupeKey: "retry", payload: {}, maxAttempts: 2 });
    await runOutboxOnce({ push: async () => Promise.reject(new Error("boom")) });
    let [job] = await db.select().from(outboxJobs);
    expect(job!.attempts).toBe(1);
    expect(job!.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(job!.lastError).toBe("boom");

    // 処理途中でワーカーが落ちた状態（ロックだけ残る）を再現
    await db.update(outboxJobs).set({ availableAt: new Date(), lockedAt: new Date(Date.now() - 10 * 60_000) });
    let ran = 0;
    await runOutboxOnce({ push: async () => void ran++ });
    expect(ran).toBe(1);
    [job] = await db.select().from(outboxJobs);
    expect(job!.processedAt).not.toBeNull();
  });

  it("dedupe_key が同じジョブは二重に登録されない", async () => {
    const db = getDb();
    expect(await enqueueJob(db, { kind: "push", dedupeKey: "x", payload: {} })).toBe(true);
    expect(await enqueueJob(db, { kind: "push", dedupeKey: "x", payload: {} })).toBe(false);
  });
});

describe("NIP-98 ログイン", () => {
  const url = "http://localhost:3000/api/auth/nostr";
  function header(sk: Uint8Array, over: { u?: string; created_at?: number } = {}) {
    const ev = finalizeEvent(
      { kind: 27235, created_at: over.created_at ?? Math.floor(Date.now() / 1000), tags: [["u", over.u ?? url], ["method", "POST"]], content: "" },
      sk,
    );
    return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
  }

  it("正しい署名でセッションを作り、DB にはトークンのハッシュだけ保存する", async () => {
    const u = await makeUser();
    const r = await loginWithNip98(header(u.sk), "nip07");
    expect(r.account.nostrPubkey).toBe(u.pubkey);
    const s = await findSession(r.token);
    expect(s?.pubkey).toBe(u.pubkey);
    const rows = await getDb().select().from(sessions);
    expect(rows[0]!.tokenHash).not.toBe(r.token);
    expect(JSON.stringify(rows)).not.toContain(r.token);
  });

  it("リプレイ・誤URL・期限切れを拒否", async () => {
    const u = await makeUser();
    const h = header(u.sk);
    await loginWithNip98(h, null);
    await expect(loginWithNip98(h, null)).rejects.toMatchObject({ code: "nip98_replay" });
    await expect(loginWithNip98(header(u.sk, { u: "https://evil.example/api/auth/nostr" }), null)).rejects.toMatchObject({
      code: "nip98_wrong_url",
    });
    await expect(loginWithNip98(header(u.sk, { created_at: Math.floor(Date.now() / 1000) - 120 }), null)).rejects.toMatchObject({
      code: "nip98_expired",
    });
    expect(await getDb().select().from(sessions).where(eq(sessions.accountId, u.accountId))).toHaveLength(1);
  });
});
