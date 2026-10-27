import type { Metadata } from "next";
import { EventForm } from "@/components/events/event-form";
import { PageTitle } from "@/components/ui/misc";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.form.createTitle };
}

export default async function CreatePage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>{t.form.createTitle}</PageTitle>
      <EventForm mode={{ kind: "create" }} />
    </div>
  );
}
