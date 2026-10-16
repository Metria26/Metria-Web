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

// T-A005 journey (2.4 announcements + 2.5 analytics wiring).
test.describe("dashboard and announcements journey", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    // The enrolled viewer is the e2e member profile itself, so the student
    // dashboard RPC resolves the same authenticated user.
    await ensureE2EUser();
    await ensureE2ETa();
  });

  test("TA posts a section announcement and sees class analytics on the offering", async ({
    page,
  }) => {
    // Dev-mode server actions + several navigations exceed the 30s default.
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36).toUpperCase();
    const courseCode = `E2A${stamp}`;
    const offeringCode = `${courseCode}-F26`;
    const announcementTitle = `Welcome ${stamp}`;

    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    // --- Setup: course → offering (auto-staffs the TA) → section.
    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await expect(page).toHaveURL(/\/app\/offerings\/new$/);

    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("E2A Software Engineering");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toBeHidden();

    const courseOption = page
      .getByTestId("offering-course")
      .locator("option", { hasText: courseCode });
    // Dev-server first compile + revalidatePath refresh can exceed the 5s
    // default under a loaded machine.
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
    const offeringLink = page.getByTestId("offering-item").filter({ hasText: offeringCode });
    const offeringHref = await offeringLink.getAttribute("href");
    expect(offeringHref).toMatch(/\/app\/offerings\/[0-9a-f-]+$/);
    await page.goto(offeringHref!);

    await page.getByTestId("section-code").fill("ANN-A");
    await page.getByTestId("section-capacity").fill("60");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();
    await expect(page.getByTestId("section-item").filter({ hasText: "ANN-A" })).toBeVisible({
      timeout: 20_000,
    });

    // --- Post a rich-text announcement to the section.
    await page
      .getByTestId("announcement-section")
      .selectOption({ label: "ANN-A" }, { timeout: 20_000 });
    await page.getByTestId("announcement-title").fill(announcementTitle);
    const editor = page
      .getByTestId("announcement-editor")
      .locator('.tiptap, [contenteditable="true"]');
    await editor.click();
    await editor.pressSequentially("Bring calculators to the quiz.");
    await page.getByTestId("announcement-submit").click();
    await expect(page.getByTestId("announcement-success")).toBeVisible({ timeout: 15_000 });

    const announcementItem = page
      .getByTestId("announcement-item")
      .filter({ hasText: announcementTitle });
    await expect(announcementItem).toBeVisible({ timeout: 15_000 });
    await expect(announcementItem).toContainText("Bring calculators to the quiz.");

    // --- Class analytics section is staff-only and renders after the RPC.
    await expect(page.getByRole("heading", { name: "Class analytics" })).toBeVisible();
    await expect(page.getByTestId("analytics-empty-assessments")).toBeVisible();

    // --- Enroll the e2e member so the student dashboard has data.
    await page.getByTestId("enrollment-section").selectOption({ label: "ANN-A" });
    await page.getByTestId("enrollment-email").fill(E2E_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-form-error")).toBeHidden();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("enrolled student sees the announced section update on the dashboard", async ({ page }) => {
    test.setTimeout(60_000);
    await signInE2E(page, { email: E2E_EMAIL, password: E2E_PASSWORD });

    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Announcements card renders the TA's post (one bounded RPC).
    await expect(page.getByTestId("announcements-list")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("announcement-item").first()).toBeVisible();

    // The three dashboard sections exist.
    await expect(page.getByRole("heading", { name: "Latest marks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming assessments" })).toBeVisible();
  });
});
