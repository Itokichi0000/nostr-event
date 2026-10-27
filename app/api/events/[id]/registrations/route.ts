import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, getRequestSession, requireSession } from "@/lib/auth/session";
import { clientKey, enforce } from "@/lib/security/rate-limit";
import { listRegistrationsForOwner, register } from "@/lib/services/registrations";

export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  const body = (await readJson(req)) as { mode?: string };
  const s = body.mode === "nostr" ? await requireSession(req) : await getRequestSession(req);
  const ip = clientKey(req);
  if (body.mode === "guest") {
    await enforce(`reg:guest:${ip}:${id}`, 5, 600);
    await enforce(`reg:guest:${ip}`, 30, 3600);
  } else if (s) {
    await enforce(`reg:nostr:${s.accountId}`, 30, 600);
  }
  const result = await register(id, body, body.mode === "nostr" ? s : null);
  return ok(result, result.alreadyRegistered ? 200 : 201);
});

export const GET = route<IdCtx>(async (req, ctx) => {
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  return ok(await listRegistrationsForOwner(s, id));
});
