import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <EmptyState
      icon={<SearchX className="h-8 w-8" />}
      title={t.event.notFound}
      action={
        <Link href="/" className={buttonVariants()}>
          {t.nav.explore}
        </Link>
      }
    >
      {t.event.notFoundHint}
    </EmptyState>
  );
}
