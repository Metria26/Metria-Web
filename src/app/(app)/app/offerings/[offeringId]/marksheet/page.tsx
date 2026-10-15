import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { marksheetSchema } from "@/features/marks/contracts";
import { privateRpc } from "@/features/marks/rpc";
import { cellStatus, classify, gradeFor, weightedTotal } from "@/features/marks/marksheet";

export const metadata: Metadata = {
  title: "Marksheet",
};

// Per-user, RLS-scoped data behind auth: request-time only.
export const instant = false;

export default async function MarksheetPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  await connection();
  const t = await getTranslations("Marks.marksheet");
  const supabase = await createClient();

  const { data: offeringRaw } = await supabase
    .from("course_offerings")
    .select("id, offering_code, courses ( code, title )")
    .eq("id", offeringId)
    .maybeSingle();
  const offering = offeringRaw as unknown as {
    id: string;
    offering_code: string;
    courses: { code: string; title: string } | null;
  } | null;
  if (!offering) notFound();

  const { data, error } = await privateRpc(supabase).rpc("offering_marksheet", {
    p_offering_id: offeringId,
  });

  if (error || data === null) {
    const notEnrolled = error?.message === "forbidden";
    return (
      <div className="flex flex-col gap-4">
        <BackLink offeringId={offeringId} label={t("backToOffering")} />
        <EmptyState
          title={notEnrolled ? t("notEnrolledTitle") : t("errorTitle")}
          description={notEnrolled ? t("notEnrolledBody") : t("errorBody")}
        />
      </div>
    );
  }

  const parsed = marksheetSchema.safeParse(data);
  if (!parsed.success) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink offeringId={offeringId} label={t("backToOffering")} />
        <EmptyState title={t("errorTitle")} description={t("errorBody")} />
      </div>
    );
  }
  const sheet = parsed.data;

  // TS-side math on our own row (unit-tested helpers; pgTAP asserts the RPC's
  // ownTotal uses the identical formula so the two cannot drift silently).
  const scores: Record<string, number | null> = {};
  for (const assessment of sheet.assessments) {
    scores[assessment.id] = sheet.ownScores[assessment.id]?.score ?? null;
  }
  const own = weightedTotal(
    sheet.assessments.map((assessment) => ({
      id: assessment.id,
      total: assessment.total,
      weight: assessment.weight,
    })),
    scores,
  );
  const grade = gradeFor(sheet.gradingScale?.bands, own.total);
  const buckets = classify(
    sheet.assessments.map((assessment) => ({
      id: assessment.id,
      total: assessment.total,
      weight: assessment.weight,
    })),
    sheet.ownScores,
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-1">
        <BackLink offeringId={offeringId} label={t("backToOffering")} />
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="marksheet-title">
          {offering.courses
            ? `${offering.courses.code} — ${offering.courses.title}`
            : offering.offering_code}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="flex flex-wrap items-stretch gap-3" aria-labelledby="overall-heading">
        <h2 id="overall-heading" className="sr-only">
          {t("overall")}
        </h2>
        <div className="grid min-w-44 content-center gap-0.5 rounded-lg border bg-card px-5 py-4">
          <span className="text-3xl font-semibold tabular-nums" data-testid="marksheet-total">
            {own.total.toFixed(1)}%
          </span>
          <span className="text-sm text-muted-foreground">
            {t("gradedWeight", { weight: own.gradedWeight })}
          </span>
        </div>
        <div className="grid min-w-32 content-center gap-0.5 rounded-lg border bg-card px-5 py-4">
          <span className="text-3xl font-semibold" data-testid="marksheet-grade">
            {grade ?? "—"}
          </span>
          <span className="text-sm text-muted-foreground">
            {sheet.gradingScale?.name ?? t("gradeLabel")}
          </span>
        </div>
        {sheet.thresholdMet ? (
          <div
            className="flex flex-1 flex-wrap items-center gap-3 rounded-lg border bg-card px-5 py-4 text-sm"
            data-testid="marksheet-stats"
          >
            <span data-testid="marksheet-rank">
              {t("rank", { rank: sheet.ownRank ?? 0, cohort: sheet.cohortSize })}
            </span>
            {sheet.stats ? (
              <>
                <span className="text-muted-foreground" data-testid="stats-mean">
                  {t("mean", { value: sheet.stats.mean.toFixed(1) })}
                </span>
                <span className="text-muted-foreground" data-testid="stats-median">
                  {t("median", { value: sheet.stats.median.toFixed(1) })}
                </span>
                <span className="text-muted-foreground" data-testid="stats-range">
                  {t("range", { min: sheet.stats.min.toFixed(1), max: sheet.stats.max.toFixed(1) })}
                </span>
              </>
            ) : null}
          </div>
        ) : (
          <div
            className="flex flex-1 items-center rounded-lg border border-dashed px-5 py-4 text-sm text-muted-foreground"
            data-testid="stats-suppressed"
          >
            {t("suppressed", { k: sheet.threshold, cohort: sheet.cohortSize })}
          </div>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="assessments-heading">
        <h2 id="assessments-heading" className="text-lg font-semibold">
          {t("assessmentsTitle")}
        </h2>
        {sheet.assessments.length === 0 ? (
          <EmptyState title={t("noAssessmentsTitle")} description={t("noAssessmentsBody")} />
        ) : (
          <ul className="grid gap-2" data-testid="marksheet-list">
            {sheet.assessments.map((assessment) => {
              const status = cellStatus(sheet.ownScores[assessment.id]);
              return (
                <li
                  key={assessment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                  data-testid="marksheet-row"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium">{assessment.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {t("rowMeta", { weight: assessment.weight, total: assessment.total })}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {status === "graded" ? (
                      <span className="font-medium tabular-nums" data-testid="cell-score">
                        {sheet.ownScores[assessment.id]?.score} / {assessment.total}
                      </span>
                    ) : (
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        data-testid={`cell-${status}`}
                      >
                        {t(`cells.${status}`)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {buckets.missing.length > 0 || buckets.pending.length > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="marksheet-missing-hint">
            {t("missingHint", {
              missing: buckets.missing.length,
              pending: buckets.pending.length,
            })}
          </p>
        ) : null}
      </section>

      {sheet.gradingScale && sheet.gradingScale.bands && sheet.gradingScale.bands.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="legend-heading">
          <h2 id="legend-heading" className="text-lg font-semibold">
            {t("legendTitle")}
          </h2>
          <ul className="flex flex-wrap gap-2" data-testid="grading-legend">
            {[...sheet.gradingScale.bands]
              .sort((a, b) => b.min - a.min)
              .map((band) => (
                <li
                  key={`${band.grade}-${band.min}`}
                  className="rounded-full border px-3 py-1 text-sm"
                >
                  <span className="font-medium">{band.grade}</span>{" "}
                  <span className="text-muted-foreground">≥ {band.min}%</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BackLink({ offeringId, label }: { offeringId: string; label: string }) {
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
