"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { SimplePool } from "nostr-tools/pool";
import { useEffect, useState } from "react";
import { Linkified } from "@/components/events/linkified";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useT } from "@/lib/i18n/client";
import { parseCalendarEvent, type ParsedCalendarEvent, type SignedEvent } from "@/lib/nostr/nip52";
import { formatEventDate } from "@/lib/time";

type Pointer = { kind: number; pubkey: string; identifier: string; relays: string[] };

/** Gather 外の NIP-52 イベントをブラウザーからリレーで読み取り、閲覧のみ提供する */
export function ExternalEvent({ pointer }: { pointer: Pointer | null }) {
  const { t, locale } = useT();
  const [state, setState] = useState<"loading" | "notfound" | ParsedCalendarEvent>(pointer ? "loading" : "notfound");

  useEffect(() => {
    if (!pointer) return;
    const defaults = (process.env.NEXT_PUBLIC_NOSTR_READ_RELAYS ?? "wss://relay.damus.io,wss://nos.lol").split(",").map((s) => s.trim());
    const relays = [...new Set([...pointer.relays, ...defaults].filter((r) => r.startsWith("wss://")))].slice(0, 4);
    const pool = new SimplePool();
    let cancelled = false;
    pool
      .querySync(relays, { kinds: [pointer.kind], authors: [pointer.pubkey], "#d": [pointer.identifier] }, { maxWait: 5000 })
      .then((evs) => {
        if (cancelled) return;
        const latest = evs.sort((a, b) => b.created_at - a.created_at)[0];
        const parsed = latest ? parseCalendarEvent(latest as SignedEvent) : null;
        setState(parsed ?? "notfound");
      })
      .catch(() => !cancelled && setState("notfound"))
      .finally(() => pool.destroy());
    return () => {
      cancelled = true;
    };
  }, [pointer]);

  if (state === "loading") return <Spinner label={t.common.loading} />;
  if (state === "notfound") return <EmptyState title={t.event.notFound}>{t.event.notFoundHint}</EmptyState>;
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <Alert tone="info" title={t.event.externalTitle}>
        {t.event.externalHint}
      </Alert>
      <h1 className="text-3xl font-black">{state.title}</h1>
      {state.summary && <p className="text-lg text-muted">{state.summary}</p>}
      <p className="flex items-center gap-2 font-semibold">
        <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
        {formatEventDate(state.startAt, state.endAt, state.timezone ?? "UTC", state.isAllDay, locale)}
      </p>
      {state.location && (
        <p className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" aria-hidden />
          {state.location}
        </p>
      )}
      {state.description && <Linkified text={state.description} className="prose-text" />}
    </article>
  );
}
