import { expect, test } from "./helpers/test";
import {
  E2E_EMAIL,
  E2E_TA_EMAIL,
  E2E_TA_PASSWORD,
  ensureE2ETa,
  ensureE2EUser,
  signInE2E,
} from "./helpers/auth";

/**
 * Registry delta 2026-11-08 — bulk slot generation through the day-grouped
 * UI. The TA generates a two-day schedule with the preview panel ("N slots
 * across D days"), sees 12-hour time range boxes grouped under day headings,
 * changes a slot's capacity, and a re-submitted plan that overlaps stored
 * slots is rejected server-side (slot_overlap) instead of partially applying.
 */
test.describe("booking bulk generate", () => {
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now().toString(36).toUpperCase();
  const courseCode = `BG${stamp}`;
  const offeringCode = `${courseCode}-F26`;
  const sectionCode = "BG-A";
  const periodTitle = `Bulk window ${stamp}`;

  /** YYYY-MM-DD for a local date offset by days. */
  function isoDate(daysFromNow: number): string {
    const date = new Date(Date.now() + daysFromNow * 86_400_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** datetime-local value without a timezone suffix. */
  function toLocalInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  const windowStart = new Date(Date.now() + 2 * 86_400_000);
  windowStart.setHours(6, 0, 0, 0);
  const windowEnd = new Date(Date.now() + 4 * 86_400_000);
  windowEnd.setHours(22, 0, 0, 0);

  let periodPath: string;

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2ETa();
  });

  test("TA creates course, offering, section and period, then bulk-generates slots", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    // --- Course → offering (auto-staffs the TA) → section (mirrors journey).
    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("BG Bulk Engineering");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toBeHidden();

    const courseOption = page
      .getByTestId("offering-course")
      .locator("option", { hasText: courseCode });
    await expect(courseOption).toHaveCount(1, { timeout: 20_000 });
    await page
      .getByTestId("offering-course")
      .selectOption({ label: (await courseOption.textContent()) ?? "" });
    await page.getByTestId("offering-term").selectOption({ index: 1 });
    await page.getByTestId("offering-code").fill(offeringCode);
    await page.getByTestId("offering-submit").click();
    await expect(page.getByTestId("offering-submit")).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId("offering-form-error")).toBeHidden();

    await expect(async () => {
      await page.goto("/app/offerings");
      await expect(page.getByTestId("offering-item").filter({ hasText: offeringCode })).toHaveCount(
        1,
      );
    }).toPass({ timeout: 15_000 });
    const offeringHref = await page
      .getByTestId("offering-item")
      .filter({ hasText: offeringCode })
      .getAttribute("href");
    await page.goto(offeringHref!);

    await page.getByTestId("section-code").fill(sectionCode);
    await page.getByTestId("section-capacity").fill("60");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();

    // --- Enroll the e2e student so the roster view has something to show.
    await page.getByTestId("section-item").filter({ hasText: sectionCode }).click();
    await page.getByTestId("hub-students").click();
    await page.getByTestId("enrollment-section").selectOption({ label: sectionCode });
    await page.getByTestId("enrollment-email").fill(E2E_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toBeVisible({
      timeout: 15_000,
    });

    // --- Create a wide period, then generate the schedule in one shot.
    await page.goto("/app/bookings");
    await page.getByTestId("new-period-link").click();
    const periodOfferingOption = page
      .getByTestId("period-offering")
      .locator("option", { hasText: offeringCode });
    await expect(periodOfferingOption).toHaveCount(1, { timeout: 20_000 });
    await page
      .getByTestId("period-offering")
      .selectOption({ label: (await periodOfferingOption.first().textContent()) ?? "" });
    await page.getByTestId("period-section").selectOption({ label: sectionCode });
    await page.getByTestId("period-title").fill(periodTitle);
    await page.getByTestId("period-starts").fill(toLocalInput(windowStart));
    await page.getByTestId("period-ends").fill(toLocalInput(windowEnd));
    await page.getByTestId("period-submit").click();
    await expect(page.getByTestId("period-success")).toBeVisible({ timeout: 15_000 });

    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    const periodHref = await periodRow.getByTestId("booking-period-link").getAttribute("href");
    await page.goto(periodHref!);
    periodPath = periodHref!;
    // First visit compiles the route in dev; give hydration time to attach
    // before touching controlled inputs (otherwise React resets the value).
    await page.waitForTimeout(2_000);

    // --- Bulk form: two days × 30-minute slots, 09:00–11:00 daily window.
    // Retry the first fill: it can land before hydration and be reset.
    const fromInput = page.getByTestId("bulk-from-date");
    await expect(async () => {
      await fromInput.fill(isoDate(2));
      await page.waitForTimeout(1_000);
      await expect(fromInput).toHaveValue(isoDate(2));
    }).toPass({ timeout: 25_000 });
    await page.getByTestId("bulk-to-date").fill(isoDate(3));
    await page.getByTestId("bulk-daily-start").fill("09:00");
    await page.getByTestId("bulk-daily-end").fill("11:00");
    await page.getByTestId("bulk-slot-minutes").fill("30");
    await page.getByTestId("bulk-capacity").fill("2");
    await page.getByTestId("bulk-location").fill("Bulk hall");

    // Live preview resolves to 4 slots/day × 2 days = 8 in total.
    await expect(page.getByTestId("bulk-preview-summary")).toHaveText(
      /8\s+slots\s+across\s+2\s+days/i,
    );

    await page.getByTestId("bulk-slot-submit").click();
    await expect(page.getByTestId("bulk-slot-success")).toBeVisible({ timeout: 20_000 });

    // --- Day-grouped boxes: two day sections with 4 rectangular cards each.
    await expect(page.getByTestId("booking-slot-days")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("slot-day-0")).toBeVisible();
    await expect(page.getByTestId("slot-day-1")).toBeVisible();
    const slotCards = page.getByTestId("booking-slot");
    await expect(slotCards).toHaveCount(8);

    // Every card shows a 12-hour range "H:MM AM - H:MM AM/PM".
    for (const card of await slotCards.all()) {
      await expect(card.getByTestId("slot-time")).toHaveText(
        /\d{1,2}:\d{2} (AM|PM) - \d{1,2}:\d{2} (AM|PM)/i,
      );
    }

    // Day headings render as "Weekday, D Mon YYYY".
    const firstHeading = page.getByTestId("slot-day-0").locator("summary");
    await expect(firstHeading).toContainText(/, \d{1,2} [A-Z][a-z]{2} \d{4}/);
  });

  test("overlapping regeneration is rejected and staff can edit capacity", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });
    await page.goto(periodPath);
    await page.waitForTimeout(1_500);

    // Same daily window on the same days overlaps everything already stored.
    const overlapFrom = page.getByTestId("bulk-from-date");
    await expect(async () => {
      await overlapFrom.fill(isoDate(2));
      await page.waitForTimeout(1_000);
      await expect(overlapFrom).toHaveValue(isoDate(2));
    }).toPass({ timeout: 25_000 });
    await page.getByTestId("bulk-to-date").fill(isoDate(3));
    await page.getByTestId("bulk-daily-start").fill("10:00");
    await page.getByTestId("bulk-daily-end").fill("11:00");
    await page.getByTestId("bulk-slot-minutes").fill("30");
    await page.getByTestId("bulk-capacity").fill("2");

    await expect(page.getByTestId("bulk-preview-error")).toBeHidden({ timeout: 5_000 });
    await page.getByTestId("bulk-slot-submit").click();
    // The mapped database error (slot_overlap) reaches the form error slot.
    await expect(page.getByTestId("bulk-slot-form-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bulk-slot-form-error")).toContainText(/overlap/i);

    // The rejected plan still created nothing: there are exactly 8 cards.
    await expect(page.getByTestId("booking-slot")).toHaveCount(8);

    // Staff capacity edit: leave the first slot as-is, then bring it to 3.
    const firstCapacityInput = page.locator("[data-testid^='capacity-input-']").first();
    await firstCapacityInput.fill("3");
    const firstCapacitySlot = page.getByTestId("booking-slot").first();
    await page.locator("[data-testid^='capacity-save-']").first().click();
    await expect(firstCapacitySlot.getByTestId("slot-capacity")).toContainText(/\/3$/, {
      timeout: 20_000,
    });
  });
});
