import { expect, test } from "./helpers/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_STUDENT2_EMAIL,
  E2E_TA_EMAIL,
  E2E_TA_PASSWORD,
  ensureE2EStudent2,
  ensureE2ETa,
  ensureE2EUser,
  signInE2E,
} from "./helpers/auth";

/**
 * Registry delta 2026-11-08 — "Switch here": a student with an active booking
 * moves it to another free slot in one atomic RPC; the old seat is freed only
 * when the new one commits. The UI gates the switch: free slots show it for
 * students who already hold a booking in the period, full slots hide it, and
 * students without a booking see plain book buttons instead.
 */
test.describe("booking switch slot", () => {
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now().toString(36).toUpperCase();
  const courseCode = `BS${stamp}`;
  const offeringCode = `${courseCode}-F26`;
  const sectionCode = "BS-A";
  const periodTitle = `Switch window ${stamp}`;
  const labA = `Switch lab A ${stamp}`;
  const labB = `Switch lab B ${stamp}`;

  function toLocalInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  const windowStart = new Date(Date.now() + 3 * 86_400_000);
  windowStart.setHours(6, 0, 0, 0);
  const windowEnd = new Date(Date.now() + 3 * 86_400_000);
  windowEnd.setHours(23, 0, 0, 0);
  const slot1 = new Date(windowStart);
  slot1.setHours(10, 0, 0, 0);
  const slot1End = new Date(slot1);
  slot1End.setMinutes(15);
  const slot2 = new Date(windowStart);
  slot2.setHours(11, 0, 0, 0);
  const slot2End = new Date(slot2);
  slot2End.setMinutes(15);

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2EStudent2();
    await ensureE2ETa();
  });

  test("TA prepares the period with a tight and a roomy slot", async ({ page }) => {
    test.setTimeout(180_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("BS Switch Engineering");
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

    await page.getByTestId("section-item").filter({ hasText: sectionCode }).click();
    await page.getByTestId("hub-students").click();
    for (const email of [E2E_EMAIL, E2E_STUDENT2_EMAIL]) {
      await page.getByTestId("enrollment-section").selectOption({ label: sectionCode });
      await page.getByTestId("enrollment-email").fill(email);
      await page.getByTestId("enrollment-submit").click();
      await expect(page.getByTestId("enrollment-item").filter({ hasText: email })).toBeVisible({
        timeout: 15_000,
      });
    }

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

    // Slot A: cap 1 (becomes a full target), slot B: cap 2 (switch target).
    for (const [location, start, end, capacity] of [
      [labA, slot1, slot1End, "1"],
      [labB, slot2, slot2End, "2"],
    ] as const) {
      await page.getByTestId("slot-starts").fill(toLocalInput(start));
      await page.getByTestId("slot-ends").fill(toLocalInput(end));
      await page.getByTestId("slot-form").getByTestId("slot-capacity").fill(capacity);
      await page.getByTestId("slot-location").fill(location);
      await page.getByTestId("slot-submit").click();
      await expect(page.getByTestId("slot-form-error")).toBeHidden();
      await expect(page.getByTestId("slot-success")).toBeVisible({ timeout: 15_000 });
    }

    await expect(page.getByTestId("booking-slot")).toHaveCount(2);
  });

  test("student swaps their booking with Switch here", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_EMAIL, password: E2E_PASSWORD });

    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    const periodHref = await periodRow.getByTestId("booking-period-link").getAttribute("href");
    await page.goto(periodHref!);

    const slotA = page.getByTestId("booking-slot").filter({ hasText: labA });
    const slotB = page.getByTestId("booking-slot").filter({ hasText: labB });

    // No booking in the period yet: plain book buttons, no switch buttons.
    await expect(page.locator("[data-testid^='switch-slot-']")).toHaveCount(0);
    await slotA.getByTestId("book-slot").click();
    await expect(slotA.getByTestId("my-booking")).toBeVisible({ timeout: 20_000 });

    // Holding a booking turns free slots into "Switch here" targets.
    const switchButtons = page.locator("[data-testid^='switch-slot-']");
    await expect(switchButtons).toHaveCount(1);
    await switchButtons.first().click();
    await expect(slotB.getByTestId("my-booking")).toBeVisible({ timeout: 20_000 });
    await expect(slotA.getByTestId("my-booking")).toHaveCount(0);

    // Slot A is free again and offers a switch back; slot B is now booked by me.
    await expect(slotB.getByTestId("slot-status")).toHaveText(/booked by me/i);
    await expect(switchButtons).toHaveCount(1);
  });

  test("second student sees the fuller slot and plain book buttons", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_STUDENT2_EMAIL, password: E2E_PASSWORD });

    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    const periodHref = await periodRow.getByTestId("booking-period-link").getAttribute("href");
    await page.goto(periodHref!);

    const slotA = page.getByTestId("booking-slot").filter({ hasText: labA });
    const slotB = page.getByTestId("booking-slot").filter({ hasText: labB });

    // No booking in the period: no switch buttons anywhere.
    await expect(page.locator("[data-testid^='switch-slot-']")).toHaveCount(0);
    await expect(slotA.getByTestId("slot-capacity")).toHaveText("0/1");
    await expect(slotB.getByTestId("slot-capacity")).toHaveText("1/2");

    // Student 2 fills slot A (the tight one); peer identities stay hidden.
    await slotA.getByTestId("book-slot").click();
    await expect(slotA.getByTestId("my-booking")).toBeVisible({ timeout: 20_000 });
    await expect(slotA.getByTestId("slot-students")).toHaveCount(0);
  });

  test("TA sees the roster per slot with 12-hour times and counts", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    const periodHref = await periodRow.getByTestId("booking-period-link").getAttribute("href");
    await page.goto(periodHref!);

    const slotRows = page.getByTestId("booking-slot");
    await expect(slotRows).toHaveCount(2);
    await expect(slotRows.nth(0).locator("[data-testid^='delete-slot-']").first()).toBeVisible();
    await expect(slotRows.nth(0).locator("[data-testid^='capacity-form-']").first()).toBeVisible();

    // Staff roster with the count summary and CSV export.
    await expect(page.getByTestId("period-bookings-table")).toBeVisible();
    await expect(page.getByTestId("bookings-count-summary")).toContainText(/2 slots/i);
    await expect(page.getByTestId("bookings-count-summary")).toContainText(/2 booked/i);
    await expect(page.getByTestId("export-bookings-csv")).toBeVisible();
    await expect(page.getByTestId("filter-day")).toBeVisible();
    await expect(page.getByTestId("filter-slot")).toBeVisible();
  });
});
