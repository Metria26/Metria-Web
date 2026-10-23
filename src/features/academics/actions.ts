"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcTransport } from "@/lib/supabase/rpc";
import {
  announcementInputSchema,
  assessmentInputSchema,
  bulkEnrollmentInputSchema,
  courseInputSchema,
  enrollmentInputSchema,
  offeringInputSchema,
  sectionInputSchema,
  type ActionResult,
  type BulkEnrollmentResult,
} from "./contracts";
import { parseRollInput, type ParsedRoll } from "./roll-email";
import { sanitizeAnnouncementHtml } from "./sanitize";

/** i18n-safe error keys returned to forms (never leak Postgres details). */
type ErrorKey =
  | "notAuthorized"
  | "invalidInput"
  | "duplicate"
  | "invalidReference"
  | "studentNotFound"
  | "alreadyEnrolled"
  | "generic";

function mapError(code: string | undefined): ErrorKey {
  switch (code) {
    case "42501":
      return "notAuthorized";
    case "23505":
      return "duplicate";
    case "23503":
    case "23502":
      return "invalidReference";
    default:
      return "generic";
  }
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolves the caller's profile row (id + tenant). RLS gates this read:
 * only holders of academic.manage_offering (or platform admins) can see
 * tenant profiles, so a non-manager gets null here before any write.
 */
async function callerProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return { supabase, profile: profile ?? null };
}

function invalidInput(): ActionResult {
  return { ok: false, error: "invalidInput" };
}

export async function createCourseAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = courseInputSchema.safeParse({
    code: emptyToUndefined(formData.get("code")),
    title: emptyToUndefined(formData.get("title")),
    description: emptyToUndefined(formData.get("description")) ?? "",
    departmentId: emptyToUndefined(formData.get("departmentId")),
  });
  if (!parsed.success) return invalidInput();

  const { error } = await supabase.from("courses").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    code: parsed.data.code,
    title: parsed.data.title,
    description: parsed.data.description,
    department_id: parsed.data.departmentId ?? null,
  });
  if (error) return { ok: false, error: mapError(error.code) };

  revalidatePath("/app/offerings");
  return { ok: true };
}

export async function createOfferingAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = offeringInputSchema.safeParse({
    courseId: emptyToUndefined(formData.get("courseId")),
    termId: emptyToUndefined(formData.get("termId")),
    offeringCode: emptyToUndefined(formData.get("offeringCode")),
  });
  if (!parsed.success) return invalidInput();

  const { data: created, error } = await supabase
    .from("course_offerings")
    .insert({
      university_id: profile.university_id,
      created_by: profile.id,
      course_id: parsed.data.courseId,
      term_id: parsed.data.termId,
      offering_code: parsed.data.offeringCode,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: mapError(error?.code) };

  // Creator staffing (T-A004): marks entry/marksheet RLS keys on
  // is_offering_staff, so the offering's creator must hold an
  // offering_staff row. staff_role derives from the caller's active
  // role_assignments when those are readable; both catalog reads fail
  // closed for regular members, hence the "member" fallback (nothing in
  // marks RLS branches on the value — only row existence matters).
  let staffRole = "member";
  const { data: assignments } = await supabase
    .from("role_assignments")
    .select("role_id")
    .eq("profile_id", profile.id)
    .is("revoked_at", null);
  const roleIds = [...new Set((assignments ?? []).map((row) => row.role_id))];
  if (roleIds.length > 0) {
    const { data: roles } = await supabase
      .from("roles")
      .select("id, name")
      .in("id", roleIds)
      .eq("university_id", profile.university_id);
    const names = new Set((roles ?? []).map((role) => role.name));
    if (names.has("teacher")) staffRole = "teacher";
    else if (names.has("ta")) staffRole = "ta";
  }
  const { error: staffError } = await supabase.from("offering_staff").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    offering_id: created.id,
    profile_id: profile.id,
    staff_role: staffRole,
  });
  if (staffError) return { ok: false, error: mapError(staffError.code) };

  revalidatePath("/app/offerings");
  revalidatePath(`/app/offerings/${created.id}`);
  return { ok: true };
}

