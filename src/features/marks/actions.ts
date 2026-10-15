"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markInputSchema, type ActionResult } from "./contracts";

/** i18n-safe error keys returned to forms (never leak Postgres details). */
type ErrorKey =
  "notAuthorized" | "invalidInput" | "scoreTooHigh" | "notEnrolled" | "duplicate" | "generic";

function mapError(code: string | undefined): ErrorKey {
  switch (code) {
    case "42501":
      return "notAuthorized";
    case "23505":
      return "duplicate";
    case "23503":
    case "23502":
      return "notEnrolled";
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
 * Manual mark entry (staff only — RLS marks_staff_* enforces offering staff,
 * R10). Writes go straight to `marks`; private.record_mark_history appends the
 * P6 history row in the same transaction (source defaults to 'manual').
 */
export async function saveMarkAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = markInputSchema.safeParse({
    assessmentId: emptyToUndefined(formData.get("assessmentId")),
    studentId: emptyToUndefined(formData.get("studentId")),
    score: typeof formData.get("score") === "string" ? formData.get("score") : "",
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, offering_id, total, university_id")
    .eq("id", parsed.data.assessmentId)
    .maybeSingle();
  if (!assessment || assessment.university_id !== profile.university_id) {
    return { ok: false, error: "notAuthorized" };
  }
  if (parsed.data.score !== null && parsed.data.score > assessment.total) {
    return { ok: false, error: "scoreTooHigh" };
  }

  // A mark may only exist for a student actively enrolled in the offering.
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, sections!inner(offering_id)")
    .eq("profile_id", parsed.data.studentId)
    .eq("status", "active")
    .eq("sections.offering_id", assessment.offering_id)
    .limit(1)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "notEnrolled" };

  const score = parsed.data.score;
  const status = score === null ? "pending" : "graded";
  const { data: existing } = await supabase
    .from("marks")
    .select("id")
    .eq("assessment_id", assessment.id)
    .eq("student_id", parsed.data.studentId)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabase.from("marks").update({ score, status }).eq("id", existing.id));
  } else {
    ({ error } = await supabase.from("marks").insert({
      university_id: profile.university_id,
      created_by: profile.id,
      assessment_id: assessment.id,
      student_id: parsed.data.studentId,
      score,
      status,
    }));
  }
  if (error) return { ok: false, error: mapError(error.code) };

  revalidatePath(`/app/marks/${assessment.id}`);
  revalidatePath(`/app/offerings/${assessment.offering_id}`);
  revalidatePath(`/app/offerings/${assessment.offering_id}/marksheet`);
  revalidatePath("/app/marks");
  return { ok: true };
}
