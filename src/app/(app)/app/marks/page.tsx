import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Marks",
};

// Per-user, RLS-scoped data behind auth: request-time only (same rationale as
// the (app) layout's instant=false).
export const instant = false;

type OfferingRow = {
  id: string;
  offering_code: string;
  courses: { code: string; title: string } | null;
};

export default async function MarksHubPage() {
  await connection();
  const t = await getTranslations("Marks.hub");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("auth_user_id", user.id)
        .maybeSingle()
    : { data: null };

  if (!user || !profile) {
    return <EmptyState title={t("empty.signedOutTitle")} description={t("empty.signedOutBody")} />;
  }

  // --- Staffed offerings: creator/assignee rows via offering_staff (manage read).
  const { data: staffRows } = await supabase
    .from("offering_staff")
    .select("offering_id")
    .eq("profile_id", profile.id);
  const staffOfferingIds = [...new Set((staffRows ?? []).map((row) => row.offering_id))];

  const [offeringsRes, assessmentsRes] = await Promise.all([
    staffOfferingIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses ( code, title )")
          .in("id", staffOfferingIds)
      : Promise.resolve({ data: [] as OfferingRow[] }),
    staffOfferingIds.length > 0
      ? supabase
          .from("assessments")
          .select("id, title, offering_id, assessment_type")
          .in("offering_id", staffOfferingIds)
          .order("created_at")
      : Promise.resolve({ data: [] as { id: string; title: string; offering_id: string }[] }),
  ]);
  const offerings = (offeringsRes.data ?? []) as OfferingRow[];
  const staffAssessments = (assessmentsRes.data ?? []) as {
    id: string;
    title: string;
    offering_id: string;
  }[];

  // --- Own marks (student read policy: released assessments, own rows only).
  const { data: ownMarks } = await supabase
    .from("marks")
    .select(
      "score, status, assessments ( id, title, offering_id, course_offerings ( id, offering_code, courses ( code, title ) ) )",
    )
    .eq("student_id", profile.id);

  const marksheetCards = new Map<
    string,
    { offeringId: string; label: string; graded: number; pending: number }
  >();
  for (const row of ownMarks ?? []) {
    const assessment = row.assessments as unknown as {
      id: string;
      title: string;
      offering_id: string;
      course_offerings: OfferingRow | null;
    } | null;
    if (!assessment) continue;
    const offering = assessment.course_offerings;
    const label = offering
      ? offering.courses
        ? `${offering.courses.code} — ${offering.courses.title}`
        : offering.offering_code
      : assessment.title;
    const entry = marksheetCards.get(assessment.offering_id) ?? {
      offeringId: assessment.offering_id,
      label,
      graded: 0,
      pending: 0,
    };
    if (row.score === null) entry.pending += 1;
    else entry.graded += 1;
    marksheetCards.set(assessment.offering_id, entry);
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="marks-title">
          {t("title", { name: profile.display_name })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="grid gap-3" aria-labelledby="teaching-heading">
        <h2 id="teaching-heading" className="text-lg font-semibold">
          {t("teaching")}
        </h2>
        {staffOfferingIds.length === 0 || offerings.length === 0 ? (
          <EmptyState title={t("empty.staffTitle")} description={t("empty.staffBody")} />
        ) : (
          <ul className="grid gap-3" data-testid="hub-teaching-list">
            {offerings.map((offering) => {
              const assessments = staffAssessments.filter(
                (assessment) => assessment.offering_id === offering.id,
              );
              return (
                <li
                  key={offering.id}
                  className="grid gap-2 rounded-lg border bg-card p-4"
                  data-testid="hub-offering-card"
                >
                  <span className="font-medium">
                    {offering.courses
                      ? `${offering.courses.code} — ${offering.courses.title}`
                      : offering.offering_code}
                  </span>
                  {assessments.length === 0 ? (
                    <span className="text-sm text-muted-foreground">{t("noAssessments")}</span>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {assessments.map((assessment) => (
                        <li key={assessment.id}>
                          <Link
                            href={`/app/marks/${assessment.id}`}
                            className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                            data-testid="hub-assessment-link"
                          >
                            {t("enterMarks", { title: assessment.title })}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="sheets-heading">
        <h2 id="sheets-heading" className="text-lg font-semibold">
          {t("myMarksheets")}
        </h2>
        {marksheetCards.size === 0 ? (
          <EmptyState title={t("empty.studentTitle")} description={t("empty.studentBody")} />
        ) : (
          <ul className="grid gap-2" data-testid="hub-marksheet-list">
            {[...marksheetCards.values()].map((card) => (
              <li
                key={card.offeringId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
                data-testid="hub-marksheet-card"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">{card.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("scoreSummary", { graded: card.graded, pending: card.pending })}
                  </span>
                </span>
                <Link
                  href={`/app/offerings/${card.offeringId}/marksheet`}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
                  data-testid="marksheet-link"
                >
                  {t("openMarksheet")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
