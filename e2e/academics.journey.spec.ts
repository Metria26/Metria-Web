import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_TA_EMAIL,
  E2E_TA_PASSWORD,
  ensureE2ETa,
  signInE2E,
} from "./helpers/auth";

// The seeded student profile (supabase/seed.sql section 9) — enrollable by email.
const SEED_STUDENT_EMAIL = "student.dev@lhr.nu.edu.pk";

test.describe("TA academics journey", () => {
  test.beforeAll(async () => {
    await ensureE2ETa();
  });

  test("TA creates course → offering → section → assessment → enrolls student", async ({
    page,
  }) => {
    // Dev-mode server actions + several navigations exceed the 30s default.
    test.setTimeout(120_000);
    // Unique per run so repeated local runs never hit the (university_id, code) duplicate.
    const stamp = Date.now().toString(36).toUpperCase();
    const courseCode = `E2E${stamp}`;
    const offeringCode = `${courseCode}-F26`;

    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    // --- Catalog page: empty or existing list, then open the create page.
    await page.goto("/app/offerings");
    await expect(page.getByRole("heading", { name: "Offerings" })).toBeVisible();
    await page.getByTestId("new-offering-link").click();
    await expect(page).toHaveURL(/\/app\/offerings\/new$/);

    // --- 1. Create the course.
    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("E2E Software Engineering");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toBeHidden();

    // --- 2. Create the offering (course select refreshes via revalidatePath).
    const courseOption = page
      .getByTestId("offering-course")
      .locator("option", { hasText: courseCode });
    await expect(courseOption).toHaveCount(1);
    const courseLabel = (await courseOption.textContent()) ?? "";
    await page.getByTestId("offering-course").selectOption({ label: courseLabel });
    // Seeded by supabase/seed.sql — the TA's tenant has exactly one term.
    await page.getByTestId("offering-term").selectOption({ index: 1 });
    await page.getByTestId("offering-code").fill(offeringCode);
    await page.getByTestId("offering-submit").click();
    await expect(page.getByTestId("offering-form-error")).toBeHidden();

    // --- 3. Open the new offering from the list.
    // The offering insert is a server action; the error-hidden assertion above
    // passes while it is still in flight, so poll with a fresh navigation
    // until the row is visible (revalidatePath makes it appear).
    await expect(async () => {
      await page.goto("/app/offerings");
      await expect(page.getByTestId("offering-item").filter({ hasText: offeringCode })).toHaveCount(
        1,
      );
    }).toPass({ timeout: 15_000 });
    // data-testid="offering-item" is on the <a> itself (Next.js Link).
    const offeringLink = page.getByTestId("offering-item").filter({ hasText: offeringCode });
    const offeringHref = await offeringLink.getAttribute("href");
    expect(offeringHref).toMatch(/\/app\/offerings\/[0-9a-f-]+$/);
    await page.goto(offeringHref!);
    await expect(page.getByTestId("offering-meta")).toContainText(offeringCode);

    // --- 4. Add a section.
    await page.getByTestId("section-code").fill("E2E-A");
    await page.getByTestId("section-capacity").fill("35");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();
    await expect(page.getByTestId("section-item").filter({ hasText: "E2E-A" })).toBeVisible();

    // --- 5. Add an assessment.
    await page.getByTestId("assessment-title").fill("E2E Quiz 1");
    await page.getByTestId("assessment-total").fill("10");
    await page.getByTestId("assessment-weight").fill("15");
    await page.getByTestId("assessment-submit").click();
    await expect(page.getByTestId("assessment-form-error")).toBeHidden();
    const assessmentItem = page.getByTestId("assessment-item").filter({ hasText: "E2E Quiz 1" });
    await expect(assessmentItem).toBeVisible();
    await expect(assessmentItem).toContainText("15%");

    // --- 6. Enroll the seeded student by email (section select refreshes too).
    const sectionOption = page
      .getByTestId("enrollment-section")
      .locator("option", { hasText: "E2E-A" });
    await expect(sectionOption).toHaveCount(1);
    await page.getByTestId("enrollment-section").selectOption({ label: "E2E-A" });
    await page.getByTestId("enrollment-email").fill(SEED_STUDENT_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-form-error")).toBeHidden();
    const enrollmentItem = page
      .getByTestId("enrollment-item")
      .filter({ hasText: SEED_STUDENT_EMAIL });
    // Dev-server first compile under parallel workers can push the server
    // action past the 5s default (button still shows Saving…, not an error).
    await expect(enrollmentItem).toBeVisible({ timeout: 15_000 });
    await expect(enrollmentItem).toContainText("E2E-A");

    // --- 7. The offering shows up on the catalog page.
    await page.goto("/app/offerings");
    await expect(page.getByTestId("offering-item").filter({ hasText: offeringCode })).toHaveCount(
      1,
    );
  });

  test("member without manage permission can read but every write is denied", async ({ page }) => {
    await signInE2E(page, { email: E2E_EMAIL, password: E2E_PASSWORD });

    // Member read: the catalog lists the TA-created + seeded offerings.
    await page.goto("/app/offerings");
    await expect(page.getByRole("heading", { name: "Offerings" })).toBeVisible();
    await page.getByTestId("new-offering-link").click();

    // The read-only member can open the form and see seeded options…
    await expect(page.getByTestId("course-form")).toBeVisible();

    // …but the write is rejected by RLS (42501 → notAuthorized) with a translated message.
    await page.getByTestId("course-code").fill(`NOPE${Date.now().toString(36).toUpperCase()}`);
    await page.getByTestId("course-title").fill("Should not be created");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toHaveText(
      "You do not have permission to do this.",
    );
  });
});
