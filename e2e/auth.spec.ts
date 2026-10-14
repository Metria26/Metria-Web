import { expect, test } from "@playwright/test";
import { ensureE2EUser, signInE2E } from "./helpers/auth";

test("sign-in page renders with Google button and noindex", async ({ page }) => {
  const response = await page.goto("/auth/sign-in");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("sign-in-card")).toBeVisible();
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("anonymous /app redirects to sign-in with a next param", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fapp/);
  await expect(page.getByTestId("sign-in-card")).toBeVisible();
});

test("access-denied page renders", async ({ page }) => {
  const response = await page.goto("/auth/access-denied");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("access-denied-card")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("e2e session route requires credentials", async ({ request }) => {
  // maxRedirects: 0 — without credentials the route 302s to /auth/sign-in;
  // following it would report the sign-in page's 200.
  const res = await request.get("/auth/e2e-session", { maxRedirects: 0 });
  expect([302, 307, 404]).toContain(res.status());
});

test.describe("authenticated", () => {
  test.beforeAll(async () => {
    await ensureE2EUser();
  });

  test("sign-in bounces authenticated users to /app", async ({ page }) => {
    await signInE2E(page);
    await page.goto("/auth/sign-in");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("sign out returns to sign-in", async ({ page }) => {
    await signInE2E(page);
    await page.getByTestId("sign-out").first().click();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});
