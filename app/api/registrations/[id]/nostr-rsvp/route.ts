import { errors, ok, readJson, route } from "@/lib/api";
import { idParam, isUuid, type IdCtx } from "@/lib/api-context";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { publishRsvp } from "@/lib/services/registrations";
import { z } from "zod";

const body = z.object({ status: z.enum(["accepted", "tentative", "declined"]), signedEvent: z.unknown().optional() });

// 本人が「Nostr に参加表明を公開する」を明示的に選んだときだけ呼ばれる
export const POST = route<IdCtx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const id = await idParam(ctx);
  if (!isUuid(id)) throw errors.notFound("申込");
  return ok(await publishRsvp(s, id, body.parse(await readJson(req))));
});
