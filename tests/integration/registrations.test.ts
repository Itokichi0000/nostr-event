import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { checkins, events, notifications, outboxJobs, registrations } from "@/lib/db/schema";
import { checkIn } from "@/lib/services/checkin";
import { createEvent, updateEvent } from "@/lib/services/events";
import { cancelRegistration, decideRegistration, getTicketView, register, rotateTicket } from "@/lib/services/registrations";
import { eventInput, makeUser, resetDb, type TestUser } from "../support/db";

const tokenOf = (url: string | null) => url!.split("/ticket/")[1]!;
const guest = (name = "ゲスト") => ({ mode: "guest", displayName: name, idempotencyKey: randomUUID() });

async function count(status: string, eventId: string) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), sql`${registrations.status} = ${status}`));
  return r!.n;
}

let owner: TestUser;
beforeEach(async () => {
  await resetDb();
  owner = await makeUser("主催者");
});

describe("定員と同時申込", () => {
  it("定員10に20件同時申込しても confirmed は10件、残りは waitlisted", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 10 }));
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => register(event.id, guest(`g${i}`), null)));
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(10);
    expect(results.filter((r) => r.status === "waitlisted")).toHaveLength(10);
    expect(await count("confirmed", event.id)).toBe(10);
    // 申込ごとに主催者通知が1件ずつ・Push ジョブも1件ずつ
    const n = await getDb().select().from(notifications).where(eq(notifications.eventId, event.id));
    expect(n).toHaveLength(20);
    const jobs = await getDb().select().from(outboxJobs).where(eq(outboxJobs.kind, "push"));
    expect(jobs).toHaveLength(20);
  });

  it("Nostr ユーザーの同時二重申込は1件だけ", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 5 }));
    const u = await makeUser("参加者");
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => register(event.id, { mode: "nostr", idempotencyKey: randomUUID() }, u)),
    );
    expect(rs.filter((r) => !r.alreadyRegistered)).toHaveLength(1);
    expect(await count("confirmed", event.id)).toBe(1);
  });

  it("同じ idempotency key の再送は二重登録しない", async () => {
    const { event } = await createEvent(owner, eventInput());
    const body = guest();
    const a = await register(event.id, body, null);
    const b = await register(event.id, body, null);
    expect(b.registrationId).toBe(a.registrationId);
    expect(b.alreadyRegistered).toBe(true);
    // 応答を受け取れなかった再送には新しいチケットを発行し、古いものは失効
    expect(b.ticketUrl).not.toBe(a.ticketUrl);
    expect((await getTicketView(tokenOf(a.ticketUrl))).state).toBe("revoked");
    expect((await getTicketView(tokenOf(b.ticketUrl))).state).toBe("valid");
    expect(await count("confirmed", event.id)).toBe(1);
  });

  it("ゲスト不可イベントはゲスト申込を拒否、Nostr 申込にはセッションが必要", async () => {
    const { event } = await createEvent(owner, eventInput({ allowGuest: false }));
    await expect(register(event.id, guest(), null)).rejects.toMatchObject({ code: "guest_not_allowed" });
    await expect(register(event.id, { mode: "nostr", idempotencyKey: randomUUID() }, null)).rejects.toMatchObject({ status: 401 });
  });

  it("開始後・中止後は申込できない", async () => {
    const { event } = await createEvent(owner, eventInput());
    await getDb().update(events).set({ startAt: new Date(Date.now() - 1000) }).where(eq(events.id, event.id));
    await expect(register(event.id, guest(), null)).rejects.toMatchObject({ code: "registration_closed" });
  });
});

describe("承認制", () => {
  it("manual は pending、承認時に定員を再検証して confirmed / waitlisted に振り分ける", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 1, approvalMode: "manual" }));
    const a = await register(event.id, guest("A"), null);
    const b = await register(event.id, guest("B"), null);
    expect([a.status, b.status]).toEqual(["pending", "pending"]);
    expect(await decideRegistration(owner, a.registrationId, "approve")).toEqual({ status: "confirmed" });
    expect(await decideRegistration(owner, b.registrationId, "approve")).toEqual({ status: "waitlisted" });
    expect(await count("confirmed", event.id)).toBe(1);
    const n = await getDb().select().from(notifications).where(eq(notifications.type, "registration_pending"));
    expect(n).toHaveLength(2);
  });

  it("他人のイベントの申込は承認できない", async () => {
    const { event } = await createEvent(owner, eventInput({ approvalMode: "manual" }));
    const a = await register(event.id, guest(), null);
    const stranger = await makeUser();
    await expect(decideRegistration(stranger, a.registrationId, "approve")).rejects.toMatchObject({ status: 403 });
  });
});

