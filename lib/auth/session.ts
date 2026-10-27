import { and, eq, gt, isNull } from "drizzle-orm";
import { config, SESSION_COOKIE, SESSION_TTL_MS } from "../config";
import { getDb, type DbOrTx } from "../db/client";
import { accounts, sessions } from "../db/schema";
import { errors } from "../api";
import { generateToken, hashToken } from "../security/tokens";

export type SessionUser = {
  sessionId: string;
  accountId: string;
  pubkey: string;
  displayName: string | null;
  picture: string | null;
};

export async function createSession(
  db: DbOrTx,
  accountId: string,
  signerType: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ accountId, tokenHash: hashToken(token), signerType, expiresAt });
  return { token, expiresAt };
}

export async function findSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 128) return null;
  const rows = await getDb()
    .select({
      sessionId: sessions.id,
      accountId: accounts.id,
      pubkey: accounts.nostrPubkey,
      displayName: accounts.displayName,
      picture: accounts.picture,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export async function getRequestSession(req: Request): Promise<SessionUser | null> {
  return findSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export async function requireSession(req: Request): Promise<SessionUser> {
  const s = await getRequestSession(req);
  if (!s) throw errors.unauthorized();
  return s;
}

/**
 * CSRF 対策: 状態変更 API は同一オリジンからのみ受け付ける。
 * Origin が無いブラウザーでは Sec-Fetch-Site で判定する。
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== config.appOrigin) throw errors.badOrigin();
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw errors.badOrigin();
  if (!site) throw errors.badOrigin();
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}
