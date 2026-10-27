import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, getRequestSession, requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { isPubliclyVisible, updateEvent } from "@/lib/services/events";
import { eq } from "drizzle-orm";

export const GET = route<IdCtx>(async (req, ctx) => {
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const [e] = await getDb().select().from(events).where(eq(events.id, id)).limit(1);
  const s = await getRequestSession(req);
  const isOwner = !!e && s?.accountId === e.ownerAccountId;
  // 限定リンクは slug を知る人だけ（ID での取得は主催者のみ）
  if (!e || (!isOwner && (!isPubliclyVisible(e) || e.visibility !== "public_nostr"))) throw errors.notFound("イベント");
  return ok({
    id: e.id,
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    description: e.description,
    imageUrl: e.imageUrl,
    location: e.location,
    tags: e.tags,
    startAt: e.startAt,
    endAt: e.endAt,
    timezone: e.timezone,
    isAllDay: e.isAllDay,
    status: e.status,
    visibility: e.visibility,
    capacity: e.capacity,
    approvalMode: e.approvalMode,
    allowGuest: e.allowGuest,
    nostrCoordinate: e.nostrCoordinate,
  });
});

export const PATCH = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const body = (await readJson(req)) as { event?: unknown; signedEvent?: unknown };
  const updated = await updateEvent(s, id, body.event, body.signedEvent);
  return ok({ id: updated.id, slug: updated.slug, status: updated.status, nostrPublishState: updated.nostrPublishState });
});
