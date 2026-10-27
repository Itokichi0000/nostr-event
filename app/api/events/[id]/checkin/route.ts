import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { enforce } from "@/lib/security/rate-limit";
import { checkIn } from "@/lib/services/checkin";

export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  await enforce(`checkin:${s.accountId}`, 240, 60);
  return ok(await checkIn(s, id, await readJson(req, 4096)));
});
