// E2E: DB を初期化し、開発用リレーとワーカーを起動（Next.js は webServer で起動）
import { spawn, type ChildProcess } from "node:child_process";
import postgres from "postgres";
import { runMigrations } from "../../lib/db/migrate";
import { E2E_ENV } from "../../playwright.config";

function start(cmd: string, args: string[], ready: RegExp): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...E2E_ENV }, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => reject(new Error(`${args.join(" ")} did not start`)), 30_000);
    const onData = (b: Buffer) => {
      if (process.env.E2E_DEBUG) process.stdout.write(`[${args[1]}] ${b}`);
      if (ready.test(String(b))) {
        clearTimeout(timer);
        resolve(p);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => code && reject(new Error(`${args.join(" ")} exited ${code}`)));
  });
}

export default async function globalSetup() {
  await runMigrations(E2E_ENV.DATABASE_URL);
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} });
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`;
  await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  await sql.end();

  const relay = await start("pnpm", ["exec", "tsx", "scripts/dev-relay.ts"], /開発用リレー起動/);
  const worker = await start("pnpm", ["exec", "tsx", "worker/index.ts"], /worker started/);
  return async () => {
    worker.kill("SIGTERM");
    relay.kill("SIGTERM");
  };
}
