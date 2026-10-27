import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  KIND_DATE_EVENT,
  KIND_RSVP,
  KIND_TIME_EVENT,
  allDayRange,
  buildCalendarEvent,
  buildRsvp,
  coordinateOf,
  dayTags,
  matchesTemplate,
  parseCalendarEvent,
  parseRsvp,
  type SignedEvent,
} from "@/lib/nostr/nip52";
import { zonedToUtc } from "@/lib/time";

const tag = (tags: string[][], name: string) => tags.filter((t) => t[0] === name).map((t) => t[1]);
const sk = generateSecretKey();
const pk = getPublicKey(sk);

describe("NIP-52 時刻ベース (31923)", () => {
  const base = {
    d: "abc123",
    title: "Nostr Meetup",
    summary: "初心者歓迎",
    description: "詳しい説明",
    location: "Tokyo",
    hashtags: ["meetup"],
    timezone: "Asia/Tokyo",
    isAllDay: false,
  };

  it("title / start / end（Unix秒）/ D / tzid を出力し、name や L/l を使わない", () => {
    const startAt = zonedToUtc("2026-11-07", "19:00", "Asia/Tokyo");
    const endAt = zonedToUtc("2026-11-07", "21:00", "Asia/Tokyo");
    const t = buildCalendarEvent({ ...base, startAt, endAt }, 1_800_000_000);
    expect(t.kind).toBe(KIND_TIME_EVENT);
    expect(tag(t.tags, "d")).toEqual(["abc123"]);
    expect(tag(t.tags, "title")).toEqual(["Nostr Meetup"]);
    expect(tag(t.tags, "start")).toEqual([String(startAt.getTime() / 1000)]);
    expect(tag(t.tags, "end")).toEqual([String(endAt.getTime() / 1000)]);
    // 2026-11-07 19:00 JST = 10:00 UTC → 同じUTC日
    expect(tag(t.tags, "D")).toEqual([String(Math.floor(startAt.getTime() / 1000 / 86400))]);
    expect(tag(t.tags, "start_tzid")).toEqual(["Asia/Tokyo"]);
    expect(tag(t.tags, "end_tzid")).toEqual(["Asia/Tokyo"]);
    expect(tag(t.tags, "location")).toEqual(["Tokyo"]);
    expect(tag(t.tags, "t")).toEqual(["meetup"]);
    expect(t.content).toBe("詳しい説明");
    expect(t.tags.some((x) => x[0] === "name" || x[0] === "L" || x[0] === "l")).toBe(false);
  });

  it("UTC 日をまたぐ場合は複数の D タグ（JST 23:00-翌01:00 → 同じUTC日 / JST 08:00-10:00 は前日UTCを跨ぐ）", () => {
    // JST 08:00 = UTC 前日 23:00, JST 10:00 = UTC 01:00 → 2つのUTC日
    const startAt = zonedToUtc("2026-11-07", "08:00", "Asia/Tokyo");
    const endAt = zonedToUtc("2026-11-07", "10:00", "Asia/Tokyo");
    const t = buildCalendarEvent({ ...base, startAt, endAt }, 1);
    const s = startAt.getTime() / 1000;
    expect(tag(t.tags, "D")).toEqual([String(Math.floor(s / 86400)), String(Math.floor(s / 86400) + 1)]);
  });

  it("D は end を排他として扱う（UTC 0:00 ちょうどに終わるなら翌日を含めない）", () => {
    const day = 20000;
    expect(dayTags(day * 86400, (day + 1) * 86400)).toEqual([String(day)]);
    expect(dayTags(day * 86400, (day + 1) * 86400 + 1)).toEqual([String(day), String(day + 1)]);
    expect(dayTags(day * 86400 + 100, day * 86400 + 100)).toEqual([String(day)]);
    // 3日間
    expect(dayTags(day * 86400 + 3600, (day + 2) * 86400 + 3600)).toHaveLength(3);
  });

  it("夏時間のあるタイムゾーンでも壁時計時刻が正しく変換される", () => {
    // America/New_York: 2026-03-08 に夏時間開始
    expect(zonedToUtc("2026-03-07", "12:00", "America/New_York").toISOString()).toBe("2026-03-07T17:00:00.000Z");
    expect(zonedToUtc("2026-03-09", "12:00", "America/New_York").toISOString()).toBe("2026-03-09T16:00:00.000Z");
    expect(zonedToUtc("2026-11-07", "19:00", "Asia/Tokyo").toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("署名後に解析でき、往復で同じ値になる", () => {
    const startAt = zonedToUtc("2026-11-07", "19:00", "Asia/Tokyo");
    const endAt = zonedToUtc("2026-11-07", "21:00", "Asia/Tokyo");
    const signed = finalizeEvent(buildCalendarEvent({ ...base, startAt, endAt }, 1_800_000_000), sk) as SignedEvent;
    const p = parseCalendarEvent(signed)!;
    expect(p.title).toBe("Nostr Meetup");
    expect(p.startAt.getTime()).toBe(startAt.getTime());
    expect(p.endAt.getTime()).toBe(endAt.getTime());
    expect(p.timezone).toBe("Asia/Tokyo");
    expect(p.pubkey).toBe(pk);
  });

  it("キャンセル時はアプリ固有の status=cancelled タグを付ける", () => {
    const startAt = new Date("2026-11-07T10:00:00Z");
    const t = buildCalendarEvent({ ...base, startAt, endAt: startAt, cancelled: true }, 1);
    expect(tag(t.tags, "status")).toEqual(["cancelled"]);
    expect(tag(t.tags, "end")).toEqual([]); // end == start は省略
  });
});

describe("NIP-52 日付ベース (31922)", () => {
  it("end は終了日の翌日（排他）。単日は end を省略", () => {
    const one = allDayRange("2026-11-07", "2026-11-07", "Asia/Tokyo");
    const t1 = buildCalendarEvent({ d: "x", title: "t", description: "", timezone: "Asia/Tokyo", isAllDay: true, ...one }, 1);
    expect(t1.kind).toBe(KIND_DATE_EVENT);
    expect(tag(t1.tags, "start")).toEqual(["2026-11-07"]);
    expect(tag(t1.tags, "end")).toEqual([]);
    expect(tag(t1.tags, "D")).toEqual([]);

    const three = allDayRange("2026-11-07", "2026-11-09", "Asia/Tokyo");
    const t3 = buildCalendarEvent({ d: "x", title: "t", description: "", timezone: "Asia/Tokyo", isAllDay: true, ...three }, 1);
    expect(tag(t3.tags, "start")).toEqual(["2026-11-07"]);
    expect(tag(t3.tags, "end")).toEqual(["2026-11-10"]);
  });

  it("月末・年末をまたいでも排他終了日が正しい", () => {
    const r = allDayRange("2026-12-30", "2026-12-31", "Asia/Tokyo");
    const t = buildCalendarEvent({ d: "x", title: "t", description: "", timezone: "Asia/Tokyo", isAllDay: true, ...r }, 1);
    expect(tag(t.tags, "end")).toEqual(["2027-01-01"]);
  });

  it("解析では end 省略時に1日イベントとして扱う", () => {
    const signed = finalizeEvent(
      { kind: KIND_DATE_EVENT, created_at: 1, tags: [["d", "x"], ["title", "t"], ["start", "2026-11-07"]], content: "" },
      sk,
    ) as SignedEvent;
    const p = parseCalendarEvent(signed)!;
    expect(p.isAllDay).toBe(true);
    expect(p.endAt.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("NIP-52 RSVP (31925)", () => {
  const coordinate = coordinateOf(KIND_TIME_EVENT, pk, "abc");

  it("a / d / status / p（任意で e）を持ち、L/l ラベルを使わない", () => {
    const t = buildRsvp({ coordinate, d: "rsvp-1", status: "accepted", organizerPubkey: pk, eventId: "e".repeat(64) }, 1);
    expect(t.kind).toBe(KIND_RSVP);
    expect(tag(t.tags, "a")).toEqual([coordinate]);
    expect(tag(t.tags, "d")).toEqual(["rsvp-1"]);
    expect(tag(t.tags, "status")).toEqual(["accepted"]);
    expect(tag(t.tags, "p")).toEqual([pk]);
    expect(tag(t.tags, "e")).toEqual(["e".repeat(64)]);
    expect(t.tags.some((x) => x[0] === "L" || x[0] === "l")).toBe(false);
  });

  it("取消は同じ d で declined を出す", () => {
    const a = buildRsvp({ coordinate, d: "same", status: "accepted", organizerPubkey: pk }, 1);
    const b = buildRsvp({ coordinate, d: "same", status: "declined", organizerPubkey: pk }, 2);
    expect(tag(a.tags, "d")).toEqual(tag(b.tags, "d"));
    expect(tag(b.tags, "status")).toEqual(["declined"]);
  });

  it("status が不正・a が無い RSVP は解析しない", () => {
    const bad = finalizeEvent({ kind: KIND_RSVP, created_at: 1, tags: [["a", coordinate], ["d", "x"], ["status", "maybe"]], content: "" }, sk);
    expect(parseRsvp(bad as SignedEvent)).toBeNull();
    const noA = finalizeEvent({ kind: KIND_RSVP, created_at: 1, tags: [["d", "x"], ["status", "accepted"]], content: "" }, sk);
    expect(parseRsvp(noA as SignedEvent)).toBeNull();
    const ok = finalizeEvent(buildRsvp({ coordinate, d: "x", status: "tentative", organizerPubkey: pk }, 1), sk);
    expect(parseRsvp(ok as SignedEvent)?.status).toBe("tentative");
  });
});

describe("署名内容の照合", () => {
  it("タグが1つでも違えば不一致", () => {
    const t = buildRsvp({ coordinate: coordinateOf(KIND_TIME_EVENT, pk, "a"), d: "x", status: "accepted", organizerPubkey: pk }, 5);
    const signed = finalizeEvent(t, sk) as SignedEvent;
    expect(matchesTemplate(signed, t)).toBe(true);
    expect(matchesTemplate(signed, { ...t, tags: [...t.tags, ["t", "extra"]] })).toBe(false);
    expect(matchesTemplate(signed, { ...t, content: "x" })).toBe(false);
  });
});
