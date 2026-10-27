"use client";

import { Ticket, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { RegistrationBadge } from "@/components/events/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Hint, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, withSignature } from "@/lib/client/api";
import { SignerRejected } from "@/lib/client/signer";
import { useT } from "@/lib/i18n/client";

type RegStatus = "pending" | "confirmed" | "waitlisted" | "rejected" | "cancelled";
type Result = { registrationId: string; status: RegStatus; ticketUrl: string | null; alreadyRegistered: boolean };

/** 通信失敗時の再送で同じキーを使い、二重申込を防ぐ */
function idemKey(eventId: string, mode: string): string {
  const k = `gather.idem.${eventId}.${mode}`;
  try {
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const v = crypto.randomUUID();
    sessionStorage.setItem(k, v);
    return v;
  } catch {
    return crypto.randomUUID();
  }
}
function clearIdem(eventId: string, mode: string) {
  try {
    sessionStorage.removeItem(`gather.idem.${eventId}.${mode}`);
  } catch {}
}

export function RegisterPanel({
  eventId,
  open,
  full,
  approvalMode,
  allowGuest,
  isPublicNostr,
  mine,
}: {
  eventId: string;
  open: boolean;
  full: boolean;
  approvalMode: "auto" | "manual";
  allowGuest: boolean;
  isPublicNostr: boolean;
  mine: { id: string; status: RegStatus; checkedIn: boolean; publicRsvp: string | null } | null;
}) {
  const { t } = useT();
  const { user, login, sign } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "guest">("choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | "nostr" | "guest" | "rsvp" | "ticket">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { mode: "nostr" | "guest" }) | null>(null);
  const [rsvpOn, setRsvpOn] = useState(false);
  const [rsvpDone, setRsvpDone] = useState(mine?.publicRsvp === "accepted");

  const active = mine && ["pending", "confirmed", "waitlisted"].includes(mine.status) ? mine : null;

  async function submit(kind: "nostr" | "guest") {
    setError(null);
    setFieldErr(null);
    if (kind === "guest" && !name.trim()) {
      setFieldErr(t.register.guestName);
      return;
    }
    if (kind === "nostr" && !user && !(await login())) return;
    setBusy(kind);
    try {
      const body =
        kind === "nostr"
          ? { mode: "nostr", idempotencyKey: idemKey(eventId, "nostr") }
          : { mode: "guest", displayName: name.trim(), email: email.trim() || null, idempotencyKey: idemKey(eventId, "guest") };
      const r = await api<Result>(`/api/events/${eventId}/registrations`, { body });
      clearIdem(eventId, kind);
      setResult({ ...r, mode: kind });
      toast({ tone: "ok", text: r.alreadyRegistered && !r.ticketUrl ? t.register.already : t.register.done });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : t.common.networkError);
    } finally {
      setBusy(null);
    }
  }

  async function publishRsvp(registrationId: string) {
    setBusy("rsvp");
    setError(null);
    try {
      await withSignature(
        (signedEvent) => api(`/api/registrations/${registrationId}/nostr-rsvp`, { body: { status: "accepted", signedEvent } }),
        sign,
      );
      setRsvpDone(true);
      toast({ tone: "ok", text: t.register.publicRsvpPublished });
    } catch (e) {
      setRsvpOn(false);
      setError(e instanceof SignerRejected ? t.login.rejected : e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  async function showTicket(registrationId: string) {
    setBusy("ticket");
    try {
      const r = await api<{ ticketUrl: string }>(`/api/registrations/${registrationId}/ticket/rotate`, { body: {} });
      router.push(new URL(r.ticketUrl).pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.unknownError);
      setBusy(null);
    }
  }

  const statusTitle = (s: RegStatus) =>
    s === "confirmed" ? t.register.doneConfirmed : s === "pending" ? t.register.donePending : s === "waitlisted" ? t.register.doneWaitlisted : t.status[s];

  // 申込済み（このセッションでの結果 or ログイン中の既存申込）
  const done = result ?? (active ? { registrationId: active.id, status: active.status, ticketUrl: null, alreadyRegistered: true, mode: "nostr" as const } : null);
  if (done) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <RegistrationBadge status={done.status} checkedIn={active?.checkedIn} t={t} />
          </div>
          <CardTitle className="text-xl" data-testid="registration-result">
            {statusTitle(done.status)}
          </CardTitle>
          {done.status === "pending" && <p className="text-sm text-muted">{t.register.manual}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          {done.ticketUrl ? (
            <>
              <Link href={new URL(done.ticketUrl).pathname} className="block">
                <Button size="lg" className="w-full" tabIndex={-1}>
                  <Ticket className="h-5 w-5" aria-hidden /> {t.register.ticket}
                </Button>
              </Link>
              {done.mode === "guest" && <Alert tone="warn">{t.register.ticketSaveWarning}</Alert>}
            </>
          ) : (
            done.mode === "nostr" && (
              <Button size="lg" className="w-full" loading={busy === "ticket"} onClick={() => showTicket(done.registrationId)}>
                <Ticket className="h-5 w-5" aria-hidden /> {t.register.ticket}
              </Button>
            )
          )}
          {done.mode === "nostr" && isPublicNostr && (
            <div className="rounded-xl border border-border p-3">
              {rsvpDone ? (
                <p className="text-sm font-semibold text-ok">✓ {t.register.publicRsvpPublished}</p>
              ) : (
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 accent-[var(--primary)]"
                    checked={rsvpOn}
                    disabled={busy === "rsvp"}
                    onChange={(e) => {
                      setRsvpOn(e.target.checked);
                      if (e.target.checked) publishRsvp(done.registrationId);
                    }}
                  />
                  <span>
                    <span className="block font-semibold">{t.register.publicRsvpLabel}</span>
                    <span className="block text-sm text-muted">{t.register.publicRsvpHint}</span>
                  </span>
                </label>
              )}
            </div>
          )}
          {error && <Alert tone="danger" title={error} />}
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="font-bold">{t.register.closed}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t.register.title}</CardTitle>
        {full && <p className="text-sm font-semibold text-accent">{t.register.full}</p>}
        {approvalMode === "manual" && <p className="text-sm text-muted">{t.register.manual}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "choose" ? (
          <>
            <Button size="lg" className="w-full" loading={busy === "nostr"} onClick={() => submit("nostr")}>
              <Zap className="h-5 w-5" aria-hidden /> {t.register.withNostr}
            </Button>
            {allowGuest ? (
              <Button size="lg" variant="outline" className="w-full" onClick={() => setMode("guest")}>
                <UserRound className="h-5 w-5" aria-hidden /> {t.register.asGuest}
              </Button>
            ) : (
              <p className="text-center text-sm text-muted">{t.register.guestNotAllowed}</p>
            )}
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit("guest");
            }}
          >
            <div>
              <Label htmlFor="g-name">{t.register.guestName}</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus autoComplete="nickname" aria-invalid={!!fieldErr || undefined} />
              <FieldError>{fieldErr}</FieldError>
            </div>
            <div>
              <Label htmlFor="g-email">{t.register.guestEmail}</Label>
              <Input id="g-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" />
              <Hint>{t.register.guestEmailHint}</Hint>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
                {t.common.back}
              </Button>
              <Button type="submit" size="lg" className="flex-1" loading={busy === "guest"}>
                {t.register.submit}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <Alert
            tone="danger"
            title={error}
            action={
              <Button size="sm" variant="outline" onClick={() => submit(mode === "guest" ? "guest" : "nostr")}>
                {t.common.retry}
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
