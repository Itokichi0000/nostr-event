import { ok, route } from "@/lib/api";
import { config } from "@/lib/config";

export const GET = route(async () => ok({ publicKey: config.vapid.publicKey || null }));
