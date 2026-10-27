import { CalendarPlus, Search } from "lucide-react";
import Link from "next/link";
import { EventCard } from "@/components/events/event-card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { getT } from "@/lib/i18n/server";
import { listPublicEvents, type ListFilter } from "@/lib/services/events";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t, locale } = await getT();
  const filter: ListFilter = sp.filter === "week" || sp.filter === "past" ? sp.filter : "upcoming";
  const q = sp.q?.trim() || undefined;
  const tag = sp.tag?.trim() || undefined;
  const rows = await listPublicEvents({ q, tag, filter });
  const link = (f: ListFilter) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (tag) p.set("tag", tag);
    if (f !== "upcoming") p.set("filter", f);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div>
      {!q && !tag && filter === "upcoming" && (
        <section className="mb-8 rounded-3xl bg-primary px-6 py-8 text-primary-fg sm:px-10 sm:py-10">
          <h1 className="max-w-xl text-2xl font-black leading-tight sm:text-3xl">{t.explore.hero}</h1>
          <p className="mt-2 max-w-xl opacity-90">{t.explore.heroSub}</p>
          <Link href="/create" className={cn(buttonVariants({ size: "lg" }), "mt-5 bg-surface text-primary hover:bg-surface")}>
            <CalendarPlus className="h-5 w-5" aria-hidden /> {t.nav.create}
          </Link>
        </section>
      )}

      <h2 className="mb-3 text-xl font-extrabold">{t.explore.title}</h2>
      <form action="/" method="get" role="search" className="mb-3 flex gap-2">
        <Input name="q" defaultValue={q} placeholder={t.explore.searchPlaceholder} aria-label={t.explore.searchPlaceholder} />
        {tag && <input type="hidden" name="tag" value={tag} />}
        {filter !== "upcoming" && <input type="hidden" name="filter" value={filter} />}
        <button type="submit" className={buttonVariants({ size: "icon" })} aria-label={t.explore.search}>
          <Search className="h-5 w-5" />
        </button>
      </form>
      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="絞り込み">
        {(["upcoming", "week", "past"] as const).map((f) => (
          <Link
            key={f}
            href={link(f)}
            aria-current={filter === f ? "true" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold",
              filter === f ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-muted hover:text-fg",
            )}
          >
            {t.explore[f]}
          </Link>
        ))}
        {tag && (
          <Link href={q ? `/?q=${encodeURIComponent(q)}` : "/"} className="rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary">
            #{tag} ✕
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title={t.explore.empty}
          action={
            <Link href="/create" className={buttonVariants()}>
              {t.nav.create}
            </Link>
          }
        >
          {t.explore.emptyHint}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.event.id}>
              <EventCard
                t={t}
                locale={locale}
                e={{
                  slug: r.event.slug,
                  title: r.event.title,
                  summary: r.event.summary,
                  location: r.event.location,
                  startAt: r.event.startAt,
                  endAt: r.event.endAt,
                  timezone: r.event.timezone,
                  isAllDay: r.event.isAllDay,
                  tags: r.event.tags,
                  status: r.event.status,
                  capacity: r.event.capacity,
                  confirmed: r.confirmed,
                  imageUrl: r.event.imageUrl,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
