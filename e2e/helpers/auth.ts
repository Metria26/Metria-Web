import { expect, type Page } from "@playwright/test";

/**
 * Local Supabase stack constants — the default demo keys every
 * `supabase start` uses (publicly documented demo values, not secrets;
 * same values as .env.local). Google sign-in cannot be automated, so shell
 * tests use a fixture password user + the E2E_MODE-only session route.
 */
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const E2E_EMAIL = "e2e.student@lhr.nu.edu.pk";
export const E2E_PASSWORD = "e2e-Password123!";
export const E2E_TA_EMAIL = "ta.e2e@lhr.nu.edu.pk";
export const E2E_TA_PASSWORD = "e2e-Password123!";
/** Second student fixture: capacity races need two distinct bookers (T-A006). */
export const E2E_STUDENT2_EMAIL = "e2e.student2@lhr.nu.edu.pk";

/** Default demo anon key (publicly documented local value, same as .env.local). */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** Creates the fixture user through the local admin API (fires the F3 triggers). */
export async function ensureE2EUser(): Promise<void> {
  const authUserId = await ensureAuthUser(E2E_EMAIL, E2E_PASSWORD, "E2E Student");
  // F3 provisions profile + pending membership; tenant RLS
  // (private.current_university_ids) only admits active members, so promote
  // to a plain active member — no roles, hence no manage permission.
  await promoteMembership(authUserId, "student");
}

/** Promotes the F3-provisioned pending membership to active; returns the profile. */
async function promoteMembership(
  authUserId: string,
  label: string,
): Promise<{ id: string; university_id: string }> {
  const profiles = await serviceRest<{ id: string; university_id: string }[]>(
    `profiles?auth_user_id=eq.${authUserId}&select=id,university_id`,
  );
  const profile = profiles[0];
  if (!profile) throw new Error(`e2e ${label} profile was not provisioned by the auth trigger`);

  await serviceRest(`university_memberships?profile_id=eq.${profile.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  return profile;
}

async function ensureAuthUser(email: string, password: string, fullName: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { email_verified: true, full_name: fullName },
    }),
  });
  if (res.ok) {
    const created = (await res.json()) as { id: string };
    return created.id;
  }
  // GoTrue answers 422 for a pre-existing email on sequential runs, but a
  // concurrent create race (parallel spec files calling ensureE2E*) can return
  // 500 with the 23505 unique violation — both mean "already exists": fall
  // through to the lookup instead of failing the suite.
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!list.ok) throw new Error(`e2e user lookup failed: ${list.status}`);
  // GoTrue's admin list wraps results: { users: [...] } (not a bare array).
  const body = (await list.json()) as { users?: { id: string; email?: string }[] };
  const match = body.users?.find(
    (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!match) throw new Error(`e2e user not found after 422: ${email}`);
  return match.id;
}

/** Service-role REST helper for fixture setup only (never called from browser code). */
export async function serviceRest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`e2e rest ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Creates the TA fixture user (admin API fires F3 triggers), then promotes the
 * pending membership to active and assigns the seeded `ta` role via service
 * role (RLS is bypassed server-side only; the browser never sees this key).
 */
export async function ensureE2ETa(): Promise<void> {
  const authUserId = await ensureAuthUser(E2E_TA_EMAIL, E2E_TA_PASSWORD, "E2E TA");
  const profile = await promoteMembership(authUserId, "TA");

  const roles = await serviceRest<{ id: string }[]>(
    `roles?university_id=eq.${profile.university_id}&name=eq.ta&select=id`,
  );
  const role = roles[0];
  if (!role) throw new Error("seeded ta role not found for e2e TA");

  const assignments = await serviceRest<{ id: string }[]>(
    `role_assignments?profile_id=eq.${profile.id}&role_id=eq.${role.id}&revoked_at=is.null&select=id`,
  );
  if (assignments.length === 0) {
    await serviceRest("role_assignments", {
      method: "POST",
      body: JSON.stringify({
        university_id: profile.university_id,
        profile_id: profile.id,
        role_id: role.id,
        assigned_by: profile.id,
      }),
    });
  }
}

/** Signs in through the test-only route (requires the Playwright dev server with E2E_MODE=1). */
export async function signInE2E(
  page: Page,
  creds: { email?: string; password?: string } = {},
): Promise<void> {
  const email = creds.email ?? E2E_EMAIL;
  const password = creds.password ?? E2E_PASSWORD;
  // The Next.js dev overlay host (<nextjs-portal>) covers the viewport in dev
  // even with zero issues and intercepts clicks on the sidebar/links. Inject
  // the hiding style on EVERY navigation (goto resets document styles).
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    });
  });
  const sessionUrl = `/auth/e2e-session?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&next=/app`;
  await page.goto(sessionUrl);
  // Under parallel workers the dev server can transiently fail the GoTrue
  // password exchange (redirect back to sign-in). One retry keeps real
  // credential failures visible on the second attempt.
  if (page.url().includes("/auth/sign-in")) {
    await page.goto(sessionUrl);
  }
  await expect(page).toHaveURL(/\/app$/, { timeout: 10_000 });
}

/** Creates the second student fixture (F3 triggers, then promote membership). */
export async function ensureE2EStudent2(): Promise<void> {
  const authUserId = await ensureAuthUser(E2E_STUDENT2_EMAIL, E2E_PASSWORD, "E2E Student Two");
  await promoteMembership(authUserId, "student2");
}

/** Fixture profile lookup over service role (id + tenant) for API-level specs. */
export async function fixtureProfile(
  email: string,
): Promise<{ id: string; university_id: string }> {
  const rows = await serviceRest<{ id: string; university_id: string }[]>(
    `profiles?email=eq.${encodeURIComponent(email)}&select=id,university_id`,
  );
  const profile = rows[0];
  if (!profile) throw new Error(`e2e fixture profile not found: ${email}`);
  return profile;
}

/** Idempotent active enrollment for fixture-driven booking specs. */
export async function ensureEnrollment(
  profile: { id: string; university_id: string },
  sectionId: string,
): Promise<void> {
  const existing = await serviceRest<{ id: string }[]>(
    `enrollments?section_id=eq.${sectionId}&profile_id=eq.${profile.id}&select=id`,
  );
  if (existing.length > 0) return;
  await serviceRest("enrollments", {
    method: "POST",
    body: JSON.stringify({
      university_id: profile.university_id,
      section_id: sectionId,
      profile_id: profile.id,
      status: "active",
      created_by: profile.id,
    }),
  });
}

/** Password-grant access token for fixture users (API-level specs only). */
export async function passwordGrantToken(email: string, password = E2E_PASSWORD): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`e2e token grant failed for ${email}: ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`e2e token grant returned no access_token for ${email}`);
  return body.access_token;
}

/**
 * PostgREST RPC call as a fixture user. Returns ok/status/message instead of
 * throwing so parallel race specs can assert "exactly one winner" shapes.
 */
export async function rpcAs(
  token: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; message: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: { message?: string } | null = null;
  try {
    body = text ? (JSON.parse(text) as { message?: string }) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, message: body?.message ?? null };
}
