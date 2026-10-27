import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { Nip98Error, verifyNip98 } from "@/lib/auth/nip98";
import { sha256Hex } from "@/lib/security/tokens";

const URL_ = "http://localhost:3000/api/auth/nostr";
const sk = generateSecretKey();
const now = 1_800_000_000;

function header(over: { kind?: number; created_at?: number; tags?: string[][] } = {}, key = sk) {
  const ev = finalizeEvent(
    {
      kind: over.kind ?? 27235,
      created_at: over.created_at ?? now,
      tags: over.tags ?? [
        ["u", URL_],
        ["method", "POST"],
      ],
      content: "",
    },
    key,
  );
  return { ev, value: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}` };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof Nip98Error) return e.reason;
    throw e;
  }
  return "ok";
}

describe("NIP-98 検証", () => {
  it("正しい署名を受け入れる", () => {
    const h = header();
    expect(verifyNip98(h.value, { url: URL_, method: "POST", nowSec: now }).pubkey).toBe(h.ev.pubkey);
  });

  it("ヘッダーなし・形式不正を拒否", () => {
    expect(reason(() => verifyNip98(null, { url: URL_, method: "POST", nowSec: now }))).toBe("missing_header");
    expect(reason(() => verifyNip98("Bearer abc", { url: URL_, method: "POST", nowSec: now }))).toBe("malformed");
    expect(reason(() => verifyNip98("Nostr !!!", { url: URL_, method: "POST", nowSec: now }))).toBe("malformed");
  });

  it("偽署名（内容改ざん）を拒否", () => {
    const h = header();
    const tampered = { ...h.ev, tags: [["u", URL_], ["method", "GET"]] };
    const value = `Nostr ${Buffer.from(JSON.stringify(tampered)).toString("base64")}`;
    expect(reason(() => verifyNip98(value, { url: URL_, method: "GET", nowSec: now }))).toBe("bad_signature");
    const badSig = { ...h.ev, sig: "0".repeat(128) };
    expect(reason(() => verifyNip98(`Nostr ${Buffer.from(JSON.stringify(badSig)).toString("base64")}`, { url: URL_, method: "POST", nowSec: now }))).toBe(
      "bad_signature",
    );
  });

  it("期限切れ・未来の時刻を拒否（±60秒）", () => {
    expect(reason(() => verifyNip98(header({ created_at: now - 61 }).value, { url: URL_, method: "POST", nowSec: now }))).toBe("expired");
    expect(reason(() => verifyNip98(header({ created_at: now + 61 }).value, { url: URL_, method: "POST", nowSec: now }))).toBe("expired");
    expect(reason(() => verifyNip98(header({ created_at: now - 59 }).value, { url: URL_, method: "POST", nowSec: now }))).toBe("ok");
  });

  it("誤ったURL・メソッド・kind を拒否", () => {
    const h = header();
    expect(reason(() => verifyNip98(h.value, { url: "http://evil.example/api/auth/nostr", method: "POST", nowSec: now }))).toBe("wrong_url");
    expect(reason(() => verifyNip98(h.value, { url: `${URL_}?x=1`, method: "POST", nowSec: now }))).toBe("wrong_url");
    expect(reason(() => verifyNip98(h.value, { url: URL_, method: "GET", nowSec: now }))).toBe("wrong_method");
    expect(reason(() => verifyNip98(header({ kind: 1 }).value, { url: URL_, method: "POST", nowSec: now }))).toBe("wrong_kind");
  });

  it("body がある場合は payload ハッシュを照合", () => {
    const body = '{"a":1}';
    const good = header({ tags: [["u", URL_], ["method", "POST"], ["payload", sha256Hex(body)]] });
    expect(reason(() => verifyNip98(good.value, { url: URL_, method: "POST", nowSec: now, body }))).toBe("ok");
    expect(reason(() => verifyNip98(good.value, { url: URL_, method: "POST", nowSec: now, body: '{"a":2}' }))).toBe("wrong_payload");
    expect(reason(() => verifyNip98(header().value, { url: URL_, method: "POST", nowSec: now, body }))).toBe("wrong_payload");
  });
});
