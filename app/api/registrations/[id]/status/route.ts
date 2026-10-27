import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { decideRegistration } from "@/lib/services/registrations";
import { z } from "zod";

const body = z.object({ action: z.enum(["approve", "reject"]) });

export const PATCH = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("申込");
  const { action } = body.parse(await readJson(req));
  return ok(await decideRegistration(s, id, action));
});
