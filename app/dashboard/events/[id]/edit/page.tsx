import { notFound } from "next/navigation";
import { LoginGate } from "@/components/auth/login-gate";
import { EventForm } from "@/components/events/event-form";
import { PageTitle } from "@/components/ui/misc";
import { isUuid } from "@/lib/api-context";
import { getServerSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { eventToForm, getOwnedEvent } from "@/lib/services/events";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const s = await getServerSession();
  if (!s) return <LoginGate />;
  if (!isUuid(id)) notFound();
  const e = await getOwnedEvent(s, id).catch(() => null);
  if (!e) notFound();
  const f = eventToForm(e);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>{t.form.editTitle}</PageTitle>
      <EventForm
        mode={{ kind: "edit", id: e.id, status: e.status }}
        initial={{ ...f, summary: f.summary, imageUrl: f.imageUrl, location: f.location }}
      />
    </div>
  );
}
