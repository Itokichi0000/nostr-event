import { ok, route } from "@/lib/api";
import { getRequestSession } from "@/lib/auth/session";
import { nip19 } from "nostr-tools";

export const GET = route(async (req) => {
  const s = await getRequestSession(req);
  if (!s) return ok(null);
  return ok({ pubkey: s.pubkey, npub: nip19.npubEncode(s.pubkey), displayName: s.displayName, picture: s.picture });
});
