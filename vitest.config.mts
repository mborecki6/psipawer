import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // Database suites each boot a separate Postgres/WASM instance.
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
