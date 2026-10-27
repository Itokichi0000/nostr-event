// NIP-52 Calendar Events / RSVP の codec（クライアント・サーバー共用の純粋関数）
// 仕様: https://github.com/nostr-protocol/nips/blob/master/52.md
//  - 31922 日付ベース: start/end は YYYY-MM-DD、end は排他（翌日）
//  - 31923 時刻ベース: start/end は Unix 秒、D タグ（floor(sec/86400)）必須
//  - 31925 RSVP: a / d / status 必須、p・e 任意。旧 L/l ラベルは使わない
import { addDays, isValidDateString, toUnixSeconds, utcToZoned, zonedToUtc } from "../time";

export const KIND_DATE_EVENT = 31922;
export const KIND_TIME_EVENT = 31923;
export const KIND_RSVP = 31925;
export const KIND_RELAY_LIST = 10002;
export const KIND_PROFILE = 0;
export const KIND_HTTP_AUTH = 27235;

const SECONDS_PER_DAY = 86400;
const MAX_D_TAGS = 400;

export type EventTemplate = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedEvent = EventTemplate & { id: string; pubkey: string; sig: string };

export type CalendarInput = {
  d: string;
  title: string;
  summary?: string | null;
  description: string;
  imageUrl?: string | null;
  location?: string | null;
  hashtags?: string[];
  references?: string[];
  startAt: Date;
  endAt: Date;
  timezone: string;
  isAllDay: boolean;
  /** アプリ固有: キャンセル済みを示す status タグ（他クライアントの解釈は保証されない） */
  cancelled?: boolean;
};

export function calendarKind(isAllDay: boolean): number {
  return isAllDay ? KIND_DATE_EVENT : KIND_TIME_EVENT;
}

