"use client";

import { BellOff, BellRing, Send, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

type Device = { id: string; userAgent: string | null; endpointHash: string; lastSuccessAt: string | null };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceName(ua: string | null): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Linux";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} / ${os}`;
}

export function PushSettings() {
  const { t } = useT();
  const toast = useToast();
  const [support, setSupport] = useState<"checking" | "unsupported" | "ok">("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [vapid, setVapid] = useState<string | null | undefined>(undefined);
  const [current, setCurrent] = useState<PushSubscription | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;

  const refresh = useCallback(async () => {
    setDevices(await api<Device[]>("/api/push/subscriptions").catch(() => []));
    const reg = await navigator.serviceWorker?.getRegistration();
    setCurrent((await reg?.pushManager?.getSubscription()) ?? null);
  }, []);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupport(ok ? "ok" : "unsupported");
    if (ok) setPermission(Notification.permission);
    api<{ publicKey: string | null }>("/api/push/vapid").then((r) => setVapid(r.publicKey), () => setVapid(null));
    refresh();
  }, [refresh]);

  async function enable() {
    if (!vapid) return;
    setBusy("enable");
    try {
      // 許可ダイアログは必ずユーザー操作から出す
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") return;
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) }));
      await api("/api/push/subscribe", { body: sub.toJSON() });
      toast({ tone: "ok", text: t.settings.pushEnabled });
      await refresh();
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  async function disableThis() {
    setBusy("disable");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const mine = devices.find((d) => d.endpointHash && current && current.endpoint === sub.endpoint);
        await sub.unsubscribe();
        if (mine) await api(`/api/push/subscriptions/${mine.id}`, { method: "DELETE" });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/api/push/subscriptions/${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      await api("/api/push/test", { body: {} });
      toast({ tone: "ok", text: t.settings.pushTestSent });
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.push}</CardTitle>
        <p className="text-sm text-muted">{t.settings.pushHint}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {support === "unsupported" && <Alert tone="warn" title={t.settings.pushUnsupported} />}
        {vapid === null && <Alert tone="warn" title={t.settings.pushNotConfigured} />}
        {permission === "denied" && <Alert tone="danger" title={t.settings.pushDenied} />}
        {isIOS && !standalone && (
          <Alert tone="info" title={t.settings.iosGuideTitle}>
            {t.settings.iosGuide}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {current ? (
            <>
              <p className="flex w-full items-center gap-2 font-semibold text-ok">
                <BellRing className="h-5 w-5" aria-hidden /> {t.settings.pushEnabled}
              </p>
              <Button variant="outline" onClick={disableThis} loading={busy === "disable"}>
                <BellOff className="h-4 w-4" aria-hidden /> {t.settings.pushDisable}
              </Button>
            </>
          ) : (
            <Button onClick={enable} loading={busy === "enable"} disabled={support !== "ok" || !vapid || permission === "denied"}>
              <BellRing className="h-4 w-4" aria-hidden /> {t.settings.pushEnable}
            </Button>
          )}
          <Button variant="outline" onClick={test} loading={busy === "test"}>
            <Send className="h-4 w-4" aria-hidden /> {t.settings.pushTest}
          </Button>
        </div>
        {devices.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold">{t.settings.devices}</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 p-3">
                  <Smartphone className="h-5 w-5 text-muted" aria-hidden />
                  <span className="flex-1 text-sm">{deviceName(d.userAgent)}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(d.id)} loading={busy === d.id} aria-label={t.settings.removeDevice}>
                    <Trash2 className="h-4 w-4" aria-hidden /> {t.settings.removeDevice}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">{t.settings.pushNoGuarantee}</p>
      </CardContent>
    </Card>
  );
}
