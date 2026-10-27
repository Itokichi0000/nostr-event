import "dotenv/config";
import { runMigrations } from "../lib/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL が必要です");
runMigrations(url).then(
  () => console.log("migration 完了"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
