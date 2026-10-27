import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, getRequestSession } from "@/lib/auth/session";
import { clientKey, enforce } from "@/lib/security/rate-limit";
import { cancelRegistration } from "@/lib/services/registrations";

// 本人の Nostr セッション、または有効なチケットトークン（body で受け取り URL に出さない）
export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("申込");
  await enforce(`regcancel:${clientKey(req)}`, 20, 600);
  const body = (await readJson(req)) as { ticketToken?: unknown };
  const actor = await getRequestSession(req);
  const ticketToken = typeof body.ticketToken === "string" ? body.ticketToken : null;
  return ok(await cancelRegistration(id, { actor, ticketToken }));
});
