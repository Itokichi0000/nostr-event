import { ok, readJson, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { markRead } from "@/lib/services/notifications";
import { z } from "zod";

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.uuid()).min(1).max(100) })]);

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const b = body.parse(await readJson(req));
  return ok({ updated: await markRead(s.accountId, "all" in b ? "all" : b.ids) });
});
