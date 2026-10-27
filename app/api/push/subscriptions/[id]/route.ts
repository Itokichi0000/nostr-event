import { errors, ok, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { deletePushSubscription } from "@/lib/push/subscriptions";

export const DELETE = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("端末");
  await deletePushSubscription(s.accountId, id);
  return ok({ deleted: true });
});
