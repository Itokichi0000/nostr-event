"use client";

import { Ban, CheckCheck, ExternalLink, Pencil, QrCode, RefreshCw, Send, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { ShareActions } from "@/components/events/share-actions";
import { EventStatusBadge, RegistrationBadge } from "@/components/events/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Spinner, Stat } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, templateFromError } from "@/lib/client/api";
import { SignerRejected } from "@/lib/client/signer";
import { fmt } from "@/lib/i18n/dict";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type RegStatus = "pending" | "confirmed" | "waitlisted" | "rejected" | "cancelled";
type Dash = {
  event: { id: string; status: string; capacity: number | null; nostrPublishState: string | null; approvalMode: string };
  stats: { confirmed: number; pending: number; waitlisted: number; cancelled: number; rejected: number; checkedIn: number; externalRsvps: number };
  relays: { relayUrl: string; status: string; lastError: string | null }[];
  registrations: {
    id: string;
    source: "app_nostr" | "app_guest";
    status: RegStatus;
    displayName: string;
    email: string | null;
    npub: string | null;
    publicRsvp: string | null;
    createdAt: string;
    checkedInAt: string | null;
  }[];
  externalRsvps: { npub: string; displayName: string; intent: string; seenAt: string; refersToOldVersion: boolean }[];
};

type Props = {
  justCreated: boolean;
  event: { id: string; slug: string; title: string; when: string; visibility: string; url: string; naddr: string | null; checkinOpen: boolean };
};

export function EventManager({ event, justCreated }: Props) {
  const { t, locale } = useT();
  const { sign } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { lastUpdated } = useNotifications();
  const [data, setData] = useState<Dash | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"attendees" | "waitlist" | "external">("attendees");
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Dash>(`/api/events/${event.id}/dashboard`));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [event.id]);

  // 開いている間は5秒ごとに更新（通知ポーリングと同期して新着をすぐ反映）
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (lastUpdated) load();
  }, [lastUpdated, load]);

  async function decide(id: string, action: "approve" | "reject") {
    if (action === "reject" && !confirm(t.dashboard.rejectConfirm)) return;
    setBusy(id);
    try {
      const r = await api<{ status: RegStatus }>(`/api/registrations/${id}/status`, { method: "PATCH", body: { action } });
      toast({ tone: r.status === "waitlisted" ? "info" : "ok", text: t.status[r.status] });
      await load();
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  async function publishNow() {
    setBusy("publish");
    try {
      try {
        await api(`/api/events/${event.id}/publish`, { body: {} });
      } catch (e) {
        const tpl = templateFromError(e);
        if (!tpl) throw e;
        await api(`/api/events/${event.id}/publish`, { body: { signedEvent: await sign(tpl) } });
      }
      toast({ tone: "ok", text: t.form.published });
      await load();
      router.refresh();
    } catch (e) {
      toast({ tone: "danger", text: e instanceof SignerRejected ? t.form.signCancelled : e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  async function retryPublish() {
    setBusy("retry");
    try {
      await api(`/api/events/${event.id}/publish`, { body: { retry: true } });
      await load();
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  async function cancelEvent(reflectOnNostr: boolean) {
    setBusy("cancel");
    try {
      if (!reflectOnNostr) {
        await api(`/api/events/${event.id}/cancel`, { body: { skipNostr: true } });
      } else {
        try {
          await api(`/api/events/${event.id}/cancel`, { body: {} });
        } catch (e) {
          const tpl = templateFromError(e);
          if (!tpl) throw e;
          let signed;
          try {
            signed = await sign(tpl);
          } catch {
            // 署名を断られても中止自体は行う
            await api(`/api/events/${event.id}/cancel`, { body: { skipNostr: true } });
            signed = null;
          }
          if (signed) await api(`/api/events/${event.id}/cancel`, { body: { signedEvent: signed } });
        }
      }
      setCancelOpen(false);
      toast({ tone: "ok", text: t.dashboard.eventCancelled });
      await load();
      router.refresh();
    } catch (e) {
      toast({ tone: "danger", text: e instanceof ApiClientError ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  if (!data) return loadError ? <Alert tone="danger" title={t.common.networkError} action={<Button size="sm" onClick={load}>{t.common.retry}</Button>} /> : <Spinner />;

  const { stats, event: ev } = data;
  const isPublic = event.visibility === "public_nostr";
  const cancelled = ev.status === "cancelled";
  const pending = data.registrations.filter((r) => r.status === "pending");
  const waitlist = data.registrations.filter((r) => r.status === "waitlisted");
  const attendees = data.registrations.filter((r) => r.status !== "waitlisted");

  const todos: { tone: "warn" | "info" | "danger" | "ok"; text: string; action?: React.ReactNode }[] = [];
  if (isPublic && (ev.status === "draft" || ev.nostrPublishState === "failed")) {
    todos.push({
      tone: "danger",
      text: ev.status === "draft" ? t.event.draftBanner : t.dashboard.todoPublishFailed,
      action:
        ev.status === "draft" ? (
          <Button size="sm" onClick={publishNow} loading={busy === "publish"}>
            <Send className="h-4 w-4" aria-hidden /> {t.dashboard.publishNow}
          </Button>
        ) : (
          <Button size="sm" onClick={retryPublish} loading={busy === "retry"}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {t.dashboard.publishRetry}
          </Button>
        ),
    });
  }
  if (pending.length) todos.push({ tone: "warn", text: fmt(t.dashboard.todoPending, { n: pending.length }) });
  if (event.checkinOpen && !cancelled) {
    todos.push({
      tone: "info",
      text: t.dashboard.todoCheckin,
      action: (
        <Link href={`/dashboard/events/${event.id}/checkin`} className={buttonVariants({ size: "sm" })}>
          <QrCode className="h-4 w-4" aria-hidden /> {t.dashboard.openCheckin}
        </Link>
      ),
    });
  }
  if (!todos.length && !cancelled && stats.confirmed === 0) todos.push({ tone: "info", text: t.dashboard.todoShare });

  const publishLabel =
    ev.nostrPublishState === "success"
      ? t.dashboard.publishOk
      : ev.nostrPublishState === "partial"
        ? t.dashboard.publishPartial
        : ev.nostrPublishState === "failed"
          ? t.dashboard.publishFailed
          : ev.status === "draft"
            ? t.status.draft
            : t.dashboard.publishPending;

  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-1.5">
            <EventStatusBadge status={ev.status} visibility={event.visibility} t={t} />
          </div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{event.title}</h1>
          <p className="text-muted">{event.when}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cancelled && (
            <Link href={`/dashboard/events/${event.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Pencil className="h-4 w-4" aria-hidden /> {t.common.edit}
            </Link>
          )}
          <Link href={`/events/${event.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ExternalLink className="h-4 w-4" aria-hidden /> {t.event.viewPage}
          </Link>
        </div>
      </div>

      {justCreated && (
        <Alert tone="ok" title={t.form.published}>
          <p className="mb-2 break-all font-mono text-xs">{event.url}</p>
          <ShareActions url={event.url} title={event.title} slug={event.slug} naddr={event.naddr} />
        </Alert>
      )}

      <section aria-label="集計" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.dashboard.confirmed} tone="ok" value={<span data-testid="stat-confirmed">{stats.confirmed}{ev.capacity ? <span className="text-lg text-muted"> / {ev.capacity}</span> : null}</span>} />
        <Stat label={t.dashboard.pending} tone="warn" value={<span data-testid="stat-pending">{stats.pending}</span>} />
        <Stat label={t.dashboard.checkedIn} tone="info" value={<span data-testid="stat-checkedin">{stats.checkedIn}</span>} />
        <Stat label={t.dashboard.waitlisted} tone="primary" value={stats.waitlisted} sub={stats.externalRsvps ? `${t.dashboard.external}: ${stats.externalRsvps}` : undefined} />
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.dashboard.nextTodo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {todos.length ? (
            todos.map((td, i) => <Alert key={i} tone={td.tone} title={td.text} action={td.action} />)
          ) : (
            <p className="text-sm text-muted">{t.dashboard.todoNothing}</p>
          )}
          {!cancelled && (
            <Link href={`/dashboard/events/${event.id}/checkin`} className={cn(buttonVariants({ size: "lg" }), "mt-2 w-full")}>
              <QrCode className="h-5 w-5" aria-hidden /> {t.dashboard.openCheckin}
            </Link>
          )}
        </CardContent>
      </Card>

      <div>
        <div role="tablist" aria-label={t.dashboard.tabs.attendees} className="mb-3 flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1">
          {(
            [
              ["attendees", `${t.dashboard.tabs.attendees} (${attendees.length})`],
              ["waitlist", `${t.dashboard.tabs.waitlist} (${waitlist.length})`],
              ...(isPublic ? [["external", `${t.dashboard.tabs.external} (${data.externalRsvps.length})`]] : []),
            ] as [typeof tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold", tab === k ? "bg-surface shadow-sm" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mb-2 text-xs text-muted">{t.dashboard.updatedLive}</p>

        {tab === "external" ? (
          <div className="space-y-2">
            <Alert tone="info">{t.dashboard.externalHint}</Alert>
            {data.externalRsvps.length === 0 ? (
              <EmptyState title={t.dashboard.noAttendees} />
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {data.externalRsvps.map((x) => (
                  <li key={x.npub} className="flex items-center gap-3 p-3.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{x.displayName}</span>
                    {x.refersToOldVersion && <Badge>{t.dashboard.oldVersion}</Badge>}
                    <Badge tone={x.intent === "accepted" ? "ok" : x.intent === "tentative" ? "warn" : "neutral"}>{x.intent}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          (() => {
            const rows = tab === "waitlist" ? waitlist : attendees;
            if (!rows.length) return <EmptyState title={t.dashboard.noAttendees} />;
            return (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface" data-testid="attendee-list">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.displayName}</p>
                      <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{r.source === "app_guest" ? t.common.guest : t.common.nostrUser}</span>
                        {r.email && (
                          <span>
                            {t.dashboard.email}: {r.email}
                          </span>
                        )}
                        {r.publicRsvp === "accepted" && <span>{t.dashboard.linkedRsvp}</span>}
                        {r.checkedInAt && <span>✓ {time(r.checkedInAt)}</span>}
                      </p>
                    </div>
                    <RegistrationBadge status={r.status} checkedIn={!!r.checkedInAt} t={t} />
                    {(r.status === "pending" || r.status === "waitlisted") && !cancelled && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => decide(r.id, "approve")} loading={busy === r.id}>
                          <UserCheck className="h-4 w-4" aria-hidden /> {t.dashboard.approve}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(r.id, "reject")} disabled={busy === r.id}>
                          <X className="h-4 w-4" aria-hidden /> {t.dashboard.reject}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()
        )}
      </div>

      {isPublic && (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-bold">
            {t.dashboard.relayStatus}: <span className="font-normal">{publishLabel}</span>
          </summary>
          <ul className="mt-3 space-y-1 text-sm">
            {data.relays.map((r) => (
              <li key={r.relayUrl} className="flex items-center gap-2">
                {r.status === "ok" ? <CheckCheck className="h-4 w-4 text-ok" aria-hidden /> : <X className="h-4 w-4 text-danger" aria-hidden />}
                <span className="font-mono">{r.relayUrl}</span>
                {r.lastError && <span className="truncate text-muted">({r.lastError})</span>}
              </li>
            ))}
          </ul>
          {ev.nostrPublishState && ev.nostrPublishState !== "success" && ev.status !== "draft" && (
            <Button size="sm" variant="outline" className="mt-3" onClick={retryPublish} loading={busy === "retry"}>
              <RefreshCw className="h-4 w-4" aria-hidden /> {t.dashboard.publishRetry}
            </Button>
          )}
        </details>
      )}

      {!cancelled && (
        <div className="border-t border-border pt-6">
          <Button variant="outline" className="text-danger" onClick={() => setCancelOpen(true)}>
            <Ban className="h-4 w-4" aria-hidden /> {t.dashboard.cancelEvent}
          </Button>
        </div>
      )}

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t.dashboard.cancelEvent}>
        <p className="mb-4">{t.dashboard.cancelEventConfirm}</p>
        {isPublic && ev.status !== "draft" && <p className="mb-4 text-sm text-muted">{t.dashboard.cancelNostrAsk}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {isPublic && ev.status !== "draft" ? (
            <>
              <Button variant="danger" loading={busy === "cancel"} onClick={() => cancelEvent(true)}>
                {t.dashboard.cancelWithNostr}
              </Button>
              <Button variant="outline" disabled={busy === "cancel"} onClick={() => cancelEvent(false)}>
                {t.dashboard.cancelAppOnly}
              </Button>
            </>
          ) : (
            <Button variant="danger" loading={busy === "cancel"} onClick={() => cancelEvent(false)}>
              {t.dashboard.cancelEvent}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setCancelOpen(false)}>
            {t.common.cancel}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