export async function createSectionAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = sectionInputSchema.safeParse({
    offeringId: emptyToUndefined(formData.get("offeringId")),
    sectionCode: emptyToUndefined(formData.get("sectionCode")),
    capacity: emptyToUndefined(formData.get("capacity")),
  });
  if (!parsed.success) return invalidInput();

  const { error } = await supabase.from("sections").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    offering_id: parsed.data.offeringId,
    section_code: parsed.data.sectionCode,
    capacity: parsed.data.capacity ?? null,
  });
  if (error) return { ok: false, error: mapError(error.code) };

  revalidatePath(`/app/offerings/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function createAssessmentAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = assessmentInputSchema.safeParse({
    offeringId: emptyToUndefined(formData.get("offeringId")),
    sectionId: emptyToUndefined(formData.get("sectionId")),
    title: emptyToUndefined(formData.get("title")),
    assessmentType: emptyToUndefined(formData.get("assessmentType")) ?? "quiz",
    total: emptyToUndefined(formData.get("total")),
    weight: emptyToUndefined(formData.get("weight")),
    visibility: emptyToUndefined(formData.get("visibility")) ?? "private",
  });
  if (!parsed.success) return invalidInput();

  const { error } = await supabase.from("assessments").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    offering_id: parsed.data.offeringId,
    section_id: parsed.data.sectionId ?? null,
    title: parsed.data.title,
    assessment_type: parsed.data.assessmentType,
    total: parsed.data.total,
    weight: parsed.data.weight,
    visibility: parsed.data.visibility,
  });
  if (error) return { ok: false, error: mapError(error.code) };

  revalidatePath(`/app/offerings/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function enrollStudentAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = enrollmentInputSchema.safeParse({
    sectionId: emptyToUndefined(formData.get("sectionId")),
    studentEmail: emptyToUndefined(formData.get("studentEmail")),
  });
  if (!parsed.success) return invalidInput();

  const { data: student } = await supabase
    .from("profiles")
    .select("id")
    .eq("university_id", profile.university_id)
    .eq("email", parsed.data.studentEmail)
    .maybeSingle();
  if (!student) return { ok: false, error: "studentNotFound" };

  const { data: existing } = await supabase
    .from("enrollments")
    .select("id")
    .eq("section_id", parsed.data.sectionId)
    .eq("profile_id", student.id)
    .maybeSingle();
  if (existing) return { ok: false, error: "alreadyEnrolled" };

  const { error } = await supabase.from("enrollments").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    section_id: parsed.data.sectionId,
    profile_id: student.id,
    status: "active",
  });
  if (error) return { ok: false, error: mapError(error.code) };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: section } = await supabase
      .from("sections")
      .select("offering_id")
      .eq("id", parsed.data.sectionId)
      .maybeSingle();
    if (section) revalidatePath(`/app/offerings/${section.offering_id}`);
  }
  return { ok: true };
}

/**
 * Bulk CSV enrollment: one column of roll numbers (or university emails).
 * Students who already signed in are enrolled immediately; everyone else gets
 * a pending enrollment_invites row that private.sync_auth_user_profile()
 * applies on their first sign-in. Re-uploading the same list is idempotent.
 */
