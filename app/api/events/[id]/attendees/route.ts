import { errors, ok, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { requireSession } from "@/lib/auth/session";
import { searchAttendees } from "@/lib/services/checkin";

export const GET = route<IdCtx>(async (req, ctx) => {
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("イベント");
  return ok(await searchAttendees(s, id, new URL(req.url).searchParams.get("q") ?? ""));
});
