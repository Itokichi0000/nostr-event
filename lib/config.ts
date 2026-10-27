// サーバー側設定（環境変数）
function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  get appUrl(): string {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get appOrigin(): string {
    return new URL(this.appUrl).origin;
  },
  get secureCookies(): boolean {
    return this.appUrl.startsWith("https://");
  },
  get fallbackRelays(): string[] {
    return list(process.env.NOSTR_FALLBACK_RELAYS);
  },
  get indexRelays(): string[] {
    const l = list(process.env.NOSTR_INDEX_RELAYS);
    return l.length ? l : this.fallbackRelays;
  },
  get vapid() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
      subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    };
  },
  get uploadDir(): string {
    return process.env.UPLOAD_DIR ?? "./.data/uploads";
  },
};

export const SESSION_COOKIE = "gather_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NIP98_WINDOW_SEC = 60;
