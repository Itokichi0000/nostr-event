"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import type { NotificationItem } from "@/lib/services/notifications";

type Ctx = { unread: number; latest: NotificationItem[]; refresh: () => Promise<void>; lastUpdated: number };
const C = createContext<Ctx>({ unread: 0, latest: [], refresh: async () => {}, lastUpdated: 0 });

const POLL_MS = 5000;

/**
 * アプリ内通知の軽量ポーリング（V1 は5秒）。将来 SSE/WebSocket に置き換えられるよう、
 * 画面側は useNotifications() の値だけを参照する。
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = useState<{ unread: number; latest: NotificationItem[]; lastUpdated: number }>({
    unread: 0,
    latest: [],
    lastUpdated: 0,
  });
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api<{ items: NotificationItem[]; unreadCount: number }>("/api/notifications?limit=10");
      const known = seen.current;
      if (known) {
        const fresh = r.items.filter((n) => !known.has(n.id) && !n.readAt);
        if (fresh.length) {
          const n = fresh[0]!;
          toast({
            tone: "info",
            text: fresh.length === 1 ? (t.notifications.types[n.type] ?? t.notifications.newToast) : t.notifications.newToast,
            action: { label: t.common.details, onClick: () => router.push(n.eventId ? `/dashboard/events/${n.eventId}` : "/notifications") },
          });
        }
      }
      seen.current = new Set([...(known ?? []), ...r.items.map((n) => n.id)]);
      setState({ unread: r.unreadCount, latest: r.items, lastUpdated: Date.now() });
    } catch {
      // 一時的な通信失敗は次回のポーリングで回復
    }
  }, [user, toast, t, router]);

  useEffect(() => {
    if (!user) {
      seen.current = null;
      setState({ unread: 0, latest: [], lastUpdated: 0 });
      return;
    }
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user, refresh]);

  return <C.Provider value={{ ...state, refresh }}>{children}</C.Provider>;
}

export function useNotifications() {
  return useContext(C);
}
