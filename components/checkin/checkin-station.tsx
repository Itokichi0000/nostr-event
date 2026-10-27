"use client";

import { Camera, CameraOff, CheckCircle2, Clock, Search, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { fmt } from "@/lib/i18n/dict";
import { useT } from "@/lib/i18n/client";
import type { CheckinResult } from "@/lib/services/checkin";
import { cn } from "@/lib/utils";

type Attendee = { id: string; displayName: string; checkedInAt: string | null };

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

export function CheckinStation({ eventId, title }: { eventId: string; title: string }) {
  const { t, locale } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(false);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "error">("off");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [manual, setManual] = useState("");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Attendee[]>([]);
  const [counts, setCounts] = useState<{ checkedIn: number; confirmed: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const loadCounts = useCallback(async () => {
    try {
      const d = await api<{ stats: { checkedIn: number; confirmed: number } }>(`/api/events/${eventId}/dashboard`);
      setCounts({ checkedIn: d.stats.checkedIn, confirmed: d.stats.confirmed });
    } catch {}
  }, [eventId]);

  useEffect(() => {
    loadCounts();
    const id = setInterval(loadCounts, 5000);
    return () => clearInterval(id);
  }, [loadCounts]);

  const submit = useCallback(
    async (body: { token: string } | { registrationId: string }) => {
      setSubmitting(true);
      pausedRef.current = true;
      try {
        const r = await api<CheckinResult>(`/api/events/${eventId}/checkin`, { body });
        setResult(r);
        if (navigator.vibrate) navigator.vibrate(r.result === "ok" ? 80 : [60, 60, 60]);
        if (r.result === "ok") loadCounts();
      } catch (e) {
        setResult({ result: "invalid", reason: "unknown_ticket" });
        console.warn(e);
      } finally {
        setSubmitting(false);
        // 結果を見せたあと次のQRを読める状態に戻す
        setTimeout(() => {
          pausedRef.current = false;
        }, 1800);
      }
    },
    [eventId, loadCounts],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCamera("off");
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamera("on");
      const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const tick = async () => {
        if (!streamRef.current) return;
        if (!pausedRef.current && video.readyState >= 2) {
          let value: string | null = null;
          try {
            if (detector) {
              value = (await detector.detect(video))[0]?.rawValue ?? null;
            } else if (jsQR && canvasRef.current) {
              const c = canvasRef.current;
              const w = (c.width = Math.min(video.videoWidth, 640));
              const h = (c.height = Math.round((video.videoHeight / video.videoWidth) * w));
              const ctx = c.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(video, 0, 0, w, h);
              value = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
            }
          } catch {}
          const last = lastRef.current;
          // 同じQRを数秒以内に連続で読んだ場合は送らない（サーバー側でも二重受付はしない）
          if (value && !(last && last.value === value && Date.now() - last.at < 4000)) {
            lastRef.current = { value, at: Date.now() };
            submit({ token: value });
          }
        }
        setTimeout(() => requestAnimationFrame(tick), 150);
      };
      tick();
    } catch {
      setCamera("error");
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      setPeople(await api<Attendee[]>(`/api/events/${eventId}/attendees?q=${encodeURIComponent(q)}`));
    } catch {}
  }

  const view = (() => {
    if (!result) return null;
    switch (result.result) {
      case "ok":
        return { tone: "ok", Icon: CheckCircle2, text: fmt(t.checkin.ok, { name: result.displayName }) };
      case "already":
        return { tone: "warn", Icon: Clock, text: `${result.displayName}: ${fmt(t.checkin.already, { time: time(result.checkedInAt) })}` };
      case "not_confirmed":
        return { tone: "danger", Icon: XCircle, text: fmt(t.checkin.notConfirmed, { name: result.displayName, status: t.status[result.status as "pending"] ?? result.status }) };
      case "outside_window":
        return { tone: "danger", Icon: Clock, text: fmt(t.checkin.outsideWindow, { from: dateTime(result.opensAt), to: dateTime(result.closesAt) }) };
      case "event_cancelled":
        return { tone: "danger", Icon: XCircle, text: t.checkin.eventCancelled };
      default:
        return { tone: "danger", Icon: XCircle, text: result.reason === "revoked_ticket" ? t.checkin.revoked : t.checkin.invalid };
    }
  })();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <Link href={`/dashboard/events/${eventId}`} className="text-sm font-semibold text-muted hover:underline">
          ← {title}
        </Link>
        <h1 className="text-2xl font-extrabold">{t.checkin.title}</h1>
        {counts && (
          <p className="mt-1 text-lg font-bold tabular-nums text-primary" data-testid="checkin-count">
            {fmt(t.checkin.count, { n: counts.checkedIn, total: counts.confirmed })}
          </p>
        )}
      </div>

      <div
        aria-live="assertive"
        className={cn(
          "flex min-h-24 items-center gap-3 rounded-3xl border-2 p-5 text-xl font-extrabold transition-colors",
          !view && "border-dashed border-border text-muted",
          view?.tone === "ok" && "border-ok bg-ok-soft text-ok",
          view?.tone === "warn" && "border-warn bg-warn-soft text-warn",
          view?.tone === "danger" && "border-danger bg-danger-soft text-danger",
        )}
        data-testid="checkin-result"
      >
        {view ? (
          <>
            <view.Icon className="h-9 w-9 shrink-0" aria-hidden />
            <span>{view.text}</span>
          </>
        ) : (
          <span className="text-base font-semibold">{t.checkin.scan}</span>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className={cn("relative bg-black", camera === "on" ? "aspect-square" : "hidden")}>
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-white/80" aria-hidden />
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <CardContent className="space-y-3 pt-5">
          {camera === "on" ? (
            <Button variant="outline" className="w-full" onClick={stopCamera}>
              <CameraOff className="h-5 w-5" aria-hidden /> {t.checkin.stopCamera}
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={startCamera} loading={camera === "starting"}>
              <Camera className="h-5 w-5" aria-hidden /> {t.checkin.scan}
            </Button>
          )}
          {camera === "error" && <Alert tone="warn" title={t.checkin.cameraError} />}
          <p className="text-xs text-muted">{t.checkin.identityHint}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) submit({ token: manual.trim() }).then(() => setManual(""));
            }}
          >
            <Label htmlFor="manual">{t.checkin.manualInput}</Label>
            <div className="flex gap-2">
              <Input id="manual" value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" spellCheck={false} />
              <Button type="submit" loading={submitting} disabled={!manual.trim()}>
                {t.checkin.manualSubmit}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <form onSubmit={search}>
            <Label htmlFor="q">{t.checkin.search}</Label>
            <div className="flex gap-2">
              <Input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.checkin.searchPlaceholder} />
              <Button type="submit" variant="outline" size="icon" aria-label={t.checkin.search}>
                <Search className="h-5 w-5" />
              </Button>
            </div>
          </form>
          {people.length > 0 && (
            <ul className="divide-y divide-border">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex-1 font-semibold">{p.displayName}</span>
                  {p.checkedInAt ? (
                    <span className="text-sm text-muted">✓ {time(p.checkedInAt)}</span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await submit({ registrationId: p.id });
                        search();
                      }}
                    >
                      {t.checkin.checkinButton}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
