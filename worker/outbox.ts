// outbox の処理ループ。LISTEN/NOTIFY で即時に起き、取りこぼしは定期ポーリングで補う。
// ジョブの取得は FOR UPDATE SKIP LOCKED なので複数ワーカーでも二重処理しない。
import { getDb } from "@/lib/db/client";
import type { OutboxJob } from "@/lib/db/schema";
import { claimJobs, completeJob, failJob, type JobKind } from "@/lib/services/outbox";

export type JobHandler = (job: OutboxJob) => Promise<void | string>;
export type Handlers = Partial<Record<JobKind, JobHandler>>;

export class Skip extends Error {}

/** 取得できる分だけ処理して件数を返す（テストからも直接呼ぶ） */
export async function runOutboxOnce(handlers: Handlers, opts: { batch?: number; log?: (m: string) => void } = {}): Promise<number> {
  const db = getDb();
  const jobs = await claimJobs(db, opts.batch ?? 10, Object.keys(handlers) as JobKind[]);
  await Promise.all(
    jobs.map(async (job) => {
      const handler = handlers[job.kind as JobKind];
      try {
        if (!handler) throw new Error(`no handler for ${job.kind}`);
        const note = await handler(job);
        await completeJob(db, job.id, typeof note === "string" ? note : undefined);
      } catch (e) {
        if (e instanceof Skip) {
          await completeJob(db, job.id, e.message);
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        const exhausted = await failJob(db, job, msg);
        opts.log?.(`[outbox] ${job.kind} ${job.id} attempt ${job.attempts} failed${exhausted ? " (give up)" : ""}: ${msg}`);
      }
    }),
  );
  return jobs.length;
}

export function startOutboxLoop(handlers: Handlers, opts: { pollMs?: number; log?: (m: string) => void; wake?: (cb: () => void) => void }) {
  let running = true;
  let wakeUp: (() => void) | null = null;
  opts.wake?.(() => wakeUp?.());
  const loop = async () => {
    while (running) {
      let n = 0;
      try {
        n = await runOutboxOnce(handlers, { log: opts.log });
      } catch (e) {
        opts.log?.(`[outbox] loop error: ${e instanceof Error ? e.message : e}`);
      }
      if (n > 0) continue;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, opts.pollMs ?? 2000);
        wakeUp = () => {
          clearTimeout(t);
          resolve();
        };
      });
      wakeUp = null;
    }
  };
  const done = loop();
  return {
    stop: async () => {
      running = false;
      wakeUp?.();
      await done;
    },
  };
}
