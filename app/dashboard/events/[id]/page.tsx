import { notFound } from "next/navigation";
import { LoginGate } from "@/components/auth/login-gate";
import { EventManager } from "@/components/events/event-manager";
import { isUuid } from "@/lib/api-context";
import { getServerSession } from "@/lib/auth/server";
import { config } from "@/lib/config";
import { getT } from "@/lib/i18n/server";
import { getOwnedEvent, naddrFor } from "@/lib/services/events";
import { checkinWindow } from "@/lib/services/checkin";
import { formatEventDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ManageEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  const { locale } = await getT();
  const s = await getServerSession();
  if (!s) return <LoginGate />;
  if (!isUuid(id)) notFound();
  const e = await getOwnedEvent(s, id).catch(() => null);
  if (!e) notFound();
  const w = checkinWindow(e);
  const now = Date.now();
  return (
    <EventManager
      justCreated={created === "1"}
      event={{
        id: e.id,
        slug: e.slug,
        title: e.title,
        when: formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale),
        visibility: e.visibility,
        url: `${config.appUrl}/events/${e.slug}`,
        naddr: e.visibility === "public_nostr" && e.latestNostrEventId ? naddrFor(e, config.fallbackRelays) : null,
        checkinOpen: now >= w.opensAt.getTime() && now <= w.closesAt.getTime(),
      }}
    />
  );
}
