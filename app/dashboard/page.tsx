import { CalendarPlus, ChevronRight, Ticket } from "lucide-react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/login-gate";
import { EventStatusBadge, RegistrationBadge } from "@/components/events/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageTitle } from "@/components/ui/misc";
import { getServerSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { listOwnedEvents } from "@/lib/services/events";
import { listMyRegistrations } from "@/lib/services/registrations";
import { formatEventDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { t, locale } = await getT();
  const s = await getServerSession();
  if (!s) return <LoginGate />;
  const [owned, mine] = await Promise.all([listOwnedEvents(s.accountId), listMyRegistrations(s)]);
  const now = Date.now();
  const upcoming = owned.filter((o) => o.event.endAt.getTime() > now - 86400_000);
  const past = owned.filter((o) => o.event.endAt.getTime() <= now - 86400_000);

  return (
    <div className="space-y-10">
      <PageTitle
        actions={
          <Link href="/create" className={buttonVariants()}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> {t.nav.create}
          </Link>
        }
      >
        {t.dashboard.title}
      </PageTitle>

      <section aria-labelledby="hosting">
        <h2 id="hosting" className="mb-3 text-lg font-extrabold">
          {t.dashboard.hosting}
        </h2>
        {owned.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus className="h-8 w-8" />}
            title={t.dashboard.noHosting}
            action={
              <Link href="/create" className={buttonVariants()}>
                {t.nav.create}
              </Link>
            }
          >
            {t.dashboard.noHostingHint}
          </EmptyState>
        ) : (
          <ul className="grid gap-3">
            {[...upcoming, ...past].map(({ event: e, confirmed, pending, checkedIn }) => (
              <li key={e.id}>
                <Link
                  href={`/dashboard/events/${e.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 hover:shadow-md"
                  data-testid="owned-event"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      <EventStatusBadge status={e.status} visibility={e.visibility} t={t} />
                      {pending > 0 && (
                        <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn">
                          {t.dashboard.pending} {pending}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-bold">{e.title}</p>
                    <p className="text-sm text-muted">{formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale)}</p>
                  </div>
                  <div className="hidden gap-5 text-center sm:flex">
                    <div>
                      <p className="text-xl font-extrabold tabular-nums text-ok">
                        {confirmed}
                        {e.capacity ? <span className="text-sm text-muted">/{e.capacity}</span> : null}
                      </p>
                      <p className="text-xs text-muted">{t.dashboard.confirmed}</p>
                    </div>
                    <div>
                      <p className="text-xl font-extrabold tabular-nums text-info">{checkedIn}</p>
                      <p className="text-xs text-muted">{t.dashboard.checkedIn}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="attending">
        <h2 id="attending" className="mb-3 text-lg font-extrabold">
          {t.dashboard.attending}
        </h2>
        {mine.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-muted">{t.dashboard.noAttending}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.map((r) => (
              <li key={r.id}>
                <Link href={`/events/${r.slug}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:shadow-md">
                  <Ticket className="h-6 w-6 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <RegistrationBadge status={r.status} checkedIn={!!r.checkedInAt} t={t} />
                    <p className="truncate font-bold">{r.title}</p>
                    <p className="text-sm text-muted">{formatEventDate(r.startAt, r.endAt, r.timezone, r.isAllDay, locale)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
