import { CalendarDays, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { EventStatusBadge } from "@/components/events/status-badge";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { formatEventDate } from "@/lib/time";

export type EventCardData = {
  slug: string;
  title: string;
  summary: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  isAllDay: boolean;
  tags: string[];
  status: string;
  capacity: number | null;
  confirmed: number;
  imageUrl: string | null;
};

export function EventCard({ e, t, locale }: { e: EventCardData; t: Dict; locale: string }) {
  const full = e.capacity !== null && e.confirmed >= e.capacity;
  const d = e.startAt;
  return (
    <Link
      href={`/events/${e.slug}`}
      className="group flex overflow-hidden rounded-2xl border border-border bg-surface transition-shadow hover:shadow-md focus-visible:shadow-md"
    >
      <div className="flex w-20 shrink-0 flex-col items-center justify-center bg-primary-soft text-primary sm:w-24" aria-hidden>
        <span className="text-xs font-bold">
          {new Intl.DateTimeFormat(locale, { timeZone: e.timezone, month: "short" }).format(d)}
        </span>
        <span className="text-3xl font-black leading-none">{new Intl.DateTimeFormat(locale, { timeZone: e.timezone, day: "numeric" }).format(d).replace(/\D/g, "")}</span>
        <span className="text-xs font-bold">{new Intl.DateTimeFormat(locale, { timeZone: e.timezone, weekday: "short" }).format(d)}</span>
      </div>
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <EventStatusBadge status={e.status} full={full} t={t} />
          {e.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs font-semibold text-muted">
              #{tag}
            </span>
          ))}
        </div>
        <h3 className="line-clamp-2 text-lg font-bold leading-snug group-hover:underline">{e.title}</h3>
        {e.summary && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{e.summary}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-4 w-4" aria-hidden />
            {formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale)}
          </span>
          {e.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{e.location}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="h-4 w-4" aria-hidden />
            {e.capacity !== null && !full
              ? fmt(t.explore.remaining, { n: e.capacity - e.confirmed })
              : fmt(t.explore.going, { n: e.confirmed })}
          </span>
        </div>
      </div>
    </Link>
  );
}
