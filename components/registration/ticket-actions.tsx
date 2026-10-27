"use client";

import { RefreshCw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, withSignature } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

export function TicketActions({
  token,
  registrationId,
  canCancel,
  publicRsvp,
  isNostr,
}: {
  token: string;
  registrationId: string;
  canCancel: boolean;
  publicRsvp: string | null;
  isNostr: boolean;
}) {
  const { t } = useT();
  const { user, sign } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<null | "cancel" | "rotate">(null);
  const [withdraw, setWithdraw] = useState(publicRsvp === "accepted");
  const [error, setError] = useState<string | null>(null);

  // 受付済み・承認などの状態変化を反映
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && router.refresh(), 15000);
    return () => clearInterval(id);
  }, [router]);

  async function cancel() {
    if (!confirm(t.ticket.cancelConfirm)) return;
    setBusy("cancel");
    setError(null);
    try {
      await api(`/api/registrations/${registrationId}/cancel`, { body: { ticketToken: token } });
      if (withdraw && isNostr && user) {
        // 公開RSVPも同じ d で declined にする（本人の署名）
        await withSignature(
          (signedEvent) => api(`/api/registrations/${registrationId}/nostr-rsvp`, { body: { status: "declined", signedEvent } }),
          sign,
        ).catch(() => toast({ tone: "info", text: t.login.rejected }));
      }
      toast({ tone: "ok", text: t.ticket.cancelled });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy("rotate");
    try {
      const r = await api<{ ticketUrl: string }>(`/api/registrations/${registrationId}/ticket/rotate`, { body: { ticketToken: token } });
      toast({ tone: "ok", text: t.ticket.rotated });
      router.replace(new URL(r.ticketUrl).pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.unknownError);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger" title={error} />}
      <details className="rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-semibold">{t.ticket.rotate}</summary>
        <p className="my-2 text-sm text-muted">{t.ticket.rotateHint}</p>
        <Button variant="outline" size="sm" onClick={rotate} loading={busy === "rotate"}>
          <RefreshCw className="h-4 w-4" aria-hidden /> {t.ticket.rotate}
        </Button>
      </details>
      {canCancel && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          {publicRsvp === "accepted" && isNostr && user && (
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} />
              {t.ticket.withdrawRsvp}
            </label>
          )}
          <Button variant="outline" className="text-danger" onClick={cancel} loading={busy === "cancel"}>
            <XCircle className="h-4 w-4" aria-hidden /> {t.ticket.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
