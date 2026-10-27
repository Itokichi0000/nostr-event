import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { cancelEvent } from "@/lib/services/events";

export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const body = (await readJson(req)) as { signedEvent?: unknown; skipNostr?: boolean };
  const e = await cancelEvent(s, id, { signedEvent: body.signedEvent, skipNostr: body.skipNostr === true });
  return ok({ id: e.id, status: e.status });
});
