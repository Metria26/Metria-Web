import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  ensureE2EUser,
  ensureEnrollment,
  fixtureProfile,
  serviceRest,
  signInE2E,
} from "./helpers/auth";

/**
 * T-B003 ads safety (features 10.5, R1/R2/R3) — with the ad layer switched ON
 * this suite verifies the boundaries that must hold while ads can serve:
 *
 *  (a) /auth/* renders zero ad markup and zero ad network scripts (R3),
 *  (b) the consent banner asks before non-essential categories and the choice
 *      persists; reserved geometry keeps >= 16px clear of booking actions,
 *  (c) cumulative layout shift stays near zero while the sponsor loads,
 *  (d) a broken/aborted creative fails to the empty reserved box, page intact,
 *  (e) marks sit behind tap-to-reveal while ads serve (R1), and
 *  (f) a kill flip darkens the surface again (master kill, short TTL).
 *
 * It mutates GLOBAL state (feature flags + one sponsor fixture): page_types
 * keys are globally unique, so no tenant-scoped variant exists. CI runs it in
 * an isolated step (`--grep "ads-safety" --workers=1` after a
 * `--grep-invert "ads-safety"` pass). Run it standalone locally:
 *
 *   pnpm exec playwright test e2e/ads.safety.spec.ts --workers=1
 *
 * Every test title carries the [ads-safety] tag that the grep split keys on.
 */

/** Minimum clear gap between a reserved slot and a booking action (design token). */
const MIN_ACTION_SPACING_PX = 16;
/** Kill/config cache TTL is pinned to 1s via AD_CONFIG_CACHE_TTL_SECONDS (config). */
const KILL_TTL_GRACE_MS = 1_600;

const ADS_FLAGS_ON: Array<[string, boolean]> = [
  ["ads.enabled", true],
  ["ads.public.enabled", true],
  ["ads.private.enabled", true],
  ["ads.global_kill", false],
];
/** Shipped defaults (seed Section 6): layers off, master kill engaged. */
const ADS_FLAGS_OFF: Array<[string, boolean]> = [
  ["ads.enabled", false],
  ["ads.public.enabled", false],
  ["ads.private.enabled", false],
  ["ads.global_kill", true],
];

