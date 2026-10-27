import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { outboxJobs, type OutboxJob } from "../db/schema";

export const OUTBOX_CHANNEL = "gather_outbox";

export type JobKind = "relay_publish" | "push" | "fetch_profile";

export type EnqueueInput = {
  kind: JobKind;
  dedupeKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
  maxAttempts?: number;
};

/** 状態変更と同じトランザクション内で呼ぶ。dedupe_key 重複は無視（冪等） */
export async function enqueueJob(tx: DbOrTx, job: EnqueueInput): Promise<boolean> {
  const rows = await tx
    .insert(outboxJobs)
    .values({
      kind: job.kind,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      availableAt: job.availableAt ?? new Date(),
      maxAttempts: job.maxAttempts ?? 10,
    })
    .onConflictDoNothing({ target: outboxJobs.dedupeKey })
    .returning({ id: outboxJobs.id });
  if (rows.length) {
    // NOTIFY はコミット時に配信される（ワーカーの待ち時間短縮用。取りこぼしはポーリングで補う）
    await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, ${job.kind})`);
  }
  return rows.length > 0;
}

const LOCK_TIMEOUT_SEC = 300;

/** 複数ワーカーでも同じジョブを同時に処理しない（FOR UPDATE SKIP LOCKED） */
export async function claimJobs(db: DbOrTx, limit: number, kinds?: JobKind[]): Promise<OutboxJob[]> {
  const kindFilter = kinds?.length ? sql`and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const rows = await db.execute(sql`
    update outbox_jobs set locked_at = now(), attempts = attempts + 1
    where id in (
      select id from outbox_jobs
      where processed_at is null and failed_at is null and available_at <= now()
        and (locked_at is null or locked_at < now() - make_interval(secs => ${LOCK_TIMEOUT_SEC}))
        ${kindFilter}
      order by available_at
      for update skip locked
      limit ${limit}
    )
    returning id, kind, dedupe_key, payload, attempts, max_attempts, available_at, locked_at, processed_at, failed_at, last_error, created_at
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    dedupeKey: r.dedupe_key as string,
    payload: r.payload as Record<string, unknown>,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    availableAt: new Date(r.available_at as string),
    lockedAt: r.locked_at ? new Date(r.locked_at as string) : null,
    processedAt: null,
    failedAt: null,
    lastError: (r.last_error as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  }));
}

export async function completeJob(db: DbOrTx, id: string, note?: string): Promise<void> {
  await db.execute(
    sql`update outbox_jobs set processed_at = now(), locked_at = null, last_error = ${note ?? null} where id = ${id}`,
  );
}

/** 指数バックオフ（5s, 10s, 20s ... 最大 30 分） */
export function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), 30 * 60 * 1000);
}

/** 失敗を記録。上限到達なら failed とし true を返す */
export async function failJob(db: DbOrTx, job: OutboxJob, error: string): Promise<boolean> {
  const exhausted = job.attempts >= job.maxAttempts;
  const msg = error.slice(0, 500);
  if (exhausted) {
    await db.execute(sql`update outbox_jobs set failed_at = now(), locked_at = null, last_error = ${msg} where id = ${job.id}`);
  } else {
    const next = new Date(Date.now() + backoffMs(job.attempts));
    await db.execute(
      sql`update outbox_jobs set locked_at = null, last_error = ${msg}, available_at = ${next.toISOString()} where id = ${job.id}`,
    );
  }
  return exhausted;
}
