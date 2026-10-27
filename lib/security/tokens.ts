import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** CSPRNG 32byte → base64url（チケット・セッション用 bearer トークン） */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** トークン形式の事前チェック（DB照会前に明らかな不正値を弾く） */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}
