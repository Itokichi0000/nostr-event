import { Badge } from "@/components/ui/badge";
import type { Dict } from "@/lib/i18n/dict";

type RegStatus = "pending" | "confirmed" | "waitlisted" | "rejected" | "cancelled";

/** 色だけでなく文言・記号でも区別できるようにする */
export function RegistrationBadge({ status, checkedIn, t }: { status: RegStatus; checkedIn?: boolean; t: Dict }) {
  if (checkedIn) return <Badge tone="info">✓ {t.status.checkedIn}</Badge>;
  const map = {
    pending: { tone: "warn", label: `⏳ ${t.status.pending}` },
    confirmed: { tone: "ok", label: `● ${t.status.confirmed}` },
    waitlisted: { tone: "accent", label: `↻ ${t.status.waitlisted}` },
    rejected: { tone: "neutral", label: t.status.rejected },
    cancelled: { tone: "neutral", label: t.status.cancelled },
  } as const;
  const m = map[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function EventStatusBadge({
  status,
  visibility,
  full,
  t,
}: {
  status: string;
  visibility?: string;
  full?: boolean;
  t: Dict;
}) {
  if (status === "cancelled") return <Badge tone="danger">{t.status.eventCancelled}</Badge>;
  if (status === "ended") return <Badge>{t.status.ended}</Badge>;
  if (status === "draft") return <Badge tone="warn">{t.status.draft}</Badge>;
  if (status === "publishing") return <Badge tone="info">{t.status.publishing}</Badge>;
  return (
    <span className="inline-flex gap-1">
      {visibility === "unlisted_db" && <Badge>{t.status.unlisted}</Badge>}
      {full && <Badge tone="accent">{t.status.full}</Badge>}
    </span>
  );
}
