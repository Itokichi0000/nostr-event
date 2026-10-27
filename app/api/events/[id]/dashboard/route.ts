import { errors, ok, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { relayPublishAttempts } from "@/lib/db/schema";
import { eventStats, getOwnedEvent } from "@/lib/services/events";
import { listRegistrationsForOwner } from "@/lib/services/registrations";
import { eq } from "drizzle-orm";

// 主催者画面の5秒ポーリング用（集計・一覧・公開状態）
export const GET = route<IdCtx>(async (req, ctx) => {
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const e = await getOwnedEvent(s, id);
  const [stats, lists] = await Promise.all([eventStats(getDb(), e.id), listRegistrationsForOwner(s, e.id)]);
  const relays = e.latestNostrEventId
    ? await getDb()
        .select({ relayUrl: relayPublishAttempts.relayUrl, status: relayPublishAttempts.status, lastError: relayPublishAttempts.lastError })
        .from(relayPublishAttempts)
        .where(eq(relayPublishAttempts.nostrEventId, e.latestNostrEventId))
    : [];
  return ok({
    event: { id: e.id, status: e.status, capacity: e.capacity, nostrPublishState: e.nostrPublishState, approvalMode: e.approvalMode },
    stats,
    relays,
    ...lists,
  });
});