export async function bulkEnrollStudentsAction(formData: FormData): Promise<BulkEnrollmentResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  let entries: unknown = [];
  try {
    entries = JSON.parse(String(formData.get("entries") ?? "[]"));
  } catch {
    return { ok: false, error: "invalidInput" };
  }
  const parsed = bulkEnrollmentInputSchema.safeParse({
    sectionId: emptyToUndefined(formData.get("sectionId")),
    entries,
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const invalid: string[] = [];
  const seen = new Set<string>();
  const rows: ParsedRoll[] = [];
  let duplicates = 0;
  for (const entry of parsed.data.entries) {
    const roll = parseRollInput(entry);
    if (!roll) {
      const trimmed = entry.trim();
      if (trimmed) invalid.push(trimmed);
      continue;
    }
    if (seen.has(roll.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(roll.email);
    rows.push(roll);
  }

  if (rows.length === 0) {
    return {
      ok: true,
      enrolled: 0,
      alreadyEnrolled: 0,
      pending: 0,
      duplicates,
      invalid: invalid.slice(0, 200),
    };
  }

  const { data: section } = await supabase
    .from("sections")
    .select("offering_id")
    .eq("id", parsed.data.sectionId)
    .maybeSingle();
  if (!section) return { ok: false, error: "invalidReference" };

  // Resolve profiles for both the canonical and the zero-padded variant so a
  // sheet mangled by spreadsheet software still matches the right student.
  const candidates: string[] = [];
  for (const row of rows) {
    candidates.push(row.email);
    if (row.altEmail) candidates.push(row.altEmail);
  }
  const profileIdByEmail = new Map<string, string>();
  for (let index = 0; index < candidates.length; index += 300) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("university_id", profile.university_id)
      .in("email", candidates.slice(index, index + 300));
    if (error) return { ok: false, error: mapError(error.code) };
    for (const row of data ?? []) {
      if (row.email) profileIdByEmail.set(row.email, row.id);
    }
  }

  const { data: existingEnrollments, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select("profile_id")
    .eq("section_id", parsed.data.sectionId);
  if (enrollmentsError) return { ok: false, error: mapError(enrollmentsError.code) };
  const enrolledIds = new Set((existingEnrollments ?? []).map((row) => row.profile_id));

  const { data: existingInvites, error: invitesError } = await supabase
    .from("enrollment_invites")
    .select("email")
    .eq("section_id", parsed.data.sectionId)
    .eq("status", "pending");
  if (invitesError) return { ok: false, error: mapError(invitesError.code) };
  const pendingEmails = new Set((existingInvites ?? []).map((row) => row.email));

  const toEnroll: {
    university_id: string;
    created_by: string;
    section_id: string;
    profile_id: string;
    status: string;
  }[] = [];
  const toInvite: {
    university_id: string;
    created_by: string;
    section_id: string;
    email: string;
    alt_email: string | null;
    roll_input: string;
    status: string;
  }[] = [];
  let alreadyEnrolled = 0;
  let pending = 0;

  for (const row of rows) {
    const profileId =
      profileIdByEmail.get(row.email) ??
      (row.altEmail ? profileIdByEmail.get(row.altEmail) : undefined);
    if (profileId) {
      if (enrolledIds.has(profileId)) {
        alreadyEnrolled += 1;
        continue;
      }
      enrolledIds.add(profileId);
      toEnroll.push({
        university_id: profile.university_id,
        created_by: profile.id,
        section_id: parsed.data.sectionId,
        profile_id: profileId,
        status: "active",
      });
    } else {
      pending += 1;
      if (!pendingEmails.has(row.email)) {
        pendingEmails.add(row.email);
        toInvite.push({
          university_id: profile.university_id,
          created_by: profile.id,
          section_id: parsed.data.sectionId,
          email: row.email,
          alt_email: row.altEmail,
          roll_input: row.input,
          status: "pending",
        });
      }
    }
  }

  if (toInvite.length > 0) {
    const { error } = await supabase.from("enrollment_invites").insert(toInvite);
    if (error) return { ok: false, error: mapError(error.code) };
  }
  if (toEnroll.length > 0) {
    const { error } = await supabase.from("enrollments").insert(toEnroll);
    if (error) return { ok: false, error: mapError(error.code) };
  }

  revalidatePath(`/app/offerings/${section.offering_id}`);
  return {
    ok: true,
    enrolled: toEnroll.length,
    alreadyEnrolled,
    pending,
    duplicates,
    invalid: invalid.slice(0, 200),
  };
}

/** Dismiss a pending invite that belongs to the offering's Students section. */
export async function removeEnrollmentInviteAction(formData: FormData): Promise<void> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return;

  const inviteId = emptyToUndefined(formData.get("inviteId"));
  const offeringId = emptyToUndefined(formData.get("offeringId"));
  if (!inviteId || !offeringId) return;

  await supabase.from("enrollment_invites").delete().eq("id", inviteId).eq("status", "pending");
  revalidatePath(`/app/offerings/${offeringId}`);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formUuid(formData: FormData, key: string): string | null {
  const value = emptyToUndefined(formData.get(key));
  return value && uuidPattern.test(value) ? value : null;
}

async function deleteViaRpc(
  fn: "delete_announcement" | "delete_assessment" | "delete_enrollment" | "delete_section_cascade",
  idKey: string,
  id: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await rpcTransport(supabase).rpc(fn, { [idKey]: id });
  return !error;
}

/** Delete an announcement (author or offering staff). */
export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  const announcementId = formUuid(formData, "announcementId");
  const offeringId = formUuid(formData, "offeringId");
  if (!announcementId || !offeringId) return;
  await deleteViaRpc("delete_announcement", "p_announcement_id", announcementId);
  revalidatePath(`/app/offerings/${offeringId}`);
  revalidatePath("/app");
}

/** Delete an assessment, its marks and mark history, and any import batches. */
export async function deleteAssessmentAction(formData: FormData): Promise<void> {
  const assessmentId = formUuid(formData, "assessmentId");
  const offeringId = formUuid(formData, "offeringId");
  if (!assessmentId || !offeringId) return;
  await deleteViaRpc("delete_assessment", "p_assessment_id", assessmentId);
  revalidatePath(`/app/offerings/${offeringId}`);
  revalidatePath(`/app/marks/${assessmentId}`);
  revalidatePath("/app/marks");
}

/** Remove one student from a section. */
export async function deleteEnrollmentAction(formData: FormData): Promise<void> {
  const enrollmentId = formUuid(formData, "enrollmentId");
  const offeringId = formUuid(formData, "offeringId");
  if (!enrollmentId || !offeringId) return;
  await deleteViaRpc("delete_enrollment", "p_enrollment_id", enrollmentId);
  revalidatePath(`/app/offerings/${offeringId}`);
}

/**
 * Delete a section and everything that belongs to it: enrollments,
 * announcements, assessments/marks, periods/slots/bookings and invites.
 */
export async function deleteSectionAction(formData: FormData): Promise<void> {
  const sectionId = formUuid(formData, "sectionId");
  const offeringId = formUuid(formData, "offeringId");
  if (!sectionId || !offeringId) return;
  await deleteViaRpc("delete_section_cascade", "p_section_id", sectionId);
  revalidatePath(`/app/offerings/${offeringId}`);
  revalidatePath("/app/bookings");
  revalidatePath("/app");
}

/**
 * T-A005: TA/teacher posts a section announcement. The body is sanitized on
 * write (D8) before it reaches Postgres; the RLS insert policy independently
 * requires staff membership + academic.manage_offering, so a rogue caller
 * without the UI still fails closed at the database.
 */
export async function createAnnouncementAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = announcementInputSchema.safeParse({
    sectionId: emptyToUndefined(formData.get("sectionId")),
    title: emptyToUndefined(formData.get("title")),
    bodyHtml: emptyToUndefined(formData.get("bodyHtml")),
  });
  if (!parsed.success) return invalidInput();

  const cleanHtml = sanitizeAnnouncementHtml(parsed.data.bodyHtml);
  if (cleanHtml.trim().length === 0) return invalidInput();

  const { error } = await supabase.from("announcements").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    section_id: parsed.data.sectionId,
    author_id: profile.id,
    title: parsed.data.title,
    body_html: cleanHtml,
  });
  if (error) return { ok: false, error: mapError(error.code) };

  const { data: section } = await supabase
    .from("sections")
    .select("offering_id")
    .eq("id", parsed.data.sectionId)
    .maybeSingle();
  if (section) revalidatePath(`/app/offerings/${section.offering_id}`);
  revalidatePath("/app");
  return { ok: true };
}
