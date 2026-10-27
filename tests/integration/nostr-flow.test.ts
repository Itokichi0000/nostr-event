import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools/pure";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { events, externalRsvps, nostrEvents, notifications, outboxJobs, registrations, relayPublishAttempts } from "@/lib/db/schema";
import { buildRsvp, coordinateOf, parseCalendarEvent, type EventTemplate, type SignedEvent } from "@/lib/nostr/nip52";
import { cancelEvent, createEvent, publishEvent, updateEvent } from "@/lib/services/events";
import { ingestNostrEvent } from "@/lib/services/ingest";
import { publishRsvp, register } from "@/lib/services/registrations";
import { publishToRelay } from "@/worker/nostr-io";
import { runOutboxOnce } from "@/worker/outbox";
import { handleRelayPublish } from "@/worker/relay-publisher";
import { startMockRelay, type MockRelay } from "@/scripts/mock-relay";
import { eventInput, makeUser, resetDb, sign, type TestUser } from "../support/db";

let relayA: MockRelay;
let relayB: MockRelay;
let owner: TestUser;

beforeAll(async () => {
  relayA = await startMockRelay(17771);
  relayB = await startMockRelay(17772);
  process.env.NOSTR_FALLBACK_RELAYS = `${relayA.url},${relayB.url}`;
});
afterAll(async () => {
  process.env.NOSTR_FALLBACK_RELAYS = "";
  await relayA.close();
  await relayB.close();
});
beforeEach(async () => {
  await resetDb();
  relayA.setReject(false);
  relayB.setReject(false);
  relayA.clear();
  relayB.clear();
  owner = await makeUser("主催者");
});

async function signTemplateFrom(err: unknown, user = owner): Promise<SignedEvent> {
  const tpl = (err as { details?: { template?: EventTemplate } }).details?.template;
  if (!tpl) throw err;
  return sign(user, tpl);
}

async function createAndPublish(over: Record<string, unknown> = {}) {
  const { event, template } = await createEvent(owner, eventInput({ visibility: "public_nostr", ...over }));
  expect(event.status).toBe("draft");
  await publishEvent(owner, event.id, sign(owner, template!));
  return event;
}

const outbox = () => runOutboxOnce({ relay_publish: (job) => handleRelayPublish(job, publishToRelay) });
const reloadEvent = async (id: string) => (await getDb().select().from(events).where(eq(events.id, id)))[0]!;

