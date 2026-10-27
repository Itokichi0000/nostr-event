import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { publishEvent, retryPublish } from "@/lib/services/events";

// body: { signedEvent?: NostrEvent } / { retry: true }（署名済みイベントの再送のみ）
export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const body = (await readJson(req)) as { signedEvent?: unknown; retry?: boolean };
  if (body.retry) return ok(await retryPublish(s, id));
  const e = await publishEvent(s, id, body.signedEvent);
  return ok({ id: e.id, slug: e.slug, status: e.status, nostrPublishState: e.nostrPublishState });
});
