import { ok, readJson, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { subscribePush } from "@/lib/push/subscriptions";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  return ok(await subscribePush(s.accountId, await readJson(req), req.headers.get("user-agent")), 201);
});
