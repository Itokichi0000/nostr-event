"use client";

// 署名器インターフェース。秘密鍵（nsec）はアプリで一切扱わない。
//  - NIP-07: ブラウザー拡張（window.nostr）
//  - NIP-46: リモートサイナー（bunker:// / nostrconnect://）。通信用の一時鍵だけをタブ内（sessionStorage）に保持
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import type { EventTemplate, SignedEvent } from "@/lib/nostr/nip52";

export type SignerType = "nip07" | "nip46";

export interface AppSigner {
  type: SignerType;
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<SignedEvent>;
  close?(): Promise<void>;
}

type Nip07 = {
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<SignedEvent>;
};

declare global {
  interface Window {
    nostr?: Nip07;
  }
}

export class SignerRejected extends Error {}

function checkSigned(ev: SignedEvent, t: EventTemplate): SignedEvent {
  // 署名器が内容を書き換えていないか・署名が正しいかを送信前に確認
  if (!ev || ev.kind !== t.kind || ev.content !== t.content || JSON.stringify(ev.tags) !== JSON.stringify(t.tags)) {
    throw new Error("署名器が内容を変更しました");
  }
  if (!verifyEvent({ ...ev })) throw new Error("署名が正しくありません");
  return ev;
}

export async function waitForNip07(timeoutMs = 1500): Promise<Nip07 | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== "undefined" && window.nostr) return window.nostr;
    await new Promise((r) => setTimeout(r, 100));
  }
  return typeof window !== "undefined" ? (window.nostr ?? null) : null;
}

export function nip07Signer(ext: Nip07): AppSigner {
  return {
    type: "nip07",
    getPublicKey: () => ext.getPublicKey(),
    async signEvent(t) {
      let ev: SignedEvent;
      try {
        ev = await ext.signEvent({ ...t, tags: t.tags.map((x) => [...x]) });
      } catch (e) {
        throw new SignerRejected(e instanceof Error ? e.message : "rejected");
      }
      return checkSigned(ev, t);
    },
  };
}

// ---- NIP-46 ----

const NIP46_KEY = "gather.nip46";

type StoredNip46 = { clientSecret: string; bunker: { pubkey: string; relays: string[]; secret: string | null } };

export function nip46Relays(): string[] {
  return (process.env.NEXT_PUBLIC_NIP46_RELAYS ?? "wss://relay.nsec.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function wrapBunker(signer: import("nostr-tools/nip46").BunkerSigner): Promise<AppSigner> {
  return {
    type: "nip46",
    getPublicKey: () => signer.getPublicKey(),
    async signEvent(t) {
      let ev: SignedEvent;
      try {
        ev = (await signer.signEvent({ ...t, tags: t.tags.map((x) => [...x]) })) as SignedEvent;
      } catch (e) {
        throw new SignerRejected(e instanceof Error ? e.message : "rejected");
      }
      return checkSigned(ev, t);
    },
    close: () => signer.close(),
  };
}

function store(clientSecret: Uint8Array, bp: StoredNip46["bunker"]) {
  try {
    sessionStorage.setItem(NIP46_KEY, JSON.stringify({ clientSecret: bytesToHex(clientSecret), bunker: bp } satisfies StoredNip46));
  } catch {
    // ストレージ不可（プライベートモード等）でも、このタブ内では使える
  }
}

export function clearStoredSigner() {
  try {
    sessionStorage.removeItem(NIP46_KEY);
  } catch {}
}

export function hasStoredNip46(): boolean {
  try {
    return !!sessionStorage.getItem(NIP46_KEY);
  } catch {
    return false;
  }
}

export async function restoreNip46(): Promise<AppSigner | null> {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(NIP46_KEY);
  } catch {}
  if (!raw) return null;
  const s = JSON.parse(raw) as StoredNip46;
  const { BunkerSigner } = await import("nostr-tools/nip46");
  const signer = BunkerSigner.fromBunker(hexToBytes(s.clientSecret), s.bunker, {
    onauth: (url) => window.open(url, "_blank", "noopener"),
  });
  return wrapBunker(signer);
}

/** bunker:// URI または NIP-05 で接続 */
export async function connectBunker(input: string): Promise<AppSigner> {
  const { BunkerSigner, parseBunkerInput } = await import("nostr-tools/nip46");
  const bp = await parseBunkerInput(input.trim());
  if (!bp) throw new Error("bunker URI を確認してください");
  const clientSecret = generateSecretKey();
  const signer = BunkerSigner.fromBunker(clientSecret, bp, { onauth: (url) => window.open(url, "_blank", "noopener") });
  await signer.connect();
  store(clientSecret, bp);
  return wrapBunker(signer);
}

/** nostrconnect:// URI を作り、署名アプリからの接続を待つ */
export async function startNostrConnect(abort: AbortSignal): Promise<{ uri: string; signer: Promise<AppSigner> }> {
  const { BunkerSigner, createNostrConnectURI } = await import("nostr-tools/nip46");
  const clientSecret = generateSecretKey();
  const secret = bytesToHex(generateSecretKey()).slice(0, 16);
  const relays = nip46Relays();
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecret),
    relays,
    secret,
    name: "Gather",
    url: window.location.origin,
    perms: ["sign_event:27235", "sign_event:31922", "sign_event:31923", "sign_event:31925"],
  });
  const signer = BunkerSigner.fromURI(clientSecret, uri, { onauth: (url) => window.open(url, "_blank", "noopener") }, abort).then(
    async (s) => {
      store(clientSecret, s.bp);
      return wrapBunker(s);
    },
  );
  return { uri, signer };
}

/** NIP-98: /api/auth/nostr への POST を署名し、セッション Cookie を受け取る */
export async function loginWithSigner(signer: AppSigner): Promise<{ pubkey: string; npub: string; displayName: string | null }> {
  const url = `${window.location.origin}/api/auth/nostr`;
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "POST"],
    ],
    content: "",
  };
  const signed = await signer.signEvent(template);
  const bytes = new TextEncoder().encode(JSON.stringify(signed));
  const header = `Nostr ${btoa(String.fromCharCode(...bytes))}`;
  const { api } = await import("./api");
  return api("/api/auth/nostr", { method: "POST", headers: { Authorization: header, "X-Signer-Type": signer.type } });
}
