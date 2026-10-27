import { ok, readJson, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const relayUrl = z
  .string()
  .trim()
  .max(256)
  .refine((v) => /^wss:\/\/[^\s/$.?#].[^\s]*$/.test(v), "リレーは wss:// で始まる URL を指定してください");
const body = z.object({ relays: z.array(relayUrl).max(6) });

export const GET = route(async (req) => {
  const s = await requireSession(req);
  const [a] = await getDb().select().from(accounts).where(eq(accounts.id, s.accountId)).limit(1);
  return ok({ custom: a?.customRelays ?? [], nip65: a?.nip65Relays ?? [] });
});

export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const { relays } = body.parse(await readJson(req));
  await getDb()
    .update(accounts)
    .set({ customRelays: relays.length ? [...new Set(relays)] : null })
    .where(eq(accounts.id, s.accountId));
  return ok({ custom: relays });
});
