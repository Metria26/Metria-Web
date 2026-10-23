import { expect, test } from "./helpers/test";

test("home page renders", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main h1")).toBeVisible();
});
