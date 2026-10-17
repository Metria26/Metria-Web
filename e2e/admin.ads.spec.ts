import { expect, test } from "@playwright/test";
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_EMAIL,
  ensureE2EAdmin,
  ensureE2EUser,
  serviceRest,
  signInE2E,
} from "./helpers/auth";

/**
 * AD3 admin ads console — the /admin/ads slice (plan §6):
 *
 *  (a) anon is sent to sign-in by the proxy (/admin added to the session
 *      gate), and a signed-in non-admin member is redirected to /app by the
 *      platform-admin guard,
 *  (b) a platform admin sees the console, toggles one placement through the
 *      UI (state flips and revalidates), the change lands in the append-only
 *      audit_log as ad.config.changed / placement, and toggling back leaves
 *      the fixture as found.
 *
 * No ads.* flags are mutated (unlike [ads-safety]), so this file runs in the
 * main CI step with normal worker parallelism. Titles avoid the "ads-safety"
 * tag the grep split keys on.
 */

type PlacementFixture = { id: string; slot_key: string; enabled: boolean };

/** Read + write-back hygiene: restore the first seeded placement after a crash mid-test. */
let restore: PlacementFixture | null = null;

test.afterAll(async () => {
  if (!restore) return;
  await serviceRest(`ad_placements?id=eq.${restore.id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: restore.enabled }),
  });
  restore = null;
});

test.describe("admin ads console", () => {
  test("anonymous visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/admin/ads");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("signed-in members without the platform cap are redirected to /app", async ({ page }) => {
    await ensureE2EUser();
    await signInE2E(page, { email: E2E_EMAIL });
    await page.goto("/admin/ads");
    await expect(page).toHaveURL(/\/app/);
  });

  test("platform admin toggles a placement and the change is audited", async ({ page }) => {
    await ensureE2EAdmin();

    const placements = await serviceRest<PlacementFixture[]>(
      "ad_placements?select=id,slot_key,enabled&order=slot_key&limit=1",
    );
    const target = placements[0];
    if (!target) throw new Error("e2e placement fixture missing (seed Section 11)");
    restore = target;

    await signInE2E(page, { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD });
    await page.goto("/admin/ads");

    await expect(page.getByTestId("admin-ads-page")).toBeVisible();
    await expect(page.getByTestId("admin-flags")).toBeVisible();
    await expect(page.getByTestId("admin-config")).toBeVisible();

    const stateId = `admin-placement-state-${target.id}`;
    const toggleId = `admin-placement-toggle-${target.id}`;
    await expect(page.getByTestId(stateId)).toHaveAttribute(
      "data-state",
      target.enabled ? "on" : "off",
    );

    // Flip it off (or on): the server action revalidates the page.
    await page.getByTestId(toggleId).click();
    await expect(page.getByTestId(stateId)).toHaveAttribute(
      "data-state",
      target.enabled ? "off" : "on",
    );

    // The console path writes one audit row with the registered event name.
    const audits = await serviceRest<
      { event_type: string; target_type: string; payload: Record<string, unknown> }[]
    >(
      "audit_log?event_type=eq.ad.config.changed&target_type=eq.placement&order=created_at.desc&limit=1",
    );
    expect(audits[0]?.payload).toMatchObject({
      action: "placement.enabled",
      enabled: !target.enabled,
    });

    // Console-driven restore, so the fixture ends where it started.
    await page.getByTestId(toggleId).click();
    await expect(page.getByTestId(stateId)).toHaveAttribute(
      "data-state",
      target.enabled ? "on" : "off",
    );
  });
});
