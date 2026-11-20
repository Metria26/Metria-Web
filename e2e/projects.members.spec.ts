import type { Page } from "@playwright/test";

import { expect, test } from "./helpers/test";
import {
  E2E_PASSWORD,
  E2E_STACK_SERVICE_KEY,
  E2E_STACK_URL,
  ensureAuthUser,
  passwordGrantToken,
  rpcAs,
  serviceRest,
  signInE2E,
} from "./helpers/auth";

/**
 * Projects & Groups: member flows (owner bug report 2026-11-12 —
 * "Please check the highlighted values and try again." on the student portal).
 *
 * The reported bug: real student profiles have roll_no = NULL, so the
 * create-group leader row was built with an empty regNo and failed Zod with a
 * generic invalidInput before the server was ever called. These tests run the
 * full member surface end-to-end against whatever stack E2E_SUPABASE_URL
 * points at (local stack by default; the linked remote for this run), with a
 * dedicated QA sandbox offering that is fully removed in afterAll.
 *
 * Sandbox: 8 students (roll_no NULL — reproducing the real condition), 1 TA,
 * dashboard A (direct changes, min 2 / max 4, prefix QA) and dashboard B
 * (TA-approved member changes, min 1, prefix QAR), one TA-made group so
 * cross-group conflicts can be asserted.
 */

const STUDENTS = [
  { email: "l249901@lhr.nu.edu.pk", name: "QA Student One" },
  { email: "l249902@lhr.nu.edu.pk", name: "QA Student Two" },
  { email: "l249903@lhr.nu.edu.pk", name: "QA Student Three" },
  { email: "l249904@lhr.nu.edu.pk", name: "QA Student Four" },
  { email: "l249905@lhr.nu.edu.pk", name: "QA Student Five" },
  { email: "l249906@lhr.nu.edu.pk", name: "QA Student Six" },
  { email: "l249907@lhr.nu.edu.pk", name: "QA Student Seven" },
  { email: "l249908@lhr.nu.edu.pk", name: "QA Student Eight" },
];
const TA = { email: "qa.e2e.ta@lhr.nu.edu.pk", name: "QA TA" };

type Sandbox = {
  universityId: string;
  offeringId: string;
  sectionId: string;
  dashboardA: string;
  dashboardB: string;
  taProfileId: string;
  studentProfileIds: string[];
  groupA1: string;
};

/**
 * The student my-group members list renders plain rows (no per-member
 * testid); scope visibility assertions to those rows so the activity feed
 * and leader badge never trigger strict-mode ambiguity.
 */
function memberRows(page: Page) {
  return page.locator("li.rounded-xl.border.p-3");
}

const sandbox: Partial<Sandbox> = {};
const authUserIds: string[] = [];

test.describe.configure({ mode: "serial" });

/** Remote DNS can hiccup on the first lookups; setup calls retry linearly. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${label} failed after retries: ${String(lastError)}`);
}

/** Retrying serviceRest for sandbox seeding/teardown. */
function rest<T>(path: string, init?: RequestInit): Promise<T> {
  return withRetry(() => serviceRest<T>(path, init), `rest ${path}`);
}

async function profileId(email: string): Promise<string> {
  const rows = await rest<{ id: string }[]>(
    `profiles?email=eq.${encodeURIComponent(email)}&select=id`,
  );
  if (!rows[0]) throw new Error(`QA profile missing for ${email}`);
  return rows[0].id;
}