describe("NIP-52 公開", () => {
  it("署名がなければ 428 で雛形を返し、署名後にリレーへ公開され published になる", async () => {
    const { event } = await createEvent(owner, eventInput({ visibility: "public_nostr" }));
    const err = await publishEvent(owner, event.id, undefined).catch((e) => e);
    expect(err).toMatchObject({ status: 428, code: "signature_required" });
    const signed = await signTemplateFrom(err);
    const published = await publishEvent(owner, event.id, signed);
    expect(published.status).toBe("publishing");

    expect(await outbox()).toBe(1);
    const e = await reloadEvent(event.id);
    expect(e.status).toBe("published");
    expect(e.nostrPublishState).toBe("success");
    expect(relayA.events.map((x) => x.id)).toContain(signed.id);
    expect(relayB.events.map((x) => x.id)).toContain(signed.id);
    const parsed = parseCalendarEvent(relayA.events.find((x) => x.id === signed.id) as SignedEvent)!;
    expect(parsed.title).toBe("Nostr 勉強会");
  });

  it("別人の署名・内容の異なる署名は拒否", async () => {
    const { event, template } = await createEvent(owner, eventInput({ visibility: "public_nostr" }));
    const other = await makeUser();
    await expect(publishEvent(owner, event.id, sign(other, template!))).rejects.toMatchObject({ code: "wrong_signer" });
    const tampered = sign(owner, { ...template!, tags: [...template!.tags, ["t", "spam"]] });
    await expect(publishEvent(owner, event.id, tampered)).rejects.toMatchObject({ code: "template_mismatch" });
    await expect(publishEvent(other, event.id, sign(owner, template!))).rejects.toMatchObject({ status: 403 });
  });

  it("一部のリレーが失敗しても1つ ACK があれば published（partial）。失敗分は再試行", async () => {
    relayB.setReject(true);
    const event = await createAndPublish();
    await outbox();
    let e = await reloadEvent(event.id);
    expect(e.status).toBe("published");
    expect(e.nostrPublishState).toBe("partial");
    const attempts = await getDb().select().from(relayPublishAttempts);
    expect(attempts.find((a) => a.relayUrl === relayB.url)?.status).toBe("failed");

    // 復旧後の再試行では、成功済みリレーへは送らず失敗分だけ送る
    relayB.setReject(false);
    await getDb().update(outboxJobs).set({ availableAt: new Date() });
    await outbox();
    e = await reloadEvent(event.id);
    expect(e.nostrPublishState).toBe("success");
    const a = await getDb().select().from(relayPublishAttempts);
    expect(a.find((x) => x.relayUrl === relayA.url)?.attempts).toBe(1);
  });

  it("全リレー失敗なら published にせず、上限到達で failed と主催者への警告", async () => {
    relayA.setReject(true);
    relayB.setReject(true);
    const event = await createAndPublish();
    await getDb().update(outboxJobs).set({ maxAttempts: 2 });
    await outbox();
    expect((await reloadEvent(event.id)).status).toBe("publishing");
    await getDb().update(outboxJobs).set({ availableAt: new Date() });
    await outbox();
    const e = await reloadEvent(event.id);
    expect(e.status).toBe("publishing");
    expect(e.nostrPublishState).toBe("failed");
    const n = await getDb().select().from(notifications).where(eq(notifications.type, "publish_failed"));
    expect(n).toHaveLength(1);
  });

  it("公開後の編集は同じ座標（kind+pubkey+d）で新しい署名を要求する", async () => {
    const event = await createAndPublish();
    await outbox();
    const before = await reloadEvent(event.id);
    const err = await updateEvent(owner, event.id, eventInput({ visibility: "public_nostr", title: "改題" }), undefined).catch((e) => e);
    expect(err).toMatchObject({ status: 428 });
    const signed = await signTemplateFrom(err);
    expect(signed.tags.find((t) => t[0] === "d")?.[1]).toBe(before.nostrD);
    expect(signed.created_at).toBeGreaterThan(before.latestNostrCreatedAt!);
    await updateEvent(owner, event.id, eventInput({ visibility: "public_nostr", title: "改題" }), signed);
    await outbox();
    const after = await reloadEvent(event.id);
    expect(after.title).toBe("改題");
    expect(after.nostrCoordinate).toBe(before.nostrCoordinate);
    expect(after.latestNostrEventId).toBe(signed.id);
    // リレー上では置換されて1件だけ
    expect(relayA.events.filter((x) => x.kind === before.nostrKind)).toHaveLength(1);
    // 定員だけの変更は署名不要
    await updateEvent(owner, event.id, eventInput({ visibility: "public_nostr", title: "改題", capacity: 50 }), undefined);
  });

  it("公開範囲は後から変更できない", async () => {
    const event = await createAndPublish();
    await expect(updateEvent(owner, event.id, eventInput({ visibility: "unlisted_db" }), undefined)).rejects.toMatchObject({
      code: "visibility_locked",
    });
  });

  it("キャンセルは status=cancelled 付きの更新を署名、または Nostr 反映なしで中止できる", async () => {
    const event = await createAndPublish();
    await outbox();
    const err = await cancelEvent(owner, event.id, {}).catch((e) => e);
    const signed = await signTemplateFrom(err);
    expect(signed.tags).toContainEqual(["status", "cancelled"]);
    const c = await cancelEvent(owner, event.id, { signedEvent: signed });
    expect(c.status).toBe("cancelled");

    const e2 = await createAndPublish({ title: "二つ目" });
    const c2 = await cancelEvent(owner, e2.id, { skipNostr: true });
    expect(c2.status).toBe("cancelled");
  });

  it("限定リンクのイベントは Nostr に一切投稿しない", async () => {
    const { event, template } = await createEvent(owner, eventInput({ visibility: "unlisted_db" }));
    expect(template).toBeNull();
    expect(event.status).toBe("published");
    expect(event.nostrCoordinate).toBeNull();
    await register(event.id, { mode: "guest", displayName: "秘密の名前", idempotencyKey: randomUUID() }, null);
    await outbox();
    expect(await getDb().select().from(nostrEvents)).toHaveLength(0);
    expect(relayA.events).toHaveLength(0);
  });
});

