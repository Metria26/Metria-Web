import { test as base, expect } from "@playwright/test";

/**
 * Shared E2E test fixture.
 *
 * The app shell mounts the three reviewed Adsterra units on every /app page.
 * They are production ad code: external requests can be slow, and the Social
 * Bar injects a body-level overlay that intercepts clicks. Shell tests must
 * never depend on a live ad network, so every test aborts Adsterra requests by
 * default. The ads-safety suite still asserts the reviewed markup and script
 * elements; it simply never lets them execute a network creative.
 */
export { expect };

export const test = base.extend<{ blockAdNetwork: void }>({
  blockAdNetwork: [
    async ({ page }, use) => {
      await page.route(/bauval\.org/i, (route) => route.abort());
      await use();
    },
    { auto: true },
  ],
});
