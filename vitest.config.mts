import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // 統合テストは同じテストDBを共有するため直列実行
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