describe("キャンセルと繰り上げ", () => {
  it("確定者のキャンセルで待機者を先着順に1名だけ繰り上げる", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 1 }));
    const a = await register(event.id, guest("A"), null);
    const b = await register(event.id, guest("B"), null);
    const c = await register(event.id, guest("C"), null);
    expect([a.status, b.status, c.status]).toEqual(["confirmed", "waitlisted", "waitlisted"]);
    const res = await cancelRegistration(a.registrationId, { actor: null, ticketToken: tokenOf(a.ticketUrl) });
    expect(res.promoted).toEqual([b.registrationId]);
    expect(await count("confirmed", event.id)).toBe(1);
    // 二重キャンセルは冪等（繰り上げも通知も増えない）
    const again = await cancelRegistration(a.registrationId, { actor: null, ticketToken: tokenOf(a.ticketUrl) });
    expect(again.promoted).toEqual([]);
    const promotedNotes = await getDb().select().from(notifications).where(eq(notifications.type, "waitlist_promoted"));
    expect(promotedNotes).toHaveLength(1);
  });

  it("同時キャンセルでも定員を超えて繰り上げない", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 3 }));
    const regs = [];
    for (let i = 0; i < 8; i++) regs.push(await register(event.id, guest(`g${i}`), null));
    await Promise.all(regs.slice(0, 3).map((r) => cancelRegistration(r.registrationId, { actor: null, ticketToken: tokenOf(r.ticketUrl) })));
    expect(await count("confirmed", event.id)).toBe(3);
    expect(await count("waitlisted", event.id)).toBe(2);
  });

  it("他人のチケットではキャンセルできない", async () => {
    const { event } = await createEvent(owner, eventInput());
    const a = await register(event.id, guest("A"), null);
    const b = await register(event.id, guest("B"), null);
    await expect(cancelRegistration(a.registrationId, { actor: null, ticketToken: tokenOf(b.ticketUrl) })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("定員を確定者数より減らせない。増やすと待機者が繰り上がる", async () => {
    const { event } = await createEvent(owner, eventInput({ capacity: 2 }));
    for (let i = 0; i < 4; i++) await register(event.id, guest(`g${i}`), null);
    await expect(updateEvent(owner, event.id, eventInput({ capacity: 1 }), undefined)).rejects.toMatchObject({
      code: "capacity_below_confirmed",
    });
    await updateEvent(owner, event.id, eventInput({ capacity: 3 }), undefined);
    expect(await count("confirmed", event.id)).toBe(3);
  });
});

describe("チケット", () => {
  it("Nostr 参加者は本人確認で再発行でき、古いQRは失効", async () => {
    const { event } = await createEvent(owner, eventInput());
    const u = await makeUser();
    const r = await register(event.id, { mode: "nostr", idempotencyKey: randomUUID() }, u);
    const rotated = await rotateTicket(r.registrationId, { actor: u });
    expect((await getTicketView(tokenOf(r.ticketUrl))).state).toBe("revoked");
    expect((await getTicketView(tokenOf(rotated.ticketUrl))).state).toBe("valid");
    const stranger = await makeUser();
    await expect(rotateTicket(r.registrationId, { actor: stranger })).rejects.toMatchObject({ status: 403 });
  });
});

describe("QR チェックイン", () => {
  async function liveEvent() {
    const { event } = await createEvent(owner, eventInput());
    // 受付期間内（開始1時間前）にする
    await getDb()
      .update(events)
      .set({ startAt: new Date(Date.now() + 3600_000), endAt: new Date(Date.now() + 3 * 3600_000) })
      .where(eq(events.id, event.id));
    return event;
  }

  it("1回目は受付、2回目は受付済みで件数・通知とも増えない", async () => {
    const event = await liveEvent();
    const r = await register(event.id, guest("山田"), null);
    const first = await checkIn(owner, event.id, { token: r.ticketUrl });
    expect(first).toMatchObject({ result: "ok", displayName: "山田" });
    const second = await checkIn(owner, event.id, { token: tokenOf(r.ticketUrl) });
    expect(second.result).toBe("already");
    const rows = await getDb().select().from(checkins).where(eq(checkins.eventId, event.id));
    expect(rows).toHaveLength(1);
    const n = await getDb().select().from(notifications).where(eq(notifications.type, "checkin_created"));
    expect(n).toHaveLength(1);
    const jobs = await getDb().select().from(outboxJobs).where(eq(outboxJobs.dedupeKey, `push:${n[0]!.id}`));
    expect(jobs).toHaveLength(1);
  });

  it("同時スキャンでも1件だけ", async () => {
    const event = await liveEvent();
    const r = await register(event.id, guest(), null);
    const rs = await Promise.all(Array.from({ length: 6 }, () => checkIn(owner, event.id, { token: r.ticketUrl })));
    expect(rs.filter((x) => x.result === "ok")).toHaveLength(1);
    expect(rs.filter((x) => x.result === "already")).toHaveLength(5);
  });

  it("別イベントのQR・失効QR・未確定・期間外は受付しない", async () => {
    const e1 = await liveEvent();
    const e2 = await liveEvent();
    const r2 = await register(e2.id, guest(), null);
    expect(await checkIn(owner, e1.id, { token: r2.ticketUrl })).toEqual({ result: "invalid", reason: "other_event" });
    expect(await checkIn(owner, e1.id, { token: "x".repeat(43) })).toEqual({ result: "invalid", reason: "unknown_ticket" });

    const rotated = await rotateTicket(r2.registrationId, { actor: null, ticketToken: tokenOf(r2.ticketUrl) });
    expect(await checkIn(owner, e2.id, { token: r2.ticketUrl })).toEqual({ result: "invalid", reason: "revoked_ticket" });
    expect((await checkIn(owner, e2.id, { token: rotated.ticketUrl })).result).toBe("ok");

    await getDb().update(events).set({ approvalMode: "manual" }).where(eq(events.id, e1.id));
    const pending = await register(e1.id, guest(), null);
    expect((await checkIn(owner, e1.id, { token: pending.ticketUrl })).result).toBe("not_confirmed");

    const { event: far } = await createEvent(owner, eventInput());
    const rf = await register(far.id, guest(), null);
    expect((await checkIn(owner, far.id, { token: rf.ticketUrl })).result).toBe("outside_window");
  });

  it("他人のイベントへはチェックインできない", async () => {
    const event = await liveEvent();
    const r = await register(event.id, guest(), null);
    const stranger = await makeUser();
    await expect(checkIn(stranger, event.id, { token: r.ticketUrl })).rejects.toMatchObject({ status: 403 });
  });
});