describe("公開RSVP と外部RSVP", () => {
  it("本人が同意した RSVP だけ投稿。取消でも同じ d を再利用し、ゲスト情報はリレーに出ない", async () => {
    const event = await createAndPublish();
    await outbox();
    const u = await makeUser("参加者");
    await register(event.id, { mode: "guest", displayName: "ゲスト花子", email: "hanako@example.com", idempotencyKey: randomUUID() }, null);
    const r = await register(event.id, { mode: "nostr", idempotencyKey: randomUUID() }, u);
    // RSVP は自動では出ない
    await outbox();
    expect(relayA.events.filter((x) => x.kind === 31925)).toHaveLength(0);

    const err = await publishRsvp(u, r.registrationId, { status: "accepted" }).catch((e) => e);
    const signed = await signTemplateFrom(err, u);
    await publishRsvp(u, r.registrationId, { status: "accepted", signedEvent: signed });
    const err2 = await publishRsvp(u, r.registrationId, { status: "declined" }).catch((e) => e);
    const signed2 = await signTemplateFrom(err2, u);
    expect(signed2.tags.find((t) => t[0] === "d")).toEqual(signed.tags.find((t) => t[0] === "d"));
    await publishRsvp(u, r.registrationId, { status: "declined", signedEvent: signed2 });
    await outbox();

    const rsvps = relayA.events.filter((x) => x.kind === 31925);
    expect(rsvps).toHaveLength(1); // 同じ d なので置換
    expect(rsvps[0]!.tags).toContainEqual(["status", "declined"]);
    // 秘密情報がリレーに漏れていない
    const dump = JSON.stringify(relayA.events) + JSON.stringify(relayB.events);
    expect(dump).not.toContain("ゲスト花子");
    expect(dump).not.toContain("hanako@example.com");
    expect(dump).not.toContain("/ticket/");
    // 他人の申込の RSVP は出せない
    const other = await makeUser();
    await expect(publishRsvp(other, r.registrationId, { status: "accepted" })).rejects.toMatchObject({ status: 403 });
  });

  it("外部RSVPは複数リレーから届いても1件・通知1回。定員を消費しない", async () => {
    const event = await createAndPublish({ capacity: 1 });
    await outbox();
    const e = await reloadEvent(event.id);
    const ext = await makeUser();
    const rsvp = finalizeEvent(
      buildRsvp({ coordinate: e.nostrCoordinate!, d: "x1", status: "accepted", organizerPubkey: owner.pubkey }, Math.floor(Date.now() / 1000)),
      ext.sk,
    );
    expect(await ingestNostrEvent(rsvp)).toBe("rsvp_external");
    expect(await ingestNostrEvent({ ...rsvp })).toBe("duplicate");
    expect(await ingestNostrEvent({ ...rsvp })).toBe("duplicate");
    expect(await getDb().select().from(externalRsvps)).toHaveLength(1);
    expect(await getDb().select().from(notifications).where(eq(notifications.type, "external_rsvp"))).toHaveLength(1);
    expect(await getDb().select().from(registrations)).toHaveLength(0);

    // 別 d で再表明しても同一人物として集約、同じ意思なら通知しない
    const again = finalizeEvent(
      buildRsvp({ coordinate: e.nostrCoordinate!, d: "x2", status: "accepted", organizerPubkey: owner.pubkey }, Math.floor(Date.now() / 1000) + 5),
      ext.sk,
    );
    await ingestNostrEvent(again);
    expect(await getDb().select().from(externalRsvps)).toHaveLength(1);
    expect(await getDb().select().from(notifications).where(eq(notifications.type, "external_rsvp"))).toHaveLength(1);

    // 古い再送は無視
    const old = finalizeEvent(
      buildRsvp({ coordinate: e.nostrCoordinate!, d: "x1", status: "declined", organizerPubkey: owner.pubkey }, 1000),
      ext.sk,
    );
    expect(await ingestNostrEvent(old)).toBe("rsvp_stale");

    // ゲストの正式申込は外部RSVPに関係なく定員1を使える
    const g = await register(event.id, { mode: "guest", displayName: "g", idempotencyKey: randomUUID() }, null);
    expect(g.status).toBe("confirmed");
  });

  it("アプリで申込済みの本人の外部RSVPは連携済みとして扱い、通知・人数を増やさない", async () => {
    const event = await createAndPublish();
    await outbox();
    const e = await reloadEvent(event.id);
    const u = await makeUser();
    await register(event.id, { mode: "nostr", idempotencyKey: randomUUID() }, u);
    const rsvp = finalizeEvent(
      buildRsvp({ coordinate: e.nostrCoordinate!, d: "z", status: "accepted", organizerPubkey: owner.pubkey }, Math.floor(Date.now() / 1000)),
      u.sk,
    );
    expect(await ingestNostrEvent(rsvp)).toBe("rsvp_linked");
    expect(await getDb().select().from(externalRsvps)).toHaveLength(0);
    expect(await getDb().select().from(notifications).where(eq(notifications.type, "external_rsvp"))).toHaveLength(0);
  });

  it("署名の不正なイベント、管理外の座標は取り込まない", async () => {
    const event = await createAndPublish();
    await outbox();
    const e = await reloadEvent(event.id);
    const ext = await makeUser();
    const good = finalizeEvent(
      buildRsvp({ coordinate: e.nostrCoordinate!, d: "q", status: "accepted", organizerPubkey: owner.pubkey }, 1),
      ext.sk,
    );
    expect(await ingestNostrEvent({ ...good, sig: "0".repeat(128) })).toBe("invalid");
    const foreign = finalizeEvent(
      buildRsvp({ coordinate: coordinateOf(31923, ext.pubkey, "other"), d: "q", status: "accepted", organizerPubkey: ext.pubkey }, 1),
      ext.sk,
    );
    expect(await ingestNostrEvent(foreign)).toBe("ignored");
  });

  it("外部クライアントでの本人更新はタイトル等を反映し、定員などアプリ設定は変えない", async () => {
    const event = await createAndPublish({ capacity: 7 });
    await outbox();
    const e = await reloadEvent(event.id);
    const raw = (await getDb().select().from(nostrEvents).where(eq(nostrEvents.id, e.latestNostrEventId!)))[0]!.raw;
    const updated = finalizeEvent(
      {
        kind: raw.kind,
        created_at: raw.created_at + 10,
        content: raw.content,
        tags: raw.tags.map((t) => (t[0] === "title" ? ["title", "外部で改題"] : t)),
      },
      owner.sk,
    );
    expect(await ingestNostrEvent(updated)).toBe("calendar_updated");
    const after = await reloadEvent(event.id);
    expect(after.title).toBe("外部で改題");
    expect(after.capacity).toBe(7);
    expect(after.latestNostrEventId).toBe(updated.id);
    // 他人が同じ d で出しても反映しない
    const ext = await makeUser();
    const spoof = finalizeEvent({ ...updated, created_at: updated.created_at + 10, tags: updated.tags }, ext.sk);
    expect(await ingestNostrEvent(spoof)).toBe("ignored");
  });
});
