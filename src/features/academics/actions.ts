"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  assessmentInputSchema,
  courseInputSchema,
  enrollmentInputSchema,
  offeringInputSchema,
  sectionInputSchema,
  type ActionResult,
} from "./contracts";

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
