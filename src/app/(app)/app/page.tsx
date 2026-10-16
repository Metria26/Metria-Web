import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { loadStudentDashboard } from "@/features/academics/dashboard";
import { AnnouncementList } from "@/features/academics/ui/announcement-list";

export const metadata = {
  title: "Dashboard",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

const displayDateFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
});

/**
 * T-A005 student dashboard (2.4): latest own marks, announcements for enrolled
 * sections and upcoming released assessments — all from one bounded RPC
 * (student_dashboard). Evaluations become available when T-A006 ships.
 */
export default async function DashboardPage() {
  await connection();
  const t = await getTranslations("Dashboard");
  const supabase = await createClient();
  const dashboard = await loadStudentDashboard(supabase);

  const isEmpty =
    dashboard.latest_marks.length === 0 &&
    dashboard.announcements.length === 0 &&
    dashboard.upcoming_assessments.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {isEmpty ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("body")}
          action={{ href: "/app/offerings", label: t("browseOfferings") }}
        />
      ) : null}

      <section className="grid gap-3" aria-labelledby="marks-heading">
        <h2 id="marks-heading" className="text-lg font-semibold">
          {t("latestMarks")}
        </h2>
        {dashboard.latest_marks.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="dashboard-marks-empty">
            {t("noMarks")}
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="dashboard-marks">
            {dashboard.latest_marks.map((mark, index) => (
              <li
                key={`${mark.offering_id}-${mark.assessment_title}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                data-testid="dashboard-mark"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">
                    {mark.assessment_title} · {mark.course_code}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {displayDateFormat.format(new Date(mark.recorded_at))}
                  </span>
                </span>
                <span className="text-sm">
                  {mark.score != null ? `${mark.score} / ${mark.total}` : t("pending")}
                </span>
                <Link
                  href={`/app/offerings/${mark.offering_id}/marksheet`}
                  className="text-sm text-primary hover:underline"
                >
                  {t("viewMarksheet")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="announcements-heading">
        <h2 id="announcements-heading" className="text-lg font-semibold">
          {t("announcements")}
        </h2>
        {dashboard.announcements.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="dashboard-announcements-empty">
            {t("noAnnouncements")}
          </p>
        ) : (
          <AnnouncementList
            announcements={dashboard.announcements.map((announcement) => ({
              id: announcement.id,
              title: announcement.title,
              bodyHtml: announcement.body_html,
              context: `${announcement.course_code} · ${announcement.section_code}`,
              createdAt: announcement.created_at,
            }))}
          />
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="text-lg font-semibold">
          {t("upcoming")}
        </h2>
        {dashboard.upcoming_assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="dashboard-upcoming-empty">
            {t("noUpcoming")}
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="dashboard-upcoming">
            {dashboard.upcoming_assessments.map((assessment) => (
              <li
                key={assessment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                data-testid="dashboard-upcoming-item"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">
                    {assessment.title} · {assessment.course_code}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`assessmentTypes.${assessment.assessment_type}`)} · {assessment.weight}%
                  </span>
                </span>
                <Link
                  href={`/app/offerings/${assessment.offering_id}`}
                  className="text-sm text-primary hover:underline"
                >
                  {t("viewOffering")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
