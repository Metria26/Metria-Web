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
 * Registry delta 2026-11-08 — destructive flows moved from bare confirm()
 * prompts to an exact dialog: it states exactly what will be removed (with
 * authoritative counts) and the hardest deletes (section/offering) require
 * typing the item name. This spec walks cancel-first, typed-name gating,
 * assessment/enrollment deletes and the final offering delete; every remove
 * is visible as the row disappearing from its list.
 */
test.describe("academics delete flows", () => {
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now().toString(36).toUpperCase();
  const courseCode = `DF${stamp}`;
  const offeringCode = `${courseCode}-F26`;
  const sectionCode = "DF-A";
  const assessmentTitle = `DF quiz ${stamp}`;

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2ETa();
  });

  /** Creates course + offering + section through the UI (mirrors journey). */
  async function createFixtures(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/app/offerings");
    await page.getByTestId("new-offering-link").click();
    await page.getByTestId("course-code").fill(courseCode);
    await page.getByTestId("course-title").fill("DF Delete Engineering");
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
    await page.getByTestId("section-capacity").fill("30");
    await page.getByTestId("section-submit").click();
    await expect(page.getByTestId("section-form-error")).toBeHidden();
    await expect(page.getByTestId("section-item").filter({ hasText: sectionCode })).toBeVisible({
      timeout: 20_000,
    });
  }

  test("TA prepares the offering, section, roster and assessment", async ({ page }) => {
    test.setTimeout(180_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });
    await createFixtures(page);

    // Enroll the e2e student for the enrollment delete leg.
    await page.getByTestId("section-item").filter({ hasText: sectionCode }).click();
    await page.getByTestId("hub-students").click();
    await page.getByTestId("enrollment-section").selectOption({ label: sectionCode });
    await page.getByTestId("enrollment-email").fill(E2E_EMAIL);
    await page.getByTestId("enrollment-submit").click();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toBeVisible({
      timeout: 15_000,
    });

    // Back to the hub, then into assessments.
    await page.getByTestId("hub-back").click();
    // A fresh assessment the enrollment-delete leg can also exercise.
    await page.getByTestId("hub-assessments").click();
    await page.getByTestId("assessment-title").fill(assessmentTitle);
    await page.getByTestId("assessment-total").fill("10");
    await page.getByTestId("assessment-weight").fill("10");
    await page.getByTestId("assessment-submit").click();
    await expect(page.getByTestId("assessment-form-error")).toBeHidden();
    await expect(
      page.getByTestId("assessment-item").filter({ hasText: assessmentTitle }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("enrollment remove: cancel keeps, confirm removes", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/offerings");
    await page.getByTestId("offering-item").filter({ hasText: offeringCode }).click();
    await page.getByTestId("section-item").filter({ hasText: sectionCode }).click();
    await page.getByTestId("hub-students").click();
    const row = page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL });

    // The dialog states exactly what is removed: the named student + section.
    await row.locator("[data-testid='delete-enrollment']").click();
    const message = page.getByTestId("delete-enrollment-message");
    await expect(message).toContainText(/remove/i);
    await expect(message).toContainText(new RegExp(sectionCode));

    await page.getByTestId("delete-enrollment-cancel").click();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator("[data-testid='delete-enrollment']").click();
    await page.getByTestId("delete-enrollment-confirm").click();
    await expect(page.getByTestId("enrollment-item").filter({ hasText: E2E_EMAIL })).toHaveCount(
      0,
      {
        timeout: 20_000,
      },
    );
  });

  test("assessment delete states what it destroys and removes the row", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/offerings");
    await page.getByTestId("offering-item").filter({ hasText: offeringCode }).click();
    await page.getByTestId("section-item").filter({ hasText: sectionCode }).click();
    await page.getByTestId("hub-assessments").click();

    const row = page.getByTestId("assessment-item").filter({ hasText: assessmentTitle });
    await row.getByTestId("delete-assessment").click();
    await expect(page.getByTestId("delete-assessment-message")).toContainText(/deleting/i);

    await page.getByTestId("delete-assessment-confirm").click();
    await expect(
      page.getByTestId("assessment-item").filter({ hasText: assessmentTitle }),
    ).toHaveCount(0, { timeout: 20_000 });
  });

  test("section delete requires typing the section code", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/offerings");
    await page.getByTestId("offering-item").filter({ hasText: offeringCode }).click();

    const deleteButton = page.locator("[data-testid^='delete-section-']").first();
    await deleteButton.click();

    // Typed gate: the confirm button stays disabled until the code matches.
    const confirm = page.locator("[data-testid$='-confirm']").last();
    await expect(confirm).toBeDisabled();
    await page.locator("[data-testid$='-confirm-input']").last().fill("wrong");
    await expect(confirm).toBeDisabled();
    await page.locator("[data-testid$='-confirm-input']").last().fill(sectionCode);
    await expect(confirm).toBeEnabled();

    // The message lists the cascade counts (enrollment was removed above, so 0).
    await expect(page.getByTestId(/delete-section-.*-message/)).toContainText(/enrollments/i);

    await confirm.click();
    await expect(page.getByTestId("section-item").filter({ hasText: sectionCode })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("offering delete on the list page wipes the whole offering", async ({ page }) => {
    test.setTimeout(120_000);
    await signInE2E(page, { email: E2E_TA_EMAIL, password: E2E_TA_PASSWORD });

    await page.goto("/app/offerings");
    const listItem = page.locator("li").filter({ hasText: offeringCode });
    const deleteButton = listItem.locator("[data-testid^='delete-offering-']").first();
    await deleteButton.click();

    const confirm = page.locator("[data-testid$='-confirm']").last();
    await expect(confirm).toBeDisabled();
    await page.locator("[data-testid$='-confirm-input']").last().fill("wrong");
    await expect(confirm).toBeDisabled();
    await page.locator("[data-testid$='-confirm-input']").last().fill(offeringCode);
    await expect(confirm).toBeEnabled();
    await expect(page.locator("[data-testid$='-message']").last()).toContainText(/offering/i);

    await confirm.click();
    await expect(page.getByTestId("offering-item").filter({ hasText: offeringCode })).toHaveCount(
      0,
      {
        timeout: 20_000,
      },
    );
  });
});