test.describe("projects member flows", () => {
  test.beforeAll(async () => {
    // University + offering anchors.
    const universities = await rest<{ id: string }[]>("universities?is_enabled=eq.true&select=id");
    const universityId = universities[0]?.id;
    if (!universityId) throw new Error("no enabled university");
    const courses = await rest<{ id: string }[]>(
      "courses?publication_state=eq.published&select=id&limit=1",
    );
    const terms = await rest<{ id: string }[]>(
      "terms?publication_state=eq.published&select=id&order=starts_on.desc&limit=1",
    );
    const courseId = courses[0]?.id;
    const termId = terms[0]?.id;
    if (!courseId || !termId) throw new Error("no published course/term for the QA sandbox");

    // Auth users (F3 triggers provision profiles + pending memberships).
    const all = [...STUDENTS, TA];
    for (const user of all) {
      authUserIds.push(
        await withRetry(
          () => ensureAuthUser(user.email, E2E_PASSWORD, user.name),
          `ensureAuthUser ${user.email}`,
        ),
      );
    }

    // Promote every membership to active (tenant gates require it).
    for (const user of all) {
      const id = await profileId(user.email);
      await rest(`university_memberships?profile_id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
    }

    const taProfileId = await profileId(TA.email);
    const studentProfileIds: string[] = [];
    for (const student of STUDENTS) studentProfileIds.push(await profileId(student.email));
    // Capture ids progressively: if setup fails later, afterAll can still
    // remove everything created so far.
    sandbox.taProfileId = taProfileId;
    sandbox.studentProfileIds = studentProfileIds;

    // QA offering + section + staff + enrollments.
    const offerings = await rest<{ id: string }[]>("course_offerings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        course_id: courseId,
        term_id: termId,
        offering_code: "QA-E2E-MEMBERS",
        created_by: taProfileId,
      }),
    });
    const offeringId = offerings[0]?.id;
    if (!offeringId) throw new Error("QA offering insert failed");
    sandbox.offeringId = offeringId;
    const sections = await rest<{ id: string }[]>("sections", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        section_code: "QA-E2E",
        capacity: 10,
        created_by: taProfileId,
      }),
    });
    const sectionId = sections[0]?.id;
    if (!sectionId) throw new Error("QA section insert failed");
    sandbox.sectionId = sectionId;
    await rest("offering_staff", {
      method: "POST",
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        profile_id: taProfileId,
        staff_role: "ta",
        created_by: taProfileId,
      }),
    });
    for (const profileIdValue of studentProfileIds) {
      await rest("enrollments", {
        method: "POST",
        body: JSON.stringify({
          university_id: universityId,
          section_id: sectionId,
          profile_id: profileIdValue,
          status: "active",
          created_by: taProfileId,
        }),
      });
    }

    // Dashboard A: direct member changes, min 2 / max 4, prefix QA.
    const dashboardsA = await rest<{ id: string }[]>("project_dashboards", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        title: "QA E2E Members A",
        status: "published",
        opens_at: new Date(Date.now() - 86_400_000).toISOString(),
        deadline_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        allow_student_groups: true,
        min_members: 2,
        max_members: 4,
        group_id_prefix: "QA",
        created_by: taProfileId,
      }),
    });
    const dashboardA = dashboardsA[0]?.id;
    if (!dashboardA) throw new Error("QA dashboard A insert failed");
    sandbox.dashboardA = dashboardA;

    // Dashboard B: TA-approved member changes, min 1, prefix QAR.
    const dashboardsB = await rest<{ id: string }[]>("project_dashboards", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        title: "QA E2E Members B",
        status: "published",
        opens_at: new Date(Date.now() - 86_400_000).toISOString(),
        deadline_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        allow_student_groups: true,
        min_members: 1,
        max_members: 4,
        group_id_prefix: "QAR",
        require_member_change_approval: true,
        created_by: taProfileId,
      }),
    });
    const dashboardB = dashboardsB[0]?.id;
    if (!dashboardB) throw new Error("QA dashboard B insert failed");
    sandbox.dashboardB = dashboardB;

    // TA-made group on A (student six is its leader) so cross-group conflicts
    // can be asserted without UI setup.
    const taToken = await withRetry(
      () => passwordGrantToken(TA.email, E2E_PASSWORD),
      "ta password grant",
    );
    const created = await withRetry(
      () =>
        rpcAs(taToken, "create_project_group", {
          p_dashboard_id: dashboardA,
          p_group_id: "QA_TA_01",
          p_project_title: "QA TA Group",
          // Typed jsonb arg (PostgREST binds JSON strings as scalar strings).
          p_members: [
            {
              name: "QA Student Six",
              regNo: "l249906",
              memberRole: "member",
              responsibilities: "",
            },
          ],
        }),
      "QA TA group rpc",
    );
    if (!created.ok) throw new Error(`QA TA group setup failed: ${created.message}`);
    const taGroups = await rest<{ id: string }[]>(
      `project_groups?dashboard_id=eq.${dashboardA}&group_id=eq.QA_TA_01&select=id`,
    );
    const groupA1 = taGroups[0]?.id;
    if (!groupA1) throw new Error("QA TA group lookup failed");
    sandbox.groupA1 = groupA1;

    Object.assign(sandbox, {
      universityId,
      offeringId,
      sectionId,
      dashboardA,
      dashboardB,
      taProfileId,
      studentProfileIds,
      groupA1,
    });

    // Warm dev-server route compilation so cold-compile latency doesn't race
    // the browser assertions below (dynamic routes compile on first request).
    const warmTargets = [
      "/auth/sign-in",
      `/auth/e2e-session?email=${encodeURIComponent(TA.email)}&password=${encodeURIComponent(E2E_PASSWORD)}`,
      "/app/projects",
      `/app/projects/${dashboardA}`,
      `/app/projects/${dashboardA}/my-group`,
      `/app/projects/${dashboardA}/groups`,
      `/app/projects/${dashboardB}`,
    ];
    for (const target of warmTargets) {
      await fetch(`http://localhost:3000${target}`).catch(() => {});
    }
  });

  test.afterAll(async () => {
    // Teardown in FK-safe order; the dashboard delete cascades groups,
    // members, ledger, requests and activity logs. Best-effort: a sandbox
    // row left behind is preferable to masking a test failure.
    const drop = async (path: string, init?: RequestInit): Promise<void> => {
      try {
        await rest(path, init);
      } catch (error) {
        console.warn(`QA cleanup skipped: ${path} — ${String(error)}`);
      }
    };
    if (sandbox.dashboardA) {
      await drop(`project_dashboards?id=eq.${sandbox.dashboardA}`, { method: "DELETE" });
    }
    if (sandbox.dashboardB) {
      await drop(`project_dashboards?id=eq.${sandbox.dashboardB}`, { method: "DELETE" });
    }
    if (sandbox.sectionId) {
      await drop(`enrollments?section_id=eq.${sandbox.sectionId}`, { method: "DELETE" });
    }
    if (sandbox.offeringId) {
      await drop(`offering_staff?offering_id=eq.${sandbox.offeringId}`, { method: "DELETE" });
      await drop(`sections?id=eq.${sandbox.sectionId}`, { method: "DELETE" });
      await drop(`course_offerings?id=eq.${sandbox.offeringId}`, { method: "DELETE" });
    }
    if (sandbox.studentProfileIds) {
      for (const id of [...sandbox.studentProfileIds, sandbox.taProfileId]) {
        if (!id) continue;
        await drop(`university_memberships?profile_id=eq.${id}`, { method: "DELETE" });
        await drop(`profiles?id=eq.${id}`, { method: "DELETE" });
      }
    }
    for (const authUserId of authUserIds) {
      try {
        const res = await fetch(`${E2E_STACK_URL}/auth/v1/admin/users/${authUserId}`, {
          method: "DELETE",
          headers: {
            apikey: E2E_STACK_SERVICE_KEY,
            Authorization: `Bearer ${E2E_STACK_SERVICE_KEY}`,
          },
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`status ${res.status}`);
        }
      } catch (error) {
        console.warn(`QA auth user cleanup skipped: ${authUserId} — ${String(error)}`);
      }
    }
  });

  test("leader card falls back to the email local part and create succeeds", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}`);

    // THE BUG FIX: roll_no is NULL for this profile — the leader box must show
    // the email local part instead of an empty registration number.
    const leaderCard = page.getByText("You are the group leader").locator("..");
    await expect(leaderCard).toContainText("QA Student One");
    await expect(leaderCard).toContainText("l249901");

    await page.getByTestId("create-group-title").fill("QA Regression Flight");
    await page.getByTestId("create-group-name").fill("QA Student Two");
    await page.getByTestId("create-group-reg").fill("l249902");
    await page.getByTestId("create-group-submit").click();
    await expect(page).toHaveURL(/\/my-group$/, { timeout: 15_000 });
    await expect(page.getByTestId("my-group-id")).toHaveText(/QA_\d+/);
    const leaderRow = memberRows(page).filter({ hasText: "QA Student One" });
    await expect(leaderRow).toHaveCount(1);
    await expect(leaderRow).toContainText("l249901");
    const teammateRow = memberRows(page).filter({ hasText: "QA Student Two" });
    await expect(teammateRow).toHaveCount(1);
    await expect(teammateRow).toContainText("l249902");
  });

  test("leader adds a teammate through the single form", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("QA Student Three");
    await page.getByTestId("add-member-reg").fill("l249903");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    const added = memberRows(page).filter({ hasText: "QA Student Three" });
    await expect(added).toHaveCount(1, { timeout: 15_000 });
    await expect(added).toContainText("l249903");
  });

  test("bulk paste parses, previews and adds; bad lines are flagged", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("bulk-members-toggle").click();

    // Malformed line first: the preview must call it out.
    await page.getByTestId("bulk-members-input").fill("Broken Line");
    await expect(page.getByTestId("bulk-members-preview")).toContainText("Line 1 needs", {
      timeout: 10_000,
    });

    // Valid line: preview parses, then submit adds the member.
    await page.getByTestId("bulk-members-input").fill("QA Student Four, l249904");
    await expect(page.getByTestId("bulk-members-preview")).toContainText("1 member(s) parsed");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(memberRows(page).filter({ hasText: "l249904" })).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("re-adding an existing member is rejected as a duplicate", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("QA Student Three");
    await page.getByTestId("add-member-reg").fill("l249903");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(page.getByTestId("group-action-error")).toContainText(
      "The same registration number appears twice.",
      { timeout: 15_000 },
    );
  });

  test("adding past the size cap is rejected as group full", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("QA Student Five");
    await page.getByTestId("add-member-reg").fill("l249905");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(page.getByTestId("group-action-error")).toContainText(
      "The group already has the maximum number of members.",
      { timeout: 15_000 },
    );
  });

  test("unknown registration number reports a missing student", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("Ghost Student");
    await page.getByTestId("add-member-reg").fill("nobody99");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(page.getByTestId("group-action-error")).toContainText(
      "does not match any student record",
      { timeout: 15_000 },
    );
  });

  test("a student already in another group is reported", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("QA Student Six");
    await page.getByTestId("add-member-reg").fill("l249906");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(page.getByTestId("group-action-error")).toContainText(
      "already belongs to another active group",
      { timeout: 15_000 },
    );
  });

  test("a real but non-enrolled student is reported", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page.getByTestId("add-member-name").fill("Muhammad Zohaib");
    await page.getByTestId("add-member-reg").fill("l242530");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(page.getByTestId("group-action-error")).toContainText(
      "not enrolled in this course offering",
      { timeout: 15_000 },
    );
  });

  test("leader removes a member and capacity frees up", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[0].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/my-group`);
    await page
      .getByRole("combobox", { name: "Remove member" })
      .selectOption({ label: "QA Student Four — l249904" });
    await expect(memberRows(page).filter({ hasText: "l249904" })).toHaveCount(0, {
      timeout: 15_000,
    });

    // The freed seat is immediately usable again.
    await page.getByTestId("add-member-name").fill("QA Student Four");
    await page.getByTestId("add-member-reg").fill("l249904");
    await page.getByTestId("add-member-form").getByRole("button", { name: "Add members" }).click();
    await expect(memberRows(page).filter({ hasText: "l249904" })).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("TA creates a group with a manual ID and first member leads", async ({ page }) => {
    await signInE2E(page, { email: TA.email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/groups`);
    await page.getByTestId("create-group-title").fill("QA TA UI Group");
    await page.getByTestId("create-group-id").fill("QA_TA2");
    await page.getByTestId("create-group-name").fill("QA Student Five");
    await page.getByTestId("create-group-reg").fill("l249905");
    await page.getByTestId("create-group-submit").click();
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByTestId("member-l249905")).toBeVisible();
    await expect(page.getByTestId("member-l249905")).toContainText("Leader");
  });

  test("TA transfers a member between groups", async ({ page }) => {
    await signInE2E(page, { email: TA.email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardA}/groups/${sandbox.groupA1}`);
    await expect(page.getByTestId("member-l249902")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Transfer to…" })
      .first()
      .selectOption({ label: "QA_TA2" });
    await expect(page.getByTestId("member-l249902")).toHaveCount(0, { timeout: 15_000 });

    // The member is now in the target group.
    const target = await rest<{ id: string }[]>(
      `project_groups?dashboard_id=eq.${sandbox.dashboardA}&group_id=eq.QA_TA2&select=id`,
    );
    await page.goto(`/app/projects/${sandbox.dashboardA}/groups/${target[0]?.id}`);
    await expect(page.getByTestId("member-l249902")).toBeVisible();
  });

  test("solo create works on the approval dashboard", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[6].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardB}`);
    await page.getByTestId("create-group-title").fill("QA Approval Flight");
    await page.getByTestId("create-group-submit").click();
    await expect(page).toHaveURL(/\/my-group$/, { timeout: 15_000 });
    await expect(page.getByTestId("my-group-id")).toHaveText(/QAR_\d+/);
    await expect(memberRows(page).filter({ hasText: "QA Student Seven" })).toHaveCount(1);
  });

  test("leader sends an add request that the TA approves", async ({ page }) => {
    await signInE2E(page, { email: STUDENTS[6].email, password: E2E_PASSWORD });
    await page.goto(`/app/projects/${sandbox.dashboardB}/my-group`);
    await expect(page.getByTestId("student-member-controls")).toContainText(
      "TA approves member changes",
    );
    await page.getByRole("button", { name: "Request to add member" }).click();
    await page
      .getByTestId("request-add-form")
      .getByPlaceholder("Student name")
      .fill("QA Student Eight");
    await page
      .getByTestId("request-add-form")
      .getByPlaceholder("Registration number")
      .fill("l249908");
    await page.getByRole("button", { name: "Send request to TA" }).click();
    await expect(page.getByText("waiting for TA decision")).toBeVisible({ timeout: 15_000 });

    // TA decision screen.
    await signInE2E(page, { email: TA.email, password: E2E_PASSWORD });
    const groups = await rest<{ id: string }[]>(
      `project_groups?dashboard_id=eq.${sandbox.dashboardB}&select=id&group_id=ilike.QAR_*`,
    );
    await page.goto(`/app/projects/${sandbox.dashboardB}/groups/${groups[0]?.id}`);
    await expect(page.getByTestId("requests-panel")).toContainText(
      "Add member: QA Student Eight l249908",
    );
    await page.getByRole("button", { name: "Approve & apply" }).click();
    await expect(page.getByTestId("member-l249908")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("requests-panel")).toContainText(
      "No pending member-change requests.",
    );
  });

  test("TA removes the approved member directly", async ({ page }) => {
    await signInE2E(page, { email: TA.email, password: E2E_PASSWORD });
    const groups = await rest<{ id: string }[]>(
      `project_groups?dashboard_id=eq.${sandbox.dashboardB}&select=id&group_id=ilike.QAR_*`,
    );
    await page.goto(`/app/projects/${sandbox.dashboardB}/groups/${groups[0]?.id}`);
    await expect(page.getByTestId("member-l249908")).toBeVisible();
    await page
      .getByTestId("member-l249908")
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    await expect(page.getByTestId("member-l249908")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("member-l249907")).toBeVisible();
  });
});
