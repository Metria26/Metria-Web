"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { OfferingAnalytics } from "@/features/academics/analytics";

// D7: recharts loads only when a staff member opens an offering page.
const AnalyticsChart = dynamic(() => import("./analytics-chart"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-lg border bg-muted" />,
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

/**
 * T-A005 TA analytics (feature 2.5). Data is already k>=5-suppressed in SQL;
 * this component only decides how to render a suppressed bucket — never a
 * number — and lazy-loads the chart.
 */
export function TaAnalytics({ analytics }: { analytics: OfferingAnalytics }) {
  const t = useTranslations("Analytics");
  const suppressedLabel = t("suppressed", { k: analytics.k });

  return (
    <div className="grid gap-4" data-testid="analytics">
      {analytics.assessments.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="analytics-empty-assessments">
          {t("emptyAssessments")}
        </p>
      ) : (
        <ul className="grid gap-3" data-testid="analytics-assessments">
          {analytics.assessments.map((assessment) => (
            <li
              key={assessment.assessment_id}
              className="grid gap-3 rounded-lg border bg-card px-4 py-3"
              data-testid="analytics-assessment"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{assessment.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t("responses", { count: assessment.n })}
                </span>
              </div>
              {assessment.suppressed ? (
                <p className="text-sm text-muted-foreground" data-testid="analytics-suppressed">
                  {suppressedLabel}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-6">
                    <Stat label={t("avg")} value={`${assessment.avg_percent}%`} />
                    <Stat label={t("min")} value={`${assessment.min_percent}%`} />
                    <Stat label={t("max")} value={`${assessment.max_percent}%`} />
                  </div>
                  <AnalyticsChart
                    data={[
                      { bucket: "<50", count: assessment.bucket_0_49 ?? 0 },
                      { bucket: "50–74", count: assessment.bucket_50_74 ?? 0 },
                      { bucket: "75+", count: assessment.bucket_75_100 ?? 0 },
                    ]}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {analytics.sections.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">{t("bySection")}</h3>
          <ul className="grid gap-2" data-testid="analytics-sections">
            {analytics.sections.map((section) => (
              <li
                key={section.section_id}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm"
                data-testid="analytics-section"
              >
                <span className="font-medium">{section.section_code}</span>
                <span className="text-muted-foreground">
                  {section.suppressed
                    ? suppressedLabel
                    : `${section.avg_percent}% · ${t("responses", { count: section.n })}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