function consentCookie() {
  return {
    name: "metria_consent",
    value: encodeURIComponent(
      JSON.stringify({
        policyVersion: "v1",
        categories: { analytics: true, ads: true },
      }),
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

test.describe("ads safety (T-B003)", () => {
  test.describe.configure({ mode: "serial" });

  let universityId = "";
  let offeringId = "";
  let sectionId = "";
  let periodId = "";
  const sponsorIds: { sponsor?: string; creative?: string; slot?: string } = {};

  test.beforeAll(async () => {
    await ensureE2EUser();
    const profile = await fixtureProfile(E2E_EMAIL);
    universityId = profile.university_id;

    const offerings = await serviceRest<{ id: string; university_id: string }[]>(
      "course_offerings?offering_code=eq.CS301-F26&select=id,university_id",
    );
    const offering = offerings[0];
    if (!offering) throw new Error("seeded CS301-F26 offering not found");
    offeringId = offering.id;
    const sections = await serviceRest<{ id: string }[]>(
      `sections?offering_id=eq.${offering.id}&section_code=eq.A&select=id`,
    );
    sectionId = sections[0]?.id ?? "";
    if (!sectionId) throw new Error("seeded CS301-F26 section A not found");
    await ensureEnrollment(profile, sectionId);

    // Period + slot for the Book-action spacing check (fixture over service role).
    const periodRows = await serviceRest<{ id: string }[]>("evaluation_periods", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        section_id: sectionId,
        title: `E2E ads window ${Date.now().toString(36)}`,
        starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        ends_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        cutoff_hours: 6,
      }),
    });
    periodId = periodRows[0]?.id ?? "";
    if (!periodId) throw new Error("e2e ads period creation returned no row");
    await serviceRest("slots", {
      method: "POST",
      body: JSON.stringify({
        university_id: universityId,
        period_id: periodId,
        starts_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
        ends_at: new Date(Date.now() + 3 * 86_400_000 + 4_500_000).toISOString(),
        capacity: 3,
        location: "E2E ads lab",
      }),
    });

    // Ads live: flags on, master kill released.
    await setFlags(ADS_FLAGS_ON, universityId);

    // One active direct-sponsor creative targeted at the dashboard page type.
    const pageTypes = await serviceRest<{ id: string }[]>(
      `page_types?university_id=eq.${universityId}&key=eq.dashboard&select=id`,
    );
    const pageTypeId = pageTypes[0]?.id;
    if (!pageTypeId) throw new Error("seeded dashboard page type not found");

    const sponsors = await serviceRest<{ id: string }[]>("sponsors", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        name: "E2E Sponsor",
        is_active: true,
        created_by: profile.id,
      }),
    });
    sponsorIds.sponsor = sponsors[0]?.id ?? "";
    const creatives = await serviceRest<{ id: string }[]>("sponsor_creatives", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        sponsor_id: sponsorIds.sponsor,
        image_url: "/ads-test-creative.svg",
        target_url: "https://example.org/e2e-sponsor",
        starts_at: new Date(Date.now() - 86_400_000).toISOString(),
        ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    sponsorIds.creative = creatives[0]?.id ?? "";
    const slots = await serviceRest<{ id: string }[]>("sponsor_slots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        page_type_id: pageTypeId,
        creative_id: sponsorIds.creative,
        priority: 10,
      }),
    });
    sponsorIds.slot = slots[0]?.id ?? "";
    if (!sponsorIds.sponsor || !sponsorIds.creative || !sponsorIds.slot) {
      throw new Error("e2e sponsor fixture was not created");
    }
  });

  test.afterAll(async () => {
    // Shipped defaults first so no other suite can observe the flipped state.
    if (universityId) await setFlags(ADS_FLAGS_OFF, universityId);
    if (sponsorIds.slot) {
      await serviceRest(`sponsor_slots?id=eq.${sponsorIds.slot}`, { method: "DELETE" });
    }
    if (sponsorIds.creative) {
      await serviceRest(`sponsor_creatives?id=eq.${sponsorIds.creative}`, { method: "DELETE" });
    }
    if (sponsorIds.sponsor) {
      await serviceRest(`sponsors?id=eq.${sponsorIds.sponsor}`, { method: "DELETE" });
    }
  });

  test("[ads-safety] auth pages carry no ad markup, no ad scripts and the security headers (R3/R2)", async ({
    page,
  }) => {
    for (const path of ["/auth/sign-in", "/auth/access-denied"]) {
      await page.goto(path);
      await expect(page.getByTestId("ad-slot")).toHaveCount(0);
      await expect(page.getByTestId("consent-banner")).toHaveCount(0);
      await expect(page.locator("script[data-ad-network-script]")).toHaveCount(0);
      await expect(page.locator("iframe[data-ad-network-frame]")).toHaveCount(0);
    }

    const res = await page.request.get("/auth/sign-in");
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-security-policy-report-only"]).toContain("report-uri /api/csp-report");
    expect(headers["content-security-policy-report-only"]).toContain("img-src");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
  });

  test("[ads-safety] consent banner asks once and the choice persists", async ({ page }) => {
    await signInE2E(page);
    await expect(page.getByTestId("consent-banner")).toBeVisible();
    await expect(page.getByTestId("ad-slot").first()).toHaveAttribute(
      "data-state",
      /^(filled|empty)$/,
    );

    await page.getByTestId("consent-accept").click();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);

    await page.goto("/app/bookings");
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  });

  test("[ads-safety] reserved geometry keeps the sponsor box clear of booking actions", async ({
    page,
  }) => {
    await page.context().addCookies([consentCookie()]);
    await signInE2E(page);

    // Dashboard mounts the slot and fills it with the seeded direct sponsor.
    await page.goto("/app");
    const dashSlot = page.getByTestId("ad-slot");
    await expect(dashSlot).toHaveCount(1);
    await expect(dashSlot).toHaveAttribute("data-slot-key", "dashboard-top");
    await expect(dashSlot).toHaveAttribute("data-state", "filled");
    await expect(page.getByTestId("ad-sponsor")).toBeVisible();

    // Booking period page: reserved box above the Book action, never adjacent.
    await page.goto(`/app/bookings/${periodId}`);
    const adSlot = page.getByTestId("ad-slot");
    await expect(adSlot).toHaveCount(1);
    await expect(adSlot).toHaveAttribute("data-slot-key", "booking-top");
    const bookButton = page.getByTestId("book-slot");
    await expect(bookButton).toBeVisible();

    const adBox = await adSlot.boundingBox();
    const bookBox = await bookButton.boundingBox();
    expect(adBox).not.toBeNull();
    expect(bookBox).not.toBeNull();
    if (!adBox || !bookBox) return;
    expect(adBox.height).toBeGreaterThanOrEqual(72);
    // The slot sits above the action with a clear gap; no overlap either way.
    const gap = bookBox.y - (adBox.y + adBox.height);
    expect(gap).toBeGreaterThanOrEqual(MIN_ACTION_SPACING_PX);
  });

  test("[ads-safety] cumulative layout shift stays near zero while ads serve", async ({ page }) => {
    await page.context().addCookies([consentCookie()]);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls?: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!shift.hadRecentInput) w.__cls = (w.__cls ?? 0) + shift.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await signInE2E(page);
    await expect(page.getByTestId("ad-slot").first()).toHaveAttribute("data-state", "filled");
    // Give the sponsor image time to load inside the reserved box.
    await page.waitForTimeout(750);
    const cls = await page.evaluate(() => (window as unknown as { __cls?: number }).__cls ?? 999);
    expect(cls).toBeLessThan(0.1);
  });

  test("[ads-safety] an aborted sponsor creative leaves the empty reserved slot (fail empty)", async ({
    page,
  }) => {
    await page.context().addCookies([consentCookie()]);
    await page.route("**/ads-test-creative.svg", (route) => route.abort());
    await signInE2E(page);

    await page.goto("/app");
    const slot = page.getByTestId("ad-slot");
    await expect(slot).toHaveAttribute("data-state", "empty");
    // The page itself stays fully intact (dashboard renders either its content
    // or its empty state — the shell main region must be there either way).
    await expect(page.getByTestId("app-main")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("[ads-safety] marks sit behind tap-to-reveal while ads serve (R1)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.context().addCookies([consentCookie()]);
    await signInE2E(page);

    await page.goto(`/app/offerings/${offeringId}/marksheet`);
    await expect(page.getByTestId("sensitive-gate")).toHaveAttribute("data-state", "hidden");
    await expect(page.getByTestId("marksheet-total")).toHaveCount(0);
    await expect(page.getByTestId("ad-slot")).toHaveCount(1);

    await page.getByTestId("reveal-button").click();
    await expect(page.getByTestId("sensitive-gate")).toHaveAttribute("data-state", "revealed");
    await expect(page.getByTestId("marksheet-total")).toBeVisible();
  });

  test("[ads-safety] a master kill flip darkens the surface again", async ({ page }) => {
    await setFlags([["ads.global_kill", true]], universityId);
    await page.waitForTimeout(KILL_TTL_GRACE_MS);

    // No consent cookie here: with ads merely flagged on the banner would show,
    // so banner + slot both absent proves the kill reached the renderer.
    await signInE2E(page);
    await page.goto("/app");
    await expect(page.getByTestId("ad-slot")).toHaveCount(0);
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  });
});
