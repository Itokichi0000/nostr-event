// iCalendar (.ics) 生成（カレンダー追加用）
import type { EventRow } from "./db/schema";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateStamp(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p.replace(/-/g, "");
}

/** 75 オクテットで折り返し（RFC 5545） */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(e: EventRow, url: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gather//Nostr Events//JA",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@gather`,
    `DTSTAMP:${utcStamp(new Date())}`,
    e.isAllDay ? `DTSTART;VALUE=DATE:${dateStamp(e.startAt, e.timezone)}` : `DTSTART:${utcStamp(e.startAt)}`,
    e.isAllDay ? `DTEND;VALUE=DATE:${dateStamp(e.endAt, e.timezone)}` : `DTEND:${utcStamp(e.endAt)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc([e.summary, e.description, url].filter(Boolean).join("\n\n"))}`,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    `URL:${url}`,
    e.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(fold).join("\r\n") + "\r\n";
}
