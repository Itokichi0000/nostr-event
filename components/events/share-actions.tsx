"use client";

import { CalendarPlus, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

export function ShareActions({ url, title, slug, naddr }: { url: string; title: string; slug: string; naddr: string | null }) {
  const { t } = useT();
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: "ok", text: t.common.copied });
    } catch {
      toast({ tone: "danger", text: url });
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }
    copy();
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={share}>
        <Share2 className="h-4 w-4" aria-hidden /> {t.common.share}
      </Button>
      <Button variant="outline" size="sm" onClick={copy}>
        <Link2 className="h-4 w-4" aria-hidden /> {t.event.copyLink}
      </Button>
      <a href={`/api/ics/${slug}`} download>
        <Button variant="outline" size="sm" tabIndex={-1}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> {t.event.addToCalendar}
        </Button>
      </a>
      {naddr && (
        <a href={`nostr:${naddr}`} className="inline-flex h-9 items-center px-2 text-sm font-semibold text-muted underline-offset-2 hover:underline">
          {t.event.openInNostr}
        </a>
      )}
    </div>
  );
}
