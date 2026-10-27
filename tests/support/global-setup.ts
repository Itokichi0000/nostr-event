import "dotenv/config";
import { runMigrations } from "../../lib/db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL を設定してください（.env.example 参照）");
  await runMigrations(url);
}
