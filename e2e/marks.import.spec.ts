import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_TA_EMAIL,
  E2E_TA_PASSWORD,
  ensureE2ETa,
  ensureE2EUser,
  serviceRest,
  signInE2E,
} from "./helpers/auth";

// Seeded student profile (supabase/seed.sql section 9) — enrollable by email.
const SEED_STUDENT_EMAIL = "student.dev@lhr.nu.edu.pk";

test.describe("TA marks import journey", () => {
  // fullyParallel runs tests of one file across workers; the marksheet test
  // depends on state the TA test creates (offering id, imported scores).
  test.describe.configure({ mode: "serial" });

  // Shared with the student-facing test below (marks visibility fixture).
  let createdOfferingId: string;

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2ETa();
  });

  test("TA creates a staffed offering and imports marks via the two-phase CSV panel", async ({
    page,
  }) => {
    // Dev-mode server actions + several navigations exceed the 30s default.
    test.setTimeout(120_000);
    // Unique per run so repeated local runs never hit the (university_id, code) duplicate.
    const stamp = Date.now().toString(36).toUpperCase();
    const courseCode = `E2M${stamp}`;
    const offeringCode = `${courseCode}-F26`;

    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    // --- Setup: course → offering → section → assessment → enroll (TA becomes
    // offering staff automatically through createOfferingAction's staffing row).
    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await expect(page).toHaveURL(/\/app\/offerings\/new$/);

    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("E2M Software Engineering");
    await page.getByTestId("course-submit").click();
    await expect(page.getByTestId("course-form-error")).toBeHidden();

    const courseOption = page
      .getByTestId("offering-course")
      .locator("option", { hasText: courseCode });
    await expect(courseOption).toHaveCount(1);
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
    createdOfferingId = offeringHref!.split("/").pop()!;
    await page.goto(offeringHref!);

    await page.getByTestId("section-code").fill("IMP-A");
    await page.getByTestId("section-capacity").fill("40");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();
    await expect(page.getByTestId("section-item").filter({ hasText: "IMP-A" })).toBeVisible();

    await page.getByTestId("assessment-title").fill("E2M Quiz 1");
    await page.getByTestId("assessment-total").fill("10");
    await page.getByTestId("assessment-weight").fill("10");
    await page.getByTestId("assessment-submit").click();
    await expect(page.getByTestId("assessment-form-error")).toBeHidden();
    const assessmentItem = page.getByTestId("assessment-item").filter({ hasText: "E2M Quiz 1" });
    await expect(assessmentItem).toBeVisible();

    // Staffed creator sees the per-assessment marks entry link (viewerIsStaff).
    const marksLink = page.getByTestId("marks-link");
    await expect(marksLink).toHaveCount(1);
    const marksHref = await marksLink.getAttribute("href");
    expect(marksHref).toMatch(/\/app\/marks\/[0-9a-f-]+$/);

    // Enroll the E2E student (profile from ensureE2EUser) plus the seed student
    // so the CSV can contain one resolvable and one unknown email.
    const sectionOption = page
      .getByTestId("enrollment-section")
      .locator("option", { hasText: "IMP-A" });
    await expect(sectionOption).toHaveCount(1);
    await page.getByTestId("enrollment-section").selectOption({ label: "IMP-A" });
    await page.getByTestId("enrollment-email").fill(E2E_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-form-error")).toBeHidden();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toBeVisible();

    await page.getByTestId("enrollment-section").selectOption({ label: "IMP-A" });
    await page.getByTestId("enrollment-email").fill(SEED_STUDENT_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-form-error")).toBeHidden();
    await expect(
      page.getByTestId("enrollment-item").filter({ hasText: SEED_STUDENT_EMAIL }),
    ).toBeVisible();

    // --- Marks entry page: both students listed, no scores yet.
    await page.goto(marksHref!);
    await expect(page.getByTestId("entry-title")).toContainText("E2M Quiz 1");
    await expect(page.getByTestId("mark-row").filter({ hasText: E2E_EMAIL })).toBeVisible();
    await expect(
      page.getByTestId("mark-row").filter({ hasText: SEED_STUDENT_EMAIL }),
    ).toBeVisible();

    // --- Two-phase CSV import: upload → preview → confirm.
    const csv = [
      "email,score",
      `${E2E_EMAIL},8`,
      `${SEED_STUDENT_EMAIL},6`,
      "ghost.e2e@lhr.nu.edu.pk,5",
    ].join("\n");
    await page.getByTestId("import-file").setInputFiles({
      name: "e2e-marks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.getByTestId("import-file-name")).toContainText("e2e-marks.csv");
    await expect(page.getByTestId("import-file-name")).toContainText("3 rows");

    await page.getByTestId("import-preview").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("count-ready")).toContainText("2");
    await expect(page.getByTestId("count-not-found")).toContainText("1");
    await expect(page.getByTestId("count-total")).toContainText("3");
    await expect(page.getByTestId("errors-list")).toContainText("ghost.e2e@lhr.nu.edu.pk");

    // Nothing is written to marks before confirm (preview is side-effect free).
    await expect(
      page.getByTestId("mark-row").filter({ hasText: E2E_EMAIL }).getByTestId("mark-score"),
    ).toHaveValue("");

    await page.getByTestId("import-confirm").click();
    // First confirm compiles the confirm route under the shared dev server;
    // allow for it when parallel workers compete for compilation.
    await expect(page.getByTestId("confirm-result")).toContainText("2 applied · 0 skipped", {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("mark-row").filter({ hasText: E2E_EMAIL }).getByTestId("mark-score"),
    ).toHaveValue("8");
    await expect(
      page
        .getByTestId("mark-row")
        .filter({ hasText: SEED_STUDENT_EMAIL })
        .getByTestId("mark-score"),
    ).toHaveValue("6");

    // Replay is idempotent: the applied batch returns the same counts.
    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("confirm-result")).toContainText("2 applied · 0 skipped", {
      timeout: 15_000,
    });
  });

  test("enrolled student sees the released mark on their marksheet", async ({ page }) => {
    test.setTimeout(120_000);

    // Fixture: the assessment form has no visibility control yet (T-A003
    // default is private), so release it via service role — same server-side
    // fixture pattern as ensureE2ETa's membership promotion.
    await serviceRest(
      `assessments?offering_id=eq.${createdOfferingId}&title=eq.${encodeURIComponent("E2M Quiz 1")}`,
      { method: "PATCH", body: JSON.stringify({ visibility: "students" }) },
    );

    // The E2E student was enrolled and imported (score 8) by the TA test above.
    await signInE2E(page, { email: E2E_EMAIL, password: E2E_PASSWORD });

    // Hub lists the student's marksheet once a released own mark exists.
    await page.goto("/app/marks");
    const marksheetLink = page.getByTestId("marksheet-link").first();
    await expect(marksheetLink).toBeVisible();
    const marksheetHref = await marksheetLink.getAttribute("href");
    expect(marksheetHref).toMatch(/\/app\/offerings\/[0-9a-f-]+\/marksheet$/);

    await page.goto(marksheetHref!);
    await expect(page.getByTestId("marksheet-row")).toContainText("E2M Quiz 1");
    // Imported score is visible on the released row.
    await expect(page.getByTestId("cell-score")).toHaveText(/8\s*\/\s*10/);
  });
});
