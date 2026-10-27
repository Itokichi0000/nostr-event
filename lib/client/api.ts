"use client";

import type { EventTemplate, SignedEvent } from "@/lib/nostr/nip52";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "network", "通信に失敗しました（再試行）");
  }
  let json: { data: T; error: { code: string; message: string; details?: unknown } | null } | null = null;
  try {
    json = await res.json();
  } catch {
    // 応答がJSONでない（プロキシのエラー等）
  }
  if (!res.ok || !json || json.error) {
    const e = json?.error;
    throw new ApiClientError(res.status, e?.code ?? "http_" + res.status, e?.message ?? "通信に失敗しました（再試行）", e?.details);
  }
  return json.data;
}

export function templateFromError(e: unknown): EventTemplate | null {
  if (e instanceof ApiClientError && e.status === 428 && e.code === "signature_required") {
    return ((e.details as { template?: EventTemplate } | undefined)?.template ?? null) as EventTemplate | null;
  }
  return null;
}

/**
 * 署名が必要な API の共通手順:
 *  1) 署名なしで呼ぶ → サーバーが 428 + 署名用の雛形を返す
 *  2) 署名器で署名 → 署名済みイベント付きで再送
 * 雛形はサーバーが DB から組み立てるので、クライアントの改変は検証で弾かれる。
 */
export async function withSignature<T>(
  call: (signedEvent?: SignedEvent) => Promise<T>,
  sign: (t: EventTemplate) => Promise<SignedEvent>,
): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const template = templateFromError(e);
    if (!template) throw e;
    const signed = await sign(template);
    return call(signed);
  }
}
