"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoginGate } from "@/components/auth/login-gate";
import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, PageTitle, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import type { NotificationItem } from "@/lib/services/notifications";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const { refresh, lastUpdated } = useNotifications();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: NotificationItem[]; nextCursor: string | null }>("/api/notifications?limit=20");
      setItems(r.items);
      setCursor(r.nextCursor);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load, lastUpdated]);

  if (!user) return <LoginGate />;

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: NotificationItem[]; nextCursor: string | null }>(`/api/notifications?limit=20&cursor=${cursor}`);
      setItems((xs) => [...(xs ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAll() {
    await api("/api/notifications/read", { body: { all: true } });
    await Promise.all([load(), refresh()]);
  }

  async function open(n: NotificationItem) {
    if (!n.readAt) api("/api/notifications/read", { body: { ids: [n.id] } }).then(refresh).catch(() => {});
  }

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        actions={
          items?.some((n) => !n.readAt) && (
            <Button variant="outline" size="sm" onClick={markAll}>
              <CheckCheck className="h-4 w-4" aria-hidden /> {t.notifications.markAllRead}
            </Button>
          )
        }
      >
        {t.notifications.title}
      </PageTitle>
      {error && <Alert tone="danger" title={t.common.networkError} action={<Button size="sm" onClick={load}>{t.common.retry}</Button>} />}
      {items === null ? (
        !error && <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title={t.notifications.empty} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface" data-testid="notification-list">
          {items.map((n) => (
            <li key={n.id}>
              <Link
                href={n.eventId ? (n.type.startsWith("my_") || n.type === "event_cancelled" ? "/dashboard" : `/dashboard/events/${n.eventId}`) : "/notifications"}
                onClick={() => open(n)}
                className={cn("flex gap-3 p-4 hover:bg-surface-2", !n.readAt && "bg-primary-soft/40")}
              >
                <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "未読"} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t.notifications.types[n.type] ?? n.type}</span>
                  {n.eventTitle && <span className="block truncate text-sm text-muted">{n.eventTitle}</span>}
                  <span className="block text-xs text-muted">{fmtTime(n.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={more} loading={loadingMore}>
            {t.notifications.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
