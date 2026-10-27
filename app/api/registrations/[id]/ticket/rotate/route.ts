import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, getRequestSession } from "@/lib/auth/session";
import { clientKey, enforce } from "@/lib/security/rate-limit";
import { rotateTicket } from "@/lib/services/registrations";

export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("申込");
  await enforce(`rotate:${clientKey(req)}`, 20, 600);
  const body = (await readJson(req)) as { ticketToken?: unknown };
  const actor = await getRequestSession(req);
  const ticketToken = typeof body.ticketToken === "string" ? body.ticketToken : null;
  return ok(await rotateTicket(id, { actor, ticketToken }));
});
