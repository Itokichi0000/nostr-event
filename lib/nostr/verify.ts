import { verifyEvent } from "nostr-tools/pure";
import { z } from "zod";
import type { SignedEvent } from "./nip52";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const signedEventSchema = z.object({
  id: hex64,
  pubkey: hex64,
  sig: z.string().regex(/^[0-9a-f]{128}$/),
  kind: z.number().int().min(0).max(65535),
  created_at: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string().max(4096)).max(32)).max(2000),
  content: z.string().max(64 * 1024),
});

/** 構造・id・署名をすべて検証。失敗時は null */
export function parseVerifiedEvent(input: unknown): SignedEvent | null {
  const parsed = signedEventSchema.safeParse(input);
  if (!parsed.success) return null;
  // verifyEvent はオブジェクトにキャッシュを書くのでコピーを渡す
  const ev: SignedEvent = { ...parsed.data, tags: parsed.data.tags.map((t) => [...t]) };
  try {
    return verifyEvent({ ...ev }) ? ev : null;
  } catch {
    return null;
  }
}

export function isHexPubkey(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}
