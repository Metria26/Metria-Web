import { expect, test } from "@playwright/test";
import { serviceRest } from "./helpers/auth";

/**
 * SS11 Adsterra landing integration. Mutates GLOBAL ad state (feature flags +
 * network enablement), so every title carries the [ads-safety] tag and CI runs
 * it in the isolated single-worker pass after the main suite.
 *
 * Coverage:
 *  (a) shipped defaults (ads off) -> zero Adsterra markup anywhere,
 *  (b) flags on + no consent -> zero ad markup, consent banner visible,
 *  (c) consent granted -> banner/native/social units render with exact codes,
 *  (d) forbidden routes (/app, /auth/*, /admin/*, 404) never carry Adsterra,
 *  (e) per-network kill darkens the landing page again,
 *  (f) master kill darkens the landing page again.
 */

const ADSTERRA_HOST = "https://bauval.org";
const NATIVE_SRC = `${ADSTERRA_HOST}/21/ce7743f7a63e3303a8a5bca86be972a9`;
const SOCIAL_SRC = `${ADSTERRA_HOST}/14/0d0d523604c826337be77b00f55115b5`;
const BANNER_SRC = `${ADSTERRA_HOST}/22/166ca6f5db0d4f74e14b5e11e470ec29`;

const KILL_TTL_GRACE_MS = 1_600;

const ADS_FLAGS_ON: Array<[string, boolean]> = [
  ["ads.enabled", true],
  ["ads.public.enabled", true],
  ["ads.private.enabled", true],
  ["ads.global_kill", false],
];
const ADS_FLAGS_OFF: Array<[string, boolean]> = [
  ["ads.enabled", false],
  ["ads.public.enabled", false],
  ["ads.private.enabled", false],
  ["ads.global_kill", true],
];

function consentCookie(ads: boolean) {
  return {
    name: "metria_consent",
    value: encodeURIComponent(
      JSON.stringify({ policyVersion: "v1", categories: { analytics: ads, ads } }),
    ),
    url: "http://localhost:3000",
  };
}

