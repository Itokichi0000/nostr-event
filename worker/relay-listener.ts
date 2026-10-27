// リレー監視: 管理中の公開イベントへの RSVP（31925）と、主催者による外部更新（31922/31923）を購読。
// 再起動時は保存したカーソルから重複を許してバックフィルし、取り込み側で id 重複排除する。
import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { SimplePool, SubCloser } from "nostr-tools/pool";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { accounts, events, workerCursors } from "@/lib/db/schema";
import { KIND_DATE_EVENT, KIND_RSVP, KIND_TIME_EVENT } from "@/lib/nostr/nip52";
import { readRelays, uniqueRelays, writeRelays } from "@/lib/nostr/relays";
import { ingestNostrEvent } from "@/lib/services/ingest";

const CURSOR = "relay_listener";
const OVERLAP_SEC = 600;
const INITIAL_LOOKBACK_SEC = 30 * 86400;

async function readCursor(): Promise<number> {
  const [c] = await getDb().select().from(workerCursors).where(eq(workerCursors.name, CURSOR)).limit(1);
  return c?.value ?? Math.floor(Date.now() / 1000) - INITIAL_LOOKBACK_SEC;
}

async function writeCursor(value: number): Promise<void> {
  await getDb()
    .insert(workerCursors)
    .values({ name: CURSOR, value })
    .onConflictDoUpdate({ target: workerCursors.name, set: { value, updatedAt: new Date() } });
}

/** 監視対象: 公開済み（または公開処理中）で、終了後7日以内のイベント */
export async function watchTargets() {
  const rows = await getDb()
    .select({ coordinate: events.nostrCoordinate, owner: events.ownerPubkey, nip65: accounts.nip65Relays, custom: accounts.customRelays })
    .from(events)
    .innerJoin(accounts, eq(accounts.id, events.ownerAccountId))
    .where(
      and(
        eq(events.visibility, "public_nostr"),
        isNotNull(events.latestNostrEventId),
        inArray(events.status, ["publishing", "published", "cancelled", "ended"]),
        gt(events.endAt, sql`now() - interval '7 days'`),
      ),
    )
    .limit(2000);
  const coordinates = rows.map((r) => r.coordinate!).filter(Boolean);
  const owners = [...new Set(rows.map((r) => r.owner))];
  const relays = uniqueRelays(
    config.fallbackRelays,
    ...rows.map((r) => (r.custom?.length ? r.custom : writeRelays(r.nip65))),
    ...rows.map((r) => readRelays(r.nip65)),
  );
  return { coordinates, owners, relays };
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class RelayListener {
  private subs: SubCloser[] = [];
  private key = "";
  private timer: NodeJS.Timeout | null = null;
  private seen = new Set<string>();

  constructor(
    private pool: SimplePool,
    private log: (m: string) => void = () => {},
  ) {}

  async start(refreshMs = 30_000) {
    await this.refresh(true);
    this.timer = setInterval(() => this.refresh(false).catch((e) => this.log(`[listener] ${e}`)), refreshMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.subs) s.close();
    this.subs = [];
  }

  /** 監視対象が変わったら購読をやり直す（定期的に再購読して再接続も兼ねる） */
  async refresh(force: boolean) {
    const t = await watchTargets();
    const key = JSON.stringify([t.coordinates, t.owners, t.relays]);
    const stale = Date.now() % (5 * 60_000) < 30_000; // 約5分ごとに張り直す
    if (!force && key === this.key && !stale) return;
    this.key = key;
    for (const s of this.subs) s.close();
    this.subs = [];
    if (!t.relays.length || !t.coordinates.length) return;

    const since = (await readCursor()) - OVERLAP_SEC;
    const startedAt = Math.floor(Date.now() / 1000);
    const onevent = (ev: unknown) => {
      const id = (ev as { id?: string }).id;
      if (id && this.seen.has(id)) return; // 同一プロセス内の重複を早期に捨てる（DB でも重複排除）
      if (id) {
        this.seen.add(id);
        if (this.seen.size > 20000) this.seen.clear();
      }
      ingestNostrEvent(ev)
        .then((r) => r !== "duplicate" && r !== "ignored" && this.log(`[listener] ${r} ${id?.slice(0, 8)}`))
        .catch((e) => this.log(`[listener] ingest error: ${e instanceof Error ? e.message : e}`));
    };
    let eoses = 0;
    const filters = [
      ...chunk(t.coordinates, 100).map((c) => ({ kinds: [KIND_RSVP], "#a": c, since })),
      ...chunk(t.owners, 100).map((a) => ({ kinds: [KIND_DATE_EVENT, KIND_TIME_EVENT], authors: a, since })),
    ];
    for (const f of filters) {
      this.subs.push(
        this.pool.subscribeMany(t.relays, f, {
          onevent,
          oneose: () => {
            // 全フィルターのバックフィルが終わったらカーソルを進める
            if (++eoses === filters.length) writeCursor(startedAt).catch(() => {});
          },
        }),
      );
    }
    this.log(`[listener] watching ${t.coordinates.length} events on ${t.relays.length} relays since ${since}`);
  }
}
