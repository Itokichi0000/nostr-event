// NIP-98 HTTP Auth の検証（純粋関数。リプレイ判定は呼び出し側で DB を使う）
import { KIND_HTTP_AUTH, type SignedEvent } from "../nostr/nip52";
import { parseVerifiedEvent } from "../nostr/verify";
import { sha256Hex } from "../security/tokens";

export type Nip98Failure =
  | "missing_header"
  | "malformed"
  | "bad_signature"
  | "wrong_kind"
  | "expired"
  | "wrong_url"
  | "wrong_method"
  | "wrong_payload";

export class Nip98Error extends Error {
  constructor(public reason: Nip98Failure) {
    super(`NIP-98 verification failed: ${reason}`);
  }
}

export type Nip98Options = {
  url: string;
  method: string;
  nowSec?: number;
  windowSec?: number;
  /** リクエストボディ（存在する場合は payload タグと照合） */
  body?: string;
};

export function verifyNip98(authorization: string | null, opts: Nip98Options): SignedEvent {
  if (!authorization) throw new Nip98Error("missing_header");
  const m = /^Nostr\s+([A-Za-z0-9+/=_-]+)$/.exec(authorization.trim());
  if (!m) throw new Nip98Error("malformed");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8"));
  } catch {
    throw new Nip98Error("malformed");
  }
  const ev = parseVerifiedEvent(decoded);
  if (!ev) throw new Nip98Error("bad_signature");
  if (ev.kind !== KIND_HTTP_AUTH) throw new Nip98Error("wrong_kind");

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ev.created_at) > (opts.windowSec ?? 60)) throw new Nip98Error("expired");

  const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
  if (tag("u") !== opts.url) throw new Nip98Error("wrong_url");
  if ((tag("method") ?? "").toUpperCase() !== opts.method.toUpperCase()) throw new Nip98Error("wrong_method");

  const payload = tag("payload");
  if (opts.body) {
    if (!payload || payload !== sha256Hex(opts.body)) throw new Nip98Error("wrong_payload");
  } else if (payload && payload !== sha256Hex("")) {
    throw new Nip98Error("wrong_payload");
  }
  return ev;
}