async function setFlags(flags: Array<[string, boolean]>, universityId: string): Promise<void> {
  for (const [key, enabled] of flags) {
    const rows = await serviceRest<{ id: string }[]>(
      `feature_flags?university_id=eq.${universityId}&key=eq.${key}&select=id`,
    );
    if (rows.length > 0 && rows[0]) {
      await serviceRest(`feature_flags?id=eq.${rows[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
    } else {
      await serviceRest("feature_flags", {
        method: "POST",
        body: JSON.stringify({ university_id: universityId, key, enabled }),
      });
    }
  }
}

async function universityId(): Promise<string> {
  const rows = await serviceRest<{ id: string }[]>(
    "universities?slug=eq.fast-nuces-lahore&select=id",
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("seeded university not found");
  return id;
}

/** Enables/disables the adsterra network row (kill-switch prerequisite). */
async function setNetworkEnabled(enabled: boolean): Promise<void> {
  const rows = await serviceRest<{ id: string }[]>("ad_networks?key=eq.adsterra&select=id");
  const id = rows[0]?.id;
  if (!id) throw new Error("seeded adsterra network not found");
  await serviceRest(`ad_networks?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

/**
 * Per-network kill row. Schema shape (D-B2-c): `is_global=false` requires
 * `network_id`, and the live kill state is the `enabled` column.
 */
async function setNetworkKill(universityIdValue: string, killed: boolean): Promise<void> {
  const networks = await serviceRest<{ id: string }[]>("ad_networks?key=eq.adsterra&select=id");
  const networkId = networks[0]?.id;
  if (!networkId) throw new Error("seeded adsterra network not found");

  const rows = await serviceRest<{ id: string }[]>(
    `ad_kill_switches?university_id=eq.${universityIdValue}&network_id=eq.${networkId}&is_global=eq.false&select=id`,
  );
  if (rows[0]) {
    await serviceRest(`ad_kill_switches?id=eq.${rows[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: killed }),
    });
    return;
  }
  if (!killed) return;
  await serviceRest("ad_kill_switches", {
    method: "POST",
    body: JSON.stringify({
      university_id: universityIdValue,
      network_id: networkId,
      is_global: false,
      enabled: true,
    }),
  });
}

async function adsterraMarkupCount(page: import("@playwright/test").Page): Promise<number> {
  return page
    .locator('script[src*="bauval.org"], iframe[src*="bauval.org"], [data-ad-unit-id]')
    .count();
}

test.describe("landing ads (SS11)", () => {
  test.describe.configure({ mode: "serial" });
  let uniId = "";

  test.beforeAll(async () => {
    uniId = await universityId();
    await setNetworkEnabled(true);
  });

  test.afterAll(async () => {
    if (uniId) {
      await setNetworkKill(uniId, false).catch(() => undefined);
      await setFlags(ADS_FLAGS_OFF, uniId).catch(() => undefined);
    }
    await setNetworkEnabled(false).catch(() => undefined);
  });

  test("[ads-safety] defaults: no ad markup with ads shipped dark", async ({ page }) => {
    await setFlags(ADS_FLAGS_OFF, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator("main h1")).toBeVisible();
    expect(await adsterraMarkupCount(page)).toBe(0);
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  });

  test("[ads-safety] flags on without consent: banner shown, zero ad markup", async ({ page }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.getByTestId("consent-banner")).toBeVisible();
    expect(await adsterraMarkupCount(page)).toBe(0);
  });

  test("[ads-safety] consent granted: all three units render with exact codes", async ({
    page,
  }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().addCookies([consentCookie(true)]);
    await page.goto("/");

    await expect(page.getByTestId("adsterra-banner-468")).toBeVisible();
    await expect(page.getByTestId("adsterra-native")).toBeVisible();
    await expect(page.getByTestId("adsterra-native-container")).toHaveAttribute(
      "id",
      "container-ce7743f7a63e3303a8a5bca86be972a9",
    );

    const frame = page.locator('iframe[data-ad-unit-id="31803284"]');
    await expect(frame).toHaveAttribute("width", "468");
    await expect(frame).toHaveAttribute("height", "60");
    const srcDoc = await frame.getAttribute("srcdoc");
    expect(srcDoc).toContain(BANNER_SRC);

    await expect(
      page.locator(`script[data-ad-unit-id="31803282"][src="${NATIVE_SRC}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`script[data-ad-unit-id="31803283"][src="${SOCIAL_SRC}"]`),
    ).toHaveCount(1);

    // Ads never cover the primary action.
    const cta = page.getByRole("link", { name: /Open app/i }).first();
    const ctaBox = await cta.boundingBox();
    const bannerBox = await page.getByTestId("adsterra-banner-468").boundingBox();
    expect(ctaBox && bannerBox).toBeTruthy();
    if (ctaBox && bannerBox) {
      expect(bannerBox.y).toBeGreaterThanOrEqual(ctaBox.y + ctaBox.height - 1);
    }
  });

  test("[ads-safety] consent denied: zero ad markup, site still usable", async ({ page }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().addCookies([consentCookie(false)]);
    await page.goto("/");
    expect(await adsterraMarkupCount(page)).toBe(0);
    await expect(page.locator("main h1")).toBeVisible();
  });

  test("[ads-safety] forbidden routes never carry Adsterra markup", async ({ page }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().addCookies([consentCookie(true)]);

    for (const path of ["/app", "/auth/sign-in", "/admin/ads", "/does-not-exist"]) {
      await page.goto(path);
      expect(await adsterraMarkupCount(page), `${path} must stay ad-free`).toBe(0);
    }
  });

  test("[ads-safety] legal pages carry at most the native unit", async ({ page }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().addCookies([consentCookie(true)]);
    await page.goto("/privacy");

    await expect(page.getByTestId("adsterra-native")).toBeVisible();
    await expect(page.getByTestId("adsterra-banner-468")).toHaveCount(0);
    await expect(page.locator(`script[data-ad-unit-id="31803283"]`)).toHaveCount(0);
  });

  test("[ads-safety] per-network kill darkens the landing page", async ({ page }) => {
    await setFlags(ADS_FLAGS_ON, uniId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.context().addCookies([consentCookie(true)]);
    await setNetworkKill(uniId, true);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);

    await page.goto("/");
    expect(await adsterraMarkupCount(page)).toBe(0);

    await setNetworkKill(uniId, false);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);
    await page.goto("/");
    expect(await adsterraMarkupCount(page)).toBeGreaterThan(0);
  });

  test("[ads-safety] master kill darkens the landing page", async ({ page }) => {
    await setFlags([["ads.global_kill", true]], uniId);
    await page.context().addCookies([consentCookie(true)]);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);

    await page.goto("/");
    expect(await adsterraMarkupCount(page)).toBe(0);
  });
});
