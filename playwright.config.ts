import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    channel: process.env.PSI_E2E_BROWSER_CHANNEL || "chrome",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
