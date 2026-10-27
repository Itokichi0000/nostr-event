import { ok, route } from "@/lib/api";
import { assertSameOrigin, sessionCookie } from "@/lib/auth/session";
import { clientKey, enforce } from "@/lib/security/rate-limit";
import { loginWithNip98 } from "@/lib/services/auth";
import { nip19 } from "nostr-tools";

// NIP-98 署名（空 body）でセッションを作成
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await enforce(`auth:${clientKey(req)}`, 20, 60);
  const signer = req.headers.get("x-signer-type");
  const { account, token, expiresAt } = await loginWithNip98(
    req.headers.get("authorization"),
    signer === "nip07" || signer === "nip46" ? signer : null,
  );
  const res = ok({ pubkey: account.nostrPubkey, npub: nip19.npubEncode(account.nostrPubkey), displayName: account.displayName });
  res.headers.append("Set-Cookie", sessionCookie(token, expiresAt));
  return res;
});
