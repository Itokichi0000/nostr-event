import { ok, route } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { listNotifications } from "@/lib/services/notifications";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  const sp = new URL(req.url).searchParams;
  return ok(await listNotifications(s.accountId, { cursor: sp.get("cursor"), limit: Number(sp.get("limit") ?? 20) }));
});
