import { ok, route } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { listMyRegistrations } from "@/lib/services/registrations";

export const GET = route(async (req) => ok(await listMyRegistrations(await requireSession(req))));
