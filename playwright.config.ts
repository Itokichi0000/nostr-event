import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const RELAY_PORT = 7788;
export const E2E_ENV = {
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://gather:gather@localhost:5432/gather_e2e",
  NOSTR_FALLBACK_RELAYS: `ws://localhost:${RELAY_PORT}`,
  NOSTR_INDEX_RELAYS: `ws://localhost:${RELAY_PORT}`,
  DEV_RELAY_PORT: String(RELAY_PORT),
  GATHER_DISABLE_RATE_LIMIT: "1",
  // E2E では外部の Push サービスに送らない
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
};

// 実行前に `pnpm build` が必要（package.json の test:e2e が実行する）
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E_ENV.APP_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${E2E_ENV.APP_URL}/api/health`,
    env: E2E_ENV,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
