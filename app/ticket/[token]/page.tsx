import { CalendarDays, MapPin, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { RegistrationBadge } from "@/components/events/status-badge";
import { TicketActions } from "@/components/registration/ticket-actions";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { fmt } from "@/lib/i18n/dict";
import { getT } from "@/lib/i18n/server";
import { getTicketView, ticketUrl } from "@/lib/services/registrations";
import { formatEventDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ticket", robots: { index: false, follow: false } };

// チケットURLは秘密の bearer トークン。外部リソース・解析タグを置かず、Referrer も送らない（next.config）
export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getT();
  const view = await getTicketView(token);

  if (view.state === "not_found") return <EmptyState title={t.ticket.notFound} />;
  if (view.state === "revoked")
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="warn" title={t.ticket.revoked}>
          {t.ticket.revokedHint}
        </Alert>
      </div>
    );

  const e = view.event!;
  const r = view.registration!;
  const checkedIn = !!r.checkedInAt;
  const usable = r.status === "confirmed" && e.status !== "cancelled";
  // QR は個人情報を含まず、チケットURL（トークン）だけを表す。サーバーで SVG を生成
  const svg = usable ? await QRCode.toString(ticketUrl(token), { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-primary px-5 py-4 text-primary-fg">
          <p className="text-xs font-bold opacity-80">{t.ticket.title}</p>
          <h1 className="text-xl font-extrabold leading-snug">{e.title}</h1>
        </div>
        <CardContent className="space-y-4 pt-5">
          {e.status === "cancelled" && <Alert tone="danger" title={t.ticket.eventCancelled} />}
          <div className="flex items-center justify-between gap-2">
            <p className="text-lg font-bold">{r.displayName}</p>
            <RegistrationBadge status={r.status} checkedIn={checkedIn} t={t} />
          </div>
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
              {formatEventDate(e.startAt, e.endAt, e.timezone, e.isAllDay, locale)}
            </p>
            {e.location && (
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {e.location}
              </p>
            )}
          </div>

          {checkedIn ? (
            <Alert tone="ok" title={fmt(t.ticket.checkedIn, { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(r.checkedInAt!)) })} />
          ) : svg ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-full max-w-72 rounded-2xl border border-border bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
                role="img"
                aria-label="QR"
                data-testid="ticket-qr"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <p className="text-center text-sm font-semibold">{t.ticket.showAtEntrance}</p>
            </div>
          ) : (
            e.status !== "cancelled" && <Alert tone="info" title={t.ticket.notValidYet} />
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldAlert className="h-4 w-4" aria-hidden /> {t.ticket.keepSecret}
          </p>
        </CardContent>
      </Card>

      {r.status !== "cancelled" && r.status !== "rejected" && e.status !== "cancelled" && (
        <TicketActions
          token={token}
          registrationId={r.id}
          canCancel={!checkedIn}
          publicRsvp={r.publicRsvpStatus}
          isNostr={r.source === "app_nostr"}
        />
      )}
      <p className="text-center">
        <Link href={`/events/${e.slug}`} className="text-sm font-semibold text-primary hover:underline">
          {e.title} →
        </Link>
      </p>
    </div>
  );
}
