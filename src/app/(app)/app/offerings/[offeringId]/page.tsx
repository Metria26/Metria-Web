import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { AssessmentForm, EnrollmentForm, SectionForm } from "@/features/academics/ui/forms";

export const metadata: Metadata = {
  title: "Offering",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

type SectionRow = { id: string; section_code: string; capacity: number | null };
type AssessmentRow = {
  id: string;
  title: string;
  assessment_type: string;
  total: number;
  weight: number;
  visibility: string;
};
type EnrollmentRow = { id: string; section_id: string; profile_id: string; status: string };
type ProfileRow = { id: string; display_name: string; email: string };

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  // Per-user dynamic data behind auth — request-time only (blocking-prerender
  // current-time insight: supabase session math runs Date.now()).
  await connection();
  const t = await getTranslations("Offerings");
  const supabase = await createClient();

  // terms is joined in JS: the doc schema has no course_offerings→terms FK.
  const [offeringRes, termsRes] = await Promise.all([
    supabase
      .from("course_offerings")
      .select("id, offering_code, term_id, courses ( code, title )")
      .eq("id", offeringId)
      .maybeSingle(),
    supabase.from("terms").select("id, name"),
  ]);

  if (!offeringRes.data) {
    notFound();
  }
  const offeringRow = offeringRes.data as unknown as {
    id: string;
    offering_code: string;
    term_id: string;
    courses: { code: string; title: string } | null;
  };
  const termName = ((termsRes.data ?? []) as { id: string; name: string }[]).find(
    (term) => term.id === offeringRow.term_id,
  )?.name;

  // Viewer context: students get the marksheet link (enrolled), staff get the
  // per-assessment marks links. offering_staff reads fail closed for members
  // without academic.manage_offering, so non-staff resolve an empty list.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };
  const { data: viewerStaffRows } = viewerProfile
    ? await supabase
        .from("offering_staff")
        .select("id")
        .eq("offering_id", offeringId)
        .eq("profile_id", viewerProfile.id)
    : { data: [] as { id: string }[] };
  const viewerIsStaff = (viewerStaffRows ?? []).length > 0;

  const sectionsRes = await supabase
    .from("sections")
    .select("id, section_code, capacity")
    .eq("offering_id", offeringId)
    .order("section_code");
  const sections = (sectionsRes.data ?? []) as SectionRow[];

  // enrollments.profile_id has no FK in the doc schema, so PostgREST cannot
  // embed profiles — fetch both sides and join in memory.
  const [assessmentsRes, enrollmentsRes, profilesRes] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, title, assessment_type, total, weight, visibility")
      .eq("offering_id", offeringId)
      .order("created_at"),
    sections.length > 0
      ? supabase
          .from("enrollments")
          .select("id, section_id, profile_id, status")
          .in(
            "section_id",
            sections.map((section) => section.id),
          )
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, display_name, email"),
  ]);

  const assessments = (assessmentsRes.data ?? []) as AssessmentRow[];
  const enrollments = (enrollmentsRes.data ?? []) as EnrollmentRow[];
  const profiles = new Map(
    ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );

  // Enrollment proxy for the marksheet link: enrollments rows are
  // manage-readable only, so a student's own released marks (own-read RLS)
  // are the trustworthy signal that the viewer participates in this offering.
  const { data: viewerMarks } =
    viewerProfile && assessments.length > 0
      ? await supabase
          .from("marks")
          .select("id")
          .eq("student_id", viewerProfile.id)
          .in(
            "assessment_id",
            assessments.map((assessment) => assessment.id),
          )
          .limit(1)
      : { data: [] as { id: string }[] };
  const viewerHasMarks = (viewerMarks ?? []).length > 0;

  const sectionOptions = sections.map((section) => ({
    id: section.id,
    label: section.section_code,
  }));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href="/app/offerings"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="back-to-offerings"
          >
            ← {t("backToList")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="offering-title">
            {offeringRow.courses
              ? `${offeringRow.courses.code} — ${offeringRow.courses.title}`
              : offeringRow.offering_code}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="offering-meta">
            {offeringRow.offering_code}
            {termName ? ` · ${termName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewerHasMarks ? (
            <Link
              href={`/app/offerings/${offeringId}/marksheet`}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
              data-testid="marksheet-link"
            >
              {t("viewMarksheet")}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="grid gap-3" aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="text-lg font-semibold">
          {t("sections.sections")}
        </h2>
        {sections.length === 0 ? (
          <EmptyState title={t("empty.sectionsTitle")} description={t("empty.sectionsBody")} />
        ) : (
          <ul className="grid gap-2" data-testid="sections-list">
            {sections.map((section) => (
              <li
                key={section.id}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                data-testid="section-item"
              >
                <span className="font-medium">{section.section_code}</span>
                <span className="text-sm text-muted-foreground">
                  {section.capacity != null
                    ? t("capacityLabel", { count: section.capacity })
                    : t("capacityUnlimited")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <SectionForm offeringId={offeringId} />
      </section>

      <section className="grid gap-3" aria-labelledby="assessments-heading">
        <h2 id="assessments-heading" className="text-lg font-semibold">
          {t("sections.assessments")}
        </h2>
        {assessments.length === 0 ? (
          <EmptyState
            title={t("empty.assessmentsTitle")}
            description={t("empty.assessmentsBody")}
          />
        ) : (
          <ul className="grid gap-2" data-testid="assessments-list">
            {assessments.map((assessment) => (
              <li
                key={assessment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                data-testid="assessment-item"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">{assessment.title}</span>
                  <span className="text-sm text-muted-foreground" data-testid="assessment-meta">
                    {t(`assessmentTypes.${assessment.assessment_type}`)} · {assessment.total} ·{" "}
                    {assessment.weight}%
                  </span>
                </span>
                {viewerIsStaff ? (
                  <Link
                    href={`/app/marks/${assessment.id}`}
                    className="inline-flex h-9 shrink-0 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    data-testid="marks-link"
                  >
                    {t("enterMarks")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <AssessmentForm offeringId={offeringId} sections={sectionOptions} />
      </section>

      <section className="grid gap-3" aria-labelledby="students-heading">
        <h2 id="students-heading" className="text-lg font-semibold">
          {t("sections.students")}
        </h2>
        {enrollments.length === 0 ? (
          <EmptyState title={t("empty.studentsTitle")} description={t("empty.studentsBody")} />
        ) : (
          <ul className="grid gap-2" data-testid="enrollments-list">
            {enrollments.map((enrollment) => {
              const profile = profiles.get(enrollment.profile_id);
              const section = sections.find((candidate) => candidate.id === enrollment.section_id);
              return (
                <li
                  key={enrollment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                  data-testid="enrollment-item"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium">
                      {profile?.display_name ?? t("unknownStudent")}
                    </span>
                    <span className="text-sm text-muted-foreground">{profile?.email}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {section?.section_code} · {enrollment.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {sectionOptions.length > 0 ? (
          <EnrollmentForm sections={sectionOptions} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("enrollmentNeedsSection")}</p>
        )}
      </section>
    </div>
  );
}
