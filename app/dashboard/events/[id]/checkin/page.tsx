import { notFound } from "next/navigation";
import { LoginGate } from "@/components/auth/login-gate";
import { CheckinStation } from "@/components/checkin/checkin-station";
import { isUuid } from "@/lib/api-context";
import { getServerSession } from "@/lib/auth/server";
import { getOwnedEvent } from "@/lib/services/events";

export const dynamic = "force-dynamic";

export default async function CheckinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getServerSession();
  if (!s) return <LoginGate />;
  if (!isUuid(id)) notFound();
  const e = await getOwnedEvent(s, id).catch(() => null);
  if (!e) notFound();
  return <CheckinStation eventId={e.id} title={e.title} />;
}