export function coordinateOf(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey}:${d}`;
}

export function parseCoordinate(a: string): { kind: number; pubkey: string; d: string } | null {
  const m = /^(\d+):([0-9a-f]{64}):(.*)$/.exec(a);
  if (!m) return null;
  return { kind: Number(m[1]), pubkey: m[2]!, d: m[3]! };
}

/** 時刻ベースイベントの D タグ値（開始日〜終了直前の各UTC日） */
export function dayTags(startSec: number, endSec: number): string[] {
  const first = Math.floor(startSec / SECONDS_PER_DAY);
  // end は排他なので end-1 秒が属する日まで。end==start なら開始日のみ
  const last = Math.floor(Math.max(startSec, endSec - 1) / SECONDS_PER_DAY);
  const out: string[] = [];
  for (let day = first; day <= last && out.length < MAX_D_TAGS; day++) out.push(String(day));
  return out;
}

/** 終日イベント: DB の startAt/endAt（tz の 0:00、end は排他）→ NIP-52 の日付 */
export function allDayDates(startAt: Date, endAt: Date, tz: string): { start: string; end: string } {
  const start = utcToZoned(startAt, tz).date;
  const endZ = utcToZoned(endAt, tz);
  // end が 0:00 ちょうどならその日付が排他終了日。そうでなければ翌日
  const end = endZ.time === "00:00" ? endZ.date : addDays(endZ.date, 1);
  return { start, end: end <= start ? addDays(start, 1) : end };
}

/** 終日イベントの日付（両端含む最終日）→ DB 用の UTC 範囲 */
export function allDayRange(startDate: string, lastDateInclusive: string, tz: string): { startAt: Date; endAt: Date } {
  return {
    startAt: zonedToUtc(startDate, "00:00", tz),
    endAt: zonedToUtc(addDays(lastDateInclusive, 1), "00:00", tz),
  };
}

export function buildCalendarEvent(input: CalendarInput, createdAt: number): EventTemplate {
  const kind = calendarKind(input.isAllDay);
  const tags: string[][] = [["d", input.d], ["title", input.title]];
  if (input.summary) tags.push(["summary", input.summary]);
  if (input.imageUrl) tags.push(["image", input.imageUrl]);

  if (input.isAllDay) {
    const { start, end } = allDayDates(input.startAt, input.endAt, input.timezone);
    tags.push(["start", start]);
    // 単日の場合 end は省略可。互換性のため複数日の時だけ付ける
    if (end !== addDays(start, 1)) tags.push(["end", end]);
  } else {
    const start = toUnixSeconds(input.startAt);
    const end = toUnixSeconds(input.endAt);
    tags.push(["start", String(start)]);
    if (end > start) tags.push(["end", String(end)]);
    for (const d of dayTags(start, end)) tags.push(["D", d]);
    tags.push(["start_tzid", input.timezone]);
    tags.push(["end_tzid", input.timezone]);
  }

  if (input.location) tags.push(["location", input.location]);
  for (const t of input.hashtags ?? []) tags.push(["t", t]);
  for (const r of input.references ?? []) tags.push(["r", r]);
  if (input.cancelled) tags.push(["status", "cancelled"]);

  return { kind, created_at: createdAt, tags, content: input.description };
}

export type ParsedCalendarEvent = {
  kind: number;
  pubkey: string;
  d: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  location: string | null;
  hashtags: string[];
  startAt: Date;
  endAt: Date;
  timezone: string | null;
  isAllDay: boolean;
  cancelled: boolean;
  description: string;
  createdAt: number;
};

const firstTag = (tags: string[][], name: string) => tags.find((t) => t[0] === name)?.[1];

export function parseCalendarEvent(ev: SignedEvent): ParsedCalendarEvent | null {
  if (ev.kind !== KIND_DATE_EVENT && ev.kind !== KIND_TIME_EVENT) return null;
  const d = firstTag(ev.tags, "d");
  // title が正。deprecated の name は title が無い場合だけ読む
  const title = firstTag(ev.tags, "title") ?? firstTag(ev.tags, "name");
  const startRaw = firstTag(ev.tags, "start");
  if (d === undefined || !title || !startRaw) return null;
  const endRaw = firstTag(ev.tags, "end");
  const tz = firstTag(ev.tags, "start_tzid") ?? null;

  let startAt: Date;
  let endAt: Date;
  if (ev.kind === KIND_DATE_EVENT) {
    if (!isValidDateString(startRaw)) return null;
    const endDate = endRaw && isValidDateString(endRaw) && endRaw > startRaw ? endRaw : addDays(startRaw, 1);
    // 日付ベースは時刻・TZを持たないので UTC 0:00 として保持する
    startAt = new Date(`${startRaw}T00:00:00Z`);
    endAt = new Date(`${endDate}T00:00:00Z`);
  } else {
    if (!/^\d+$/.test(startRaw)) return null;
    const s = Number(startRaw);
    const e = endRaw && /^\d+$/.test(endRaw) && Number(endRaw) >= s ? Number(endRaw) : s;
    startAt = new Date(s * 1000);
    endAt = new Date(e * 1000);
  }

  return {
    kind: ev.kind,
    pubkey: ev.pubkey,
    d,
    title,
    summary: firstTag(ev.tags, "summary") ?? null,
    imageUrl: firstTag(ev.tags, "image") ?? null,
    location: firstTag(ev.tags, "location") ?? null,
    hashtags: ev.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]!),
    startAt,
    endAt,
    timezone: ev.kind === KIND_DATE_EVENT ? "UTC" : tz,
    isAllDay: ev.kind === KIND_DATE_EVENT,
    cancelled: firstTag(ev.tags, "status") === "cancelled",
    description: ev.content,
    createdAt: ev.created_at,
  };
}

export type RsvpStatus = "accepted" | "declined" | "tentative";

export type RsvpInput = {
  coordinate: string;
  d: string;
  status: RsvpStatus;
  organizerPubkey: string;
  eventId?: string | null;
  note?: string;
};

export function buildRsvp(input: RsvpInput, createdAt: number): EventTemplate {
  const tags: string[][] = [];
  if (input.eventId) tags.push(["e", input.eventId]);
  tags.push(["a", input.coordinate]);
  tags.push(["d", input.d]);
  tags.push(["status", input.status]);
  tags.push(["p", input.organizerPubkey]);
  return { kind: KIND_RSVP, created_at: createdAt, tags, content: input.note ?? "" };
}

export type ParsedRsvp = {
  coordinate: string;
  d: string;
  status: RsvpStatus;
  eventId: string | null;
  organizerPubkey: string | null;
  pubkey: string;
  createdAt: number;
};

export function parseRsvp(ev: SignedEvent): ParsedRsvp | null {
  if (ev.kind !== KIND_RSVP) return null;
  const a = firstTag(ev.tags, "a");
  const d = firstTag(ev.tags, "d");
  const status = firstTag(ev.tags, "status");
  if (!a || d === undefined || !status) return null;
  if (status !== "accepted" && status !== "declined" && status !== "tentative") return null;
  const coord = parseCoordinate(a);
  if (!coord || (coord.kind !== KIND_DATE_EVENT && coord.kind !== KIND_TIME_EVENT)) return null;
  return {
    coordinate: a,
    d,
    status,
    eventId: firstTag(ev.tags, "e") ?? null,
    organizerPubkey: firstTag(ev.tags, "p") ?? null,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
  };
}

/** 署名済みイベントがサーバー側で組み立てた雛形と同一内容かを判定（created_at 以外） */
export function matchesTemplate(signed: SignedEvent, expected: Omit<EventTemplate, "created_at">): boolean {
  if (signed.kind !== expected.kind || signed.content !== expected.content) return false;
  if (signed.tags.length !== expected.tags.length) return false;
  return signed.tags.every((tag, i) => {
    const exp = expected.tags[i]!;
    return tag.length === exp.length && tag.every((v, j) => v === exp[j]);
  });
}

export function randomId(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
