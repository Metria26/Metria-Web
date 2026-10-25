import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/features/marks/ui/import-panel";
import { MarksEntry, type MarkEntryGroup } from "@/features/marks/ui/marks-entry";
import { ReleaseToggle } from "@/features/marks/ui/release-toggle";

export const metadata: Metadata = {
  title: "Marks",
};

// Per-user, RLS-scoped data behind auth: request-time only.
export const instant = false;

export default async function MarksEntryPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  await connection();
  const t = await getTranslations("Marks.entry");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, title, assessment_type, total, weight, visibility, offering_id, section_id")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!assessment || !user) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Staff gate: offering_staff rows are manage-readable, so a non-staff member
  // (or student) resolves zero rows and gets the friendly empty state while
  // RLS still fails closed on every write (R10).
  const { data: staffRow } = profile
    ? await supabase
        .from("offering_staff")
        .select("id")
        .eq("offering_id", assessment.offering_id)
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null };
  if (!profile || !staffRow) {
    return (
      <div className="flex flex-col gap-4">
        <BackToOffering offeringId={assessment.offering_id} label={t("backToOffering")} />
        <EmptyState title={t("notStaffedTitle")} description={t("notStaffedBody")} />
      </div>
    );
  }

  // Section scope: an assessment tied to a section lists only that section's
  // roster; an all-section assessment groups students per section so marks for
  // one section never mix with another (R10-friendly: RLS unchanged).
  const sectionScoped = assessment.section_id != null;
  const { data: sectionsData } = sectionScoped
    ? await supabase
        .from("sections")
        .select("id, section_code")
        .in("id", [assessment.section_id])
        .order("section_code")
    : await supabase
        .from("sections")
        .select("id, section_code")
        .eq("offering_id", assessment.offering_id)
        .order("section_code");
  const scopedSections = (sectionsData ?? []) as { id: string; section_code: string }[];
  const scopedSectionIds = scopedSections.map((section) => section.id);

  const { data: enrollments } =
    scopedSectionIds.length > 0
      ? await supabase
          .from("enrollments")
          .select("profile_id, section_id")
          .in("section_id", scopedSectionIds)
          .eq("status", "active")
      : { data: [] as { profile_id: string; section_id: string }[] };

  const studentIds = [...new Set((enrollments ?? []).map((row) => row.profile_id))];

  const [studentsRes, marksRes] = await Promise.all([
    studentIds.length > 0
      ? supabase.from("profiles").select("id, display_name, email").in("id", studentIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string; email: string }[] }),
    supabase.from("marks").select("student_id, score, status").eq("assessment_id", assessmentId),
  ]);

  const students = (studentsRes.data ?? []) as {
    id: string;
    display_name: string;
    email: string;
  }[];
  const marksByStudent = new Map(
    ((marksRes.data ?? []) as { student_id: string; score: number | null; status: string }[]).map(
      (mark) => [mark.student_id, mark],
    ),
  );
  const studentById = new Map(students.map((student) => [student.id, student]));

  const groups: MarkEntryGroup[] = scopedSections.map((section) => ({
    sectionId: section.id,
    sectionCode: section.section_code,
    rows: (enrollments ?? [])
      .filter((enrollment) => enrollment.section_id === section.id)
      .map((enrollment) => studentById.get(enrollment.profile_id))
      .filter((student): student is { id: string; display_name: string; email: string } =>
        Boolean(student),
      )
      .map((student) => ({
        studentId: student.id,
        name: student.display_name,
        email: student.email,
        score: marksByStudent.get(student.id)?.score ?? null,
        status: marksByStudent.get(student.id)?.status ?? "pending",
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-1">
        <BackToOffering offeringId={assessment.offering_id} label={t("backToOffering")} />
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="entry-title">
          {assessment.title}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="entry-meta">
          {t("meta", {
            type: t(`types.${assessment.assessment_type}`),
            total: assessment.total,
            weight: assessment.weight,
          })}
          {sectionScoped && scopedSections[0] !== undefined
            ? ` · ${t("sectionHeading", { code: scopedSections[0].section_code })}`
            : ""}
        </p>
      </div>

      <ReleaseToggle assessmentId={assessmentId} released={assessment.visibility === "students"} />

      <section className="grid gap-3" aria-labelledby="entry-heading">
        <h2 id="entry-heading" className="text-lg font-semibold">
          {t("listTitle")}
        </h2>
        <MarksEntry assessmentId={assessmentId} groups={groups} />
      </section>

      <section
        className="grid gap-3"
        aria-labelledby="import-heading"
        aria-label={t("importSection")}
      >
        <h2 id="import-heading" className="text-lg font-semibold">
          {t("importSection")}
        </h2>
        <ImportPanel assessmentId={assessmentId} />
      </section>
    </div>
  );
}

function BackToOffering({ offeringId, label }: { offeringId: string; label: string }) {
  return (
    <Link
      href={`/app/offerings/${offeringId}`}
      className="text-sm text-muted-foreground hover:underline"
      data-testid="back-to-offering"
    >
      ← {label}
    </Link>
  );
}
