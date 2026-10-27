// リレー URL の正規化と、公開先リレーの決定（NIP-65 書込リレー優先 + フォールバック）
export const MAX_TARGET_RELAYS = 8;

export function normalizeRelayUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    // 平文 ws:// はローカル開発用リレーのみ許可
    if (u.protocol === "ws:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return null;
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function uniqueRelays(...lists: (string[] | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const r of list ?? []) {
      const n = normalizeRelayUrl(r);
      if (n && !out.includes(n)) out.push(n);
      if (out.length >= MAX_TARGET_RELAYS) return out;
    }
  }
  return out;
}

export type Nip65 = { url: string; read: boolean; write: boolean }[];

export function parseRelayList(tags: string[][]): Nip65 {
  const out: Nip65 = [];
  for (const t of tags) {
    if (t[0] !== "r" || !t[1]) continue;
    const url = normalizeRelayUrl(t[1]);
    if (!url) continue;
    const marker = t[2];
    out.push({ url, read: marker !== "write", write: marker !== "read" });
  }
  return out.slice(0, 20);
}

export const writeRelays = (l: Nip65 | null | undefined) => (l ?? []).filter((r) => r.write).map((r) => r.url).slice(0, 4);
export const readRelays = (l: Nip65 | null | undefined) => (l ?? []).filter((r) => r.read).map((r) => r.url).slice(0, 4);
