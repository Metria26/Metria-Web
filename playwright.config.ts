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
  // Dev-mode server actions + revalidatePath refreshes on a loaded machine
  // exceed the 5s default (T-A005 made /app/offerings/[id] heavier).
  expect: {
    timeout: 10_000,
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
      // T-B003: collapse the ad config/kill cache TTL so ads.safety's kill-flip
      // test observes the change after its grace wait (cap stays 15s).
      AD_CONFIG_CACHE_TTL_SECONDS: "1",
    },
  },
});
