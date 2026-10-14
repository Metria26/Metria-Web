import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    // Always start a dedicated dev server so E2E_MODE=1 is guaranteed;
    // stop any manually running `pnpm dev` before `pnpm test:e2e`.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...(process.env as Record<string, string>),
      E2E_MODE: "1",
    },
  },
});
