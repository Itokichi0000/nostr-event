"use client";

import { useEffect } from "react";
import { AuthProvider, type ClientUser } from "@/components/auth/auth-provider";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n/dict";

export function Providers({ lang, user, children }: { lang: Lang; user: ClientUser | null; children: React.ReactNode }) {
  useEffect(() => {
    // PWA / Web Push 用の Service Worker
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return (
    <I18nProvider lang={lang}>
      <ToastProvider>
        <AuthProvider initialUser={user}>
          <NotificationsProvider>{children}</NotificationsProvider>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
