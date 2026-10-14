import { expect, test } from "@playwright/test";
import { ensureE2EUser, signInE2E } from "./helpers/auth";

// Design system: 360 px baseline, no horizontal page scroll (design-system.md L11)
test.use({ viewport: { width: 360, height: 800 } });

test("app shell renders on mobile with bottom nav and no horizontal scroll", async ({ page }) => {
  await ensureE2EUser();
  await signInE2E(page);

  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar")).toBeHidden();
  await expect(page.getByTestId("app-main")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("landing renders on mobile with no horizontal scroll", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.locator("main h1")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("document title uses product name from env", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Metria/);
});
