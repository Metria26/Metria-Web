import { expect, type Page } from "@playwright/test";

/**
 * Local Supabase stack constants — the default demo keys every
 * `supabase start` uses (publicly documented demo values, not secrets;
 * same values as .env.local). Google sign-in cannot be automated, so shell
 * tests use a fixture password user + the E2E_MODE-only session route.
 */
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const E2E_EMAIL = "e2e.student@lhr.nu.edu.pk";
export const E2E_PASSWORD = "e2e-Password123!";

/** Creates the fixture user through the local admin API (fires the F3 triggers). */
export async function ensureE2EUser(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { email_verified: true, full_name: "E2E Student" },
    }),
  });
  // 422 = already exists (repeated local runs); anything else is a real failure.
  if (!res.ok && res.status !== 422) {
    throw new Error(`e2e user create failed: ${res.status} ${await res.text()}`);
  }
}

/** Signs in through the test-only route (requires the Playwright dev server with E2E_MODE=1). */
export async function signInE2E(page: Page): Promise<void> {
  await page.goto(
    `/auth/e2e-session?email=${encodeURIComponent(E2E_EMAIL)}&password=${encodeURIComponent(E2E_PASSWORD)}&next=/app`,
  );
  await expect(page).toHaveURL(/\/app$/);
  // The Next.js dev overlay host (<nextjs-portal>) covers the viewport in dev
  // even with zero issues and intercepts clicks on the sidebar.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}
