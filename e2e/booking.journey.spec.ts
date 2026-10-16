import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_TA_EMAIL,
  E2E_TA_PASSWORD,
  ensureE2ETa,
  ensureE2EUser,
  signInE2E,
} from "./helpers/auth";

/**
 * T-A006 journey (features 3.1 + 3.2): the TA opens an evaluation period with
 * a capacity-2 slot for a section, the enrolled student books one seat, sees it
 * on the dashboard, then cancels it while the per-period cutoff allows it —
 * after which the slot is bookable again (cancel differs from delete).
 */
test.describe("booking journey", () => {
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now().toString(36).toUpperCase();
  const courseCode = `BKA${stamp}`;
  const offeringCode = `${courseCode}-F26`;
  const sectionCode = "BK-A";
  const periodTitle = `Booking window ${stamp}`;
  const slotLocation = `BK Lab ${stamp}`;

  /** datetime-local value (no timezone) for a fixed local hour. */
  function toLocalInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  const windowStart = new Date(Date.now() + 2 * 86_400_000);
  windowStart.setHours(9, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setHours(10, 0, 0, 0);
  const slotStart = new Date(windowStart);
  slotStart.setMinutes(30);
  const slotEnd = new Date(windowStart);
  slotEnd.setMinutes(45);

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2ETa();
  });

  test("TA creates a period with a slot for the enrolled section", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    // --- Setup: course → offering (auto-staffs the TA) → section (T-A003 UI).
    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await expect(page).toHaveURL(/\/app\/offerings\/new$/);

    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("BKA Booking Engineering");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toBeHidden();

    const courseOption = page
      .getByTestId("offering-course")
      .locator("option", { hasText: courseCode });
    await expect(courseOption).toHaveCount(1, { timeout: 20_000 });
    const courseLabel = (await courseOption.textContent()) ?? "";
    await page.getByTestId("offering-course").selectOption({ label: courseLabel });
    await page.getByTestId("offering-term").selectOption({ index: 1 });
    await page.getByTestId("offering-code").fill(offeringCode);
    await page.getByTestId("offering-submit").click();
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
    expect(offeringHref).toMatch(/\/app\/offerings\/[0-9a-f-]+$/);
    await page.goto(offeringHref!);

    await page.getByTestId("section-code").fill(sectionCode);
    await page.getByTestId("section-capacity").fill("60");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();
    await expect(page.getByTestId("section-item").filter({ hasText: sectionCode })).toBeVisible({
      timeout: 20_000,
    });

    // --- Enroll the e2e member so the student can see and book the period.
    await page.getByTestId("enrollment-section").selectOption({ label: sectionCode });
    await page.getByTestId("enrollment-email").fill(E2E_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-form-error")).toBeHidden();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toBeVisible({
      timeout: 15_000,
    });

    // --- Open the evaluation period from the bookings hub.
    await page.goto("/app/bookings");
    await page.getByTestId("new-period-link").click();
    await expect(page).toHaveURL(/\/app\/bookings\/new$/);

    const periodOfferingOption = page
      .getByTestId("period-offering")
      .locator("option", { hasText: offeringCode });
    // Dev-server first compile + revalidatePath refresh can exceed the 5s
    // default under a loaded machine (mirrors the dashboard journey).
    await expect(periodOfferingOption).toHaveCount(1, { timeout: 20_000 });
    const offeringLabel = (await periodOfferingOption.first().textContent()) ?? "";
    await page.getByTestId("period-offering").selectOption({ label: offeringLabel });
    await page.getByTestId("period-section").selectOption({ label: sectionCode });
    await page.getByTestId("period-title").fill(periodTitle);
    await page.getByTestId("period-starts").fill(toLocalInput(windowStart));
    await page.getByTestId("period-ends").fill(toLocalInput(windowEnd));
    await page.getByTestId("period-submit").click();
    await expect(page.getByTestId("period-form-error")).toBeHidden();
    await expect(page.getByTestId("period-success")).toBeVisible({ timeout: 15_000 });

    // --- The period appears on the hub; add one capacity-2 slot to it.
    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    await periodRow.getByTestId("booking-period-link").click();
    await expect(page.getByTestId("period-title")).toHaveText(periodTitle);
    await expect(page.getByTestId("no-slots")).toBeVisible();

    await page.getByTestId("slot-starts").fill(toLocalInput(slotStart));
    await page.getByTestId("slot-ends").fill(toLocalInput(slotEnd));
    await page.getByTestId("slot-capacity").fill("2");
    await page.getByTestId("slot-location").fill(slotLocation);
    await page.getByTestId("slot-submit").click();
    await expect(page.getByTestId("slot-form-error")).toBeHidden();
    await expect(page.getByTestId("slot-success")).toBeVisible({ timeout: 15_000 });

    const slotRow = page.getByTestId("booking-slot").filter({ hasText: slotLocation });
    await expect(slotRow).toBeVisible({ timeout: 15_000 });
    // Staff view: only offering staff see per-slot student lists.
    await expect(slotRow.getByTestId("slot-students")).toBeVisible();
  });

  test("enrolled student books the slot, sees it on the dashboard and cancels it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInE2E(page, { email: E2E_EMAIL, password: E2E_PASSWORD });

    // --- Pick the period from the bookings hub.
    await page.goto("/app/bookings");
    const periodRow = page.getByTestId("booking-period").filter({ hasText: periodTitle });
    await expect(periodRow).toBeVisible({ timeout: 15_000 });
    await periodRow.getByTestId("booking-period-link").click();
    await expect(page.getByTestId("period-title")).toHaveText(periodTitle);

    const slotRow = page.getByTestId("booking-slot").filter({ hasText: slotLocation });
    await expect(slotRow).toBeVisible({ timeout: 15_000 });
    // Students never see peer identities or the staff student list.
    await expect(slotRow.getByTestId("slot-students")).toHaveCount(0);

    // --- Book the slot (atomic RPC; capacity 2 of which we take one).
    await slotRow.getByTestId("book-slot").click();
    await expect(slotRow.getByTestId("my-booking")).toBeVisible({ timeout: 20_000 });
    await expect(slotRow.getByTestId("cancel-booking")).toBeVisible();

    // --- Dashboard card shows the upcoming booking with the seats summary.
    await page.goto("/app");
    const dashboardRow = page.getByTestId("dashboard-booking").filter({ hasText: periodTitle });
    await expect(dashboardRow).toBeVisible({ timeout: 20_000 });
    await expect(dashboardRow).toContainText("Booked");
    const dashboardHref = await dashboardRow
      .getByTestId("dashboard-booking-link")
      .getAttribute("href");
    expect(dashboardHref).toMatch(/\/app\/bookings\/[0-9a-f-]+$/);

    // --- Cancel before the cutoff: the seat frees and the slot is bookable again.
    await dashboardRow.getByTestId("dashboard-booking-link").click();
    await expect(page.getByTestId("period-title")).toHaveText(periodTitle);
    const detailSlotRow = page.getByTestId("booking-slot").filter({ hasText: slotLocation });
    await detailSlotRow.getByTestId("cancel-booking").click();
    await expect(detailSlotRow.getByTestId("my-booking")).toBeHidden({ timeout: 20_000 });
    await expect(detailSlotRow.getByTestId("book-slot")).toBeVisible();
  });
});
