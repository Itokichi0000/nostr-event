import { sql } from "drizzle-orm";
import { errors } from "../api";
import { getDb } from "../db/client";
import { sha256Hex } from "./tokens";

/** 固定ウィンドウのレート制限（PostgreSQL。Redis 不要）。超過なら false */
export async function hit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const rows = await getDb().execute(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count
  `);
  const count = Number((rows as unknown as { count: number }[])[0]?.count ?? 0);
  return count <= limit;
}

export async function enforce(key: string, limit: number, windowSec: number): Promise<void> {
  if (process.env.GATHER_DISABLE_RATE_LIMIT === "1") return;
  if (!(await hit(key, limit, windowSec))) throw errors.rateLimited();
}

/** クライアントIP（逆プロキシ配下では X-Forwarded-For の先頭）。保存時はハッシュ化 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = xff || req.headers.get("x-real-ip") || "unknown";
  return sha256Hex(`ip:${ip}`).slice(0, 32);
}
