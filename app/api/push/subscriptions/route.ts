import { ok, route } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { listPushSubscriptions } from "@/lib/push/subscriptions";

export const GET = route(async (req) => ok(await listPushSubscriptions((await requireSession(req)).accountId)));
