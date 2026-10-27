import { ok, route } from "@/lib/api";
import { assertSameOrigin, clearSessionCookie, getRequestSession, revokeSession } from "@/lib/auth/session";
import { readJson } from "@/lib/api";
import { deletePushSubscriptionByEndpoint } from "@/lib/push/subscriptions";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await getRequestSession(req);
  const body = (await readJson(req)) as { pushEndpoint?: unknown };
  if (s) {
    // この端末の Push 購読はアカウントから切り離す
    if (typeof body.pushEndpoint === "string") await deletePushSubscriptionByEndpoint(s.accountId, body.pushEndpoint);
    await revokeSession(s.sessionId);
  }
  const res = ok({ loggedOut: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
});
