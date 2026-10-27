import { sql } from "drizzle-orm";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import type { EventTemplate, SignedEvent } from "@/lib/nostr/nip52";

const TABLES = [
  "push_deliveries",
  "push_subscriptions",
  "notifications",
  "outbox_jobs",
  "relay_publish_attempts",
  "external_rsvps",
  "checkins",
  "revoked_tickets",
  "tickets",
  "registrations",
  "nostr_events",
  "events",
  "sessions",
  "auth_replays",
  "rate_limits",
  "worker_cursors",
  "accounts",
];

export async function resetDb() {
  await getDb().execute(sql.raw(`truncate ${TABLES.join(", ")} restart identity cascade`));
}

export type TestUser = SessionUser & { sk: Uint8Array };

export async function makeUser(displayName: string | null = null): Promise<TestUser> {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const [a] = await getDb().insert(accounts).values({ nostrPubkey: pubkey, displayName }).returning();
  return { sessionId: "test", accountId: a!.id, pubkey, displayName, picture: null, sk };
}

export function sign(user: { sk: Uint8Array }, t: EventTemplate): SignedEvent {
  return finalizeEvent(t, user.sk) as SignedEvent;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 86400 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function eventInput(over: Record<string, unknown> = {}) {
  return {
    title: "Nostr 勉強会",
    summary: "初心者歓迎",
    description: "説明",
    location: "東京",
    startDate: futureDate(10),
    startTime: "19:00",
    endDate: futureDate(10),
    endTime: "21:00",
    timezone: "Asia/Tokyo",
    visibility: "unlisted_db",
    ...over,
  };
}
