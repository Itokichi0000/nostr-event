// 開発・テスト用の最小 Nostr リレー（NIP-01: EVENT / REQ / CLOSE / OK / EOSE、置換可能・アドレス可能イベント）
// 実在リレーに公開せずに作成→公開→RSVP 監視までを試せる。データはメモリのみ。
import { verifyEvent, type Event } from "nostr-tools/pure";
import { WebSocketServer, type WebSocket } from "ws";

type Filter = { ids?: string[]; authors?: string[]; kinds?: number[]; since?: number; until?: number; limit?: number } & Record<
  string,
  unknown
>;

function matches(ev: Event, f: Filter): boolean {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since !== undefined && ev.created_at < f.since) return false;
  if (f.until !== undefined && ev.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith("#") && Array.isArray(v)) {
      const name = k.slice(1);
      if (!ev.tags.some((t) => t[0] === name && v.includes(t[1]))) return false;
    }
  }
  return true;
}

function replaceKey(ev: Event): string | null {
  if (ev.kind === 0 || ev.kind === 3 || (ev.kind >= 10000 && ev.kind < 20000)) return `${ev.kind}:${ev.pubkey}`;
  if (ev.kind >= 30000 && ev.kind < 40000) return `${ev.kind}:${ev.pubkey}:${ev.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
  return null;
}

export type MockRelay = {
  url: string;
  events: Event[];
  /** true の間は EVENT を OK false で拒否（障害テスト用） */
  setReject(v: boolean): void;
  inject(ev: Event): void;
  clear(): void;
  close(): Promise<void>;
};

export function startMockRelay(port: number, opts: { log?: boolean } = {}): Promise<MockRelay> {
  const store = new Map<string, Event>();
  const byReplace = new Map<string, string>();
  let reject = false;
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const wss = new WebSocketServer({ port });

  const accept = (ev: Event) => {
    if (store.has(ev.id)) return;
    const rk = replaceKey(ev);
    if (rk) {
      const prevId = byReplace.get(rk);
      const prev = prevId ? store.get(prevId) : undefined;
      if (prev && (prev.created_at > ev.created_at || (prev.created_at === ev.created_at && prev.id < ev.id))) return;
      if (prevId) store.delete(prevId);
      byReplace.set(rk, ev.id);
    }
    store.set(ev.id, ev);
    for (const [ws, m] of subs) {
      for (const [subId, filters] of m) {
        if (filters.some((f) => matches(ev, f))) ws.send(JSON.stringify(["EVENT", subId, ev]));
      }
    }
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("message", (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const [type] = msg;
      if (type === "EVENT") {
        const ev = msg[1] as Event;
        if (reject) return ws.send(JSON.stringify(["OK", ev?.id, false, "blocked: mock relay rejecting"]));
        if (!ev || !verifyEvent(ev)) return ws.send(JSON.stringify(["OK", ev?.id, false, "invalid: bad signature"]));
        accept(ev);
        if (opts.log) console.log(`[relay] EVENT kind=${ev.kind} ${ev.id.slice(0, 8)}`);
        ws.send(JSON.stringify(["OK", ev.id, true, ""]));
      } else if (type === "REQ") {
        const subId = String(msg[1]);
        const filters = msg.slice(2) as Filter[];
        subs.get(ws)!.set(subId, filters);
        const out = [...store.values()]
          .filter((ev) => filters.some((f) => matches(ev, f)))
          .sort((a, b) => b.created_at - a.created_at);
        const limit = Math.min(...filters.map((f) => f.limit ?? 500));
        for (const ev of out.slice(0, limit)) ws.send(JSON.stringify(["EVENT", subId, ev]));
        ws.send(JSON.stringify(["EOSE", subId]));
      } else if (type === "CLOSE") {
        subs.get(ws)?.delete(String(msg[1]));
      }
    });
    ws.on("close", () => subs.delete(ws));
  });

  return new Promise((resolve) => {
    wss.on("listening", () =>
      resolve({
        url: `ws://localhost:${port}`,
        get events() {
          return [...store.values()];
        },
        setReject: (v) => {
          reject = v;
        },
        inject: accept,
        clear: () => {
          store.clear();
          byReplace.clear();
        },
        close: () =>
          new Promise<void>((r) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => r());
          }),
      }),
    );
  });
}
