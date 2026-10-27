import { eq } from "drizzle-orm";
import { CalendarDays, MapPin, Settings2, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { nip19 } from "nostr-tools";
import { Linkified } from "@/components/events/linkified";
import { ShareActions } from "@/components/events/share-actions";
import { EventStatusBadge } from "@/components/events/status-badge";
import { RegisterPanel } from "@/components/registration/register-panel";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getServerSession } from "@/lib/auth/server";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { checkins } from "@/lib/db/schema";
import { fmt } from "@/lib/i18n/dict";
import { getT } from "@/lib/i18n/server";
import { eventStats, getEventBySlug, isPubliclyVisible, naddrFor } from "@/lib/services/events";
import { getMyRegistrationForEvent } from "@/lib/services/registrations";
import { formatEventDate } from "@/lib/time";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const row = await getEventBySlug(slug);
  if (!row) return null;
  const session = await getServerSession();
  const isOwner = session?.accountId === row.event.ownerAccountId;
  if (!isPubliclyVisible(row.event) && !isOwner) return null;
  return { ...row, session, isOwner };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) return { title: "Not found", robots: { index: false } };
  const e = d.event;
  const { locale } = await getT();
  const when = formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale);
  const description = [when, e.location, e.summary].filter(Boolean).join(" ・ ");
  return {
    title: e.title,
    description,
    alternates: { canonical: `/events/${e.slug}` },
    robots: e.visibility === "unlisted_db" ? { index: false, follow: false } : undefined,
    openGraph: { title: e.title, description, type: "website", url: `/events/${e.slug}`, images: e.imageUrl ? [e.imageUrl] : undefined },
    twitter: { card: e.imageUrl ? "summary_large_image" : "summary", title: e.title, description },
  };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const { t, locale } = await getT();
  const e = d.event;
  const stats = await eventStats(getDb(), e.id);
  const full = e.capacity !== null && stats.confirmed >= e.capacity;
  const open = e.status === "published" && new Date() < e.startAt;
  const mineRow = d.session ? await getMyRegistrationForEvent(d.session, e.id) : null;
  const mineCheckin = mineRow ? (await getDb().select().from(checkins).where(eq(checkins.registrationId, mineRow.id)).limit(1))[0] : null;
  const naddr = e.visibility === "public_nostr" && e.status !== "draft" ? naddrFor(e, config.fallbackRelays) : null;
  const hostName = d.ownerName ?? `${nip19.npubEncode(e.ownerPubkey).slice(0, 12)}…`;

  return (
    <article className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-5">
        {e.status === "cancelled" && <Alert tone="danger" title={t.event.cancelledBanner} />}
        {e.status === "ended" && <Alert tone="info" title={t.event.endedBanner} />}
        {e.status === "draft" && <Alert tone="warn" title={t.event.draftBanner} />}
        {e.status === "publishing" && <Alert tone="info" title={t.event.publishingBanner} />}
        {d.isOwner && (
          <Link href={`/dashboard/events/${e.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Settings2 className="h-4 w-4" aria-hidden /> {t.event.manage}
          </Link>
        )}
        {e.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.imageUrl} alt="" className="aspect-[2/1] w-full rounded-3xl border border-border object-cover" referrerPolicy="no-referrer" />
        )}
        <header>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <EventStatusBadge status={e.status} visibility={e.visibility} full={full} t={t} />
            {e.tags.map((tag) => (
              <Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`} className="text-sm font-semibold text-muted hover:text-primary">
                #{tag}
              </Link>
            ))}
          </div>
          <h1 className="text-3xl font-black leading-tight sm:text-4xl">{e.title}</h1>
          {e.summary && <p className="mt-2 text-lg text-muted">{e.summary}</p>}
        </header>

        <dl className="grid gap-3 rounded-2xl border border-border bg-surface p-5">
          <div className="flex gap-3">
            <dt className="sr-only">{t.event.when}</dt>
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <dd className="font-semibold">{formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale)}</dd>
          </div>
          {e.location && (
            <div className="flex gap-3">
              <dt className="sr-only">{t.event.where}</dt>
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <dd className="min-w-0">
                <Linkified text={e.location} className="break-words" />
              </dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="sr-only">{t.event.capacity}</dt>
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <dd data-testid="seats">
              {e.capacity !== null
                ? fmt(t.event.seats, { confirmed: stats.confirmed, capacity: e.capacity })
                : fmt(t.event.seatsUnlimited, { confirmed: stats.confirmed })}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="sr-only">{t.event.host}</dt>
            <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <dd>
              {t.event.host}: <span className="font-semibold">{hostName}</span>
            </dd>
          </div>
        </dl>

        <ShareActions url={`${config.appUrl}/events/${e.slug}`} title={e.title} slug={e.slug} naddr={naddr} />

        {e.description && <Linkified text={e.description} className="prose-text text-[15px] leading-relaxed" />}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <RegisterPanel
          eventId={e.id}
          open={open}
          full={full}
          approvalMode={e.approvalMode}
          allowGuest={e.allowGuest}
          isPublicNostr={e.visibility === "public_nostr" && !!e.latestNostrEventId}
          mine={mineRow ? { id: mineRow.id, status: mineRow.status, checkedIn: !!mineCheckin, publicRsvp: mineRow.publicRsvpStatus } : null}
        />
      </aside>
    </article>
  );
}
