// IANA タイムゾーンと UTC の相互変換（外部ライブラリなし。Intl を利用）

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** tz における UTC からのオフセット（ミリ秒） */
function offsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** "2026-11-07" + "19:00" @ tz → UTC の Date */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const dm = DATE_RE.exec(dateStr);
  const tm = TIME_RE.exec(timeStr);
  if (!dm || !tm) throw new Error(`invalid date/time: ${dateStr} ${timeStr}`);
  const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  // オフセットは時刻に依存する（夏時間）ため2回補正する
  let guess = naive - offsetMs(new Date(naive), tz);
  guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC の Date → tz における { date: "YYYY-MM-DD", time: "HH:mm" } */
export function utcToZoned(date: Date, tz: string): { date: string; time: string } {
  const p = partsInZone(date, tz);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** "YYYY-MM-DD" に日数を加算 */
export function addDays(dateStr: string, days: number): string {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatEventDate(start: Date, end: Date, tz: string, isAllDay: boolean, locale = "ja-JP"): string {
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
  if (isAllDay) {
    // 終日イベントの end は翌日 0:00（排他）なので1ms戻して最終日を表示
    const last = new Date(end.getTime() - 1);
    const s = dateFmt.format(start);
    const e = dateFmt.format(last);
    return s === e ? s : `${s} – ${e}`;
  }
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const sameDay = utcToZoned(start, tz).date === utcToZoned(end, tz).date;
  const tzLabel = tz === DEFAULT_TIMEZONE && locale.startsWith("ja") ? "" : ` (${tz})`;
  if (sameDay) return `${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}${tzLabel}`;
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}${tzLabel}`;
}

export const COMMON_TIMEZONES = [
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Costa_Rica",
  "Pacific/Auckland",
  "UTC",
];
