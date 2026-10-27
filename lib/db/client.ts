import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

type Holder = { sql?: postgres.Sql; db?: DB };
const g = globalThis as unknown as { __gatherDb?: Holder };
const holder: Holder = (g.__gatherDb ??= {});

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません");
  return url;
}

export function getSql(): postgres.Sql {
  if (!holder.sql) {
    holder.sql = postgres(databaseUrl(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      onnotice: () => {},
    });
  }
  return holder.sql;
}

export function getDb(): DB {
  if (!holder.db) holder.db = drizzle(getSql(), { schema });
  return holder.db;
}

export async function closeDb(): Promise<void> {
  const sql = holder.sql;
  holder.sql = undefined;
  holder.db = undefined;
  if (sql) await sql.end({ timeout: 5 });
}
