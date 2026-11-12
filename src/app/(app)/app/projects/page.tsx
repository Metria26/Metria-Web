import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardStatusBadge, GroupStatusBadge } from "@/features/projects/ui/status-badge";
import { formatDateTime } from "@/lib/time-format";

export const metadata: Metadata = {
  title: "Projects",
};

export const instant = false;

type DashboardRow = {
  id: string;
  title: string;
  status: string;
  opens_at: string | null;
  deadline_at: string | null;
  offering_id: string;
  section_id: string | null;
  min_members: number;
  max_members: number;
  group_id_prefix: string;
};

type GroupRow = {
  id: string;
  dashboard_id: string;
  group_id: string;
  project_title: string;
  status: string;
  submission_status: string;
};

export default async function ProjectsHubPage() {
  await connection();
  const t = await getTranslations("Projects");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("id, university_id")
        .eq("auth_user_id", user.id)
        .maybeSingle()
    : { data: null };

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold">{t("hub.title")}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t("hub.signIn")}</p>
      </main>
    );
  }

  const { data: staffRows } = await supabase
    .from("offering_staff")
    .select("offering_id")
    .eq("profile_id", profile.id);
  const staffedOfferingIds = [...new Set((staffRows ?? []).map((row) => row.offering_id))];
  const isStaff = staffedOfferingIds.length > 0;

  const [dashboardsRes, myMembersRes] = await Promise.all([
    supabase
      .from("project_dashboards")
      .select(
        "id, title, status, opens_at, deadline_at, offering_id, section_id, min_members, max_members, group_id_prefix",
      )
      .order("created_at", { ascending: false }),
    supabase.from("project_group_members").select("group_id").eq("profile_id", profile.id),
  ]);

  const dashboards = (dashboardsRes.data ?? []) as DashboardRow[];
  const myMemberRows = (myMembersRes.data ?? []) as { group_id: string }[];

  const offeringIds = [...new Set(dashboards.map((row) => row.offering_id))];
  const sectionIds = [
    ...new Set(dashboards.map((row) => row.section_id).filter((id): id is string => id !== null)),
  ];
  const [offeringsRes, sectionsRes] = await Promise.all([
    offeringIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses(code, title)")
          .in("id", offeringIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sectionIds.length > 0
      ? supabase.from("sections").select("id, section_code").in("id", sectionIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const offeringLabels = new Map(
    (
      (offeringsRes.data ?? []) as {
        id: string;
        offering_code: string;
        courses: { code: string; title: string } | null;
      }[]
    ).map((row) => [
      row.id,
      `${row.courses?.code ?? ""} ${row.courses?.title ?? ""} (${row.offering_code})`.trim(),
    ]),
  );
  const sectionLabels = new Map(
    ((sectionsRes.data ?? []) as { id: string; section_code: string }[]).map((row) => [
      row.id,
      row.section_code,
    ]),
  );

  const dashboardIds = dashboards.map((row) => row.id);
  const [groupsRes, requestsRes] = await Promise.all([
    dashboardIds.length > 0
      ? supabase
          .from("project_groups")
          .select("id, dashboard_id, group_id, project_title, status, submission_status")
          .in("dashboard_id", dashboardIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from("project_member_requests").select("id, group_id, status").eq("status", "pending"),
  ]);
  const groups = (groupsRes.data ?? []) as GroupRow[];
  const requests = (requestsRes.data ?? []) as { id: string; group_id: string; status: string }[];

  // Students: their own group (if any) per dashboard.
  const { data: myGroupRows } =
    myMemberRows.length > 0
      ? await supabase
          .from("project_groups")
          .select("id, dashboard_id, group_id, project_title, status, submission_status")
          .in(
            "id",
            myMemberRows.map((row) => row.group_id),
          )
          .is("deleted_at", null)
      : { data: [] as unknown[] };
  const myGroups = (myGroupRows ?? []) as GroupRow[];
  const myGroupByDashboard = new Map(myGroups.map((group) => [group.dashboard_id, group]));

  if (isStaff) {
    const pendingRequestIds = new Set(requests.map((request) => request.group_id));
    const pendingGroups = groups.filter((group) => pendingRequestIds.has(group.id));
    const awaitingReview = groups.filter(
      (group) => group.status === "submitted" || group.status === "under_review",
    );

    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" data-testid="projects-title">
              {t("hub.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("hub.staffSubtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/app/projects/new"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              data-testid="projects-new"
            >
              {t("hub.newDashboard")}
            </Link>
          </div>
        </header>

        <dl className="mt-6 grid gap-3 sm:grid-cols-4" data-testid="projects-stats">
          <Stat label={t("stats.dashboards")} value={dashboards.length} />
          <Stat
            label={t("stats.published")}
            value={dashboards.filter((row) => row.status === "published").length}
          />
          <Stat
            label={t("stats.groups")}
            value={groups.filter((group) => group.status !== "archived").length}
          />
          <Stat label={t("stats.awaitingReview")} value={awaitingReview.length} />
        </dl>
        {pendingGroups.length > 0 ? (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning-foreground">
            {t("hub.pendingRequests", { count: pendingGroups.length })}
          </p>
        ) : null}

        <section className="mt-8 grid gap-3">
          <h2 className="text-lg font-semibold">{t("hub.dashboardsHeading")}</h2>
          {dashboards.map((dashboard) => {
            const dashboardGroups = groups.filter((group) => group.dashboard_id === dashboard.id);
            return (
              <article
                key={dashboard.id}
                className="rounded-xl border p-4"
                data-testid={`dashboard-card-${dashboard.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/projects/${dashboard.id}`}
                      className="text-base font-semibold underline-offset-4 hover:underline"
                    >
                      {dashboard.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {offeringLabels.get(dashboard.offering_id) ?? ""}
                      {dashboard.section_id
                        ? ` · ${t("hub.section")} ${sectionLabels.get(dashboard.section_id) ?? ""}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("hub.groupPrefix", { prefix: dashboard.group_id_prefix || "—" })} ·{" "}
                      {t("hub.deadline", {
                        date: dashboard.deadline_at ? formatDateTime(dashboard.deadline_at) : "—",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DashboardStatusBadge
                      status={dashboard.status as never}
                      label={t(`statuses.dashboard.${dashboard.status}`)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t("hub.groupCount", { count: dashboardGroups.length })}
                    </span>
                    <Link
                      href={`/app/projects/${dashboard.id}/groups`}
                      className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted"
                    >
                      {t("hub.manage")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
          {dashboards.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("hub.emptyStaff")}
            </p>
          ) : null}
        </section>

        {myGroups.length > 0 ? (
          <section className="mt-8 grid gap-3">
            <h2 className="text-lg font-semibold">{t("hub.myGroups")}</h2>
            {myGroups.map((group) => (
              <StudentGroupCard key={group.id} group={group} t={t} />
            ))}
          </section>
        ) : null}
      </main>
    );
  }

  // Student view (prompt 5): dashboards visible to me + my group status.
  const visibleDashboards = dashboards.filter(
    (dashboard) => dashboard.status === "published" || dashboard.status === "closed",
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="projects-title">
            {t("hub.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("hub.studentSubtitle")}</p>
        </div>
      </header>

      <section className="mt-6 grid gap-3">
        {visibleDashboards.map((dashboard) => {
          const myGroup = myGroupByDashboard.get(dashboard.id);
          const canCreate = dashboard.status === "published" && !myGroup;
          return (
            <article
              key={dashboard.id}
              className="rounded-xl border p-4"
              data-testid={`dashboard-card-${dashboard.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/app/projects/${dashboard.id}`}
                    className="text-base font-semibold underline-offset-4 hover:underline"
                  >
                    {dashboard.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {offeringLabels.get(dashboard.offering_id) ?? ""}
                    {dashboard.section_id
                      ? ` · ${t("hub.section")} ${sectionLabels.get(dashboard.section_id) ?? ""}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("hub.teamSize", { min: dashboard.min_members, max: dashboard.max_members })}{" "}
                    ·{" "}
                    {t("hub.deadline", {
                      date: dashboard.deadline_at ? formatDateTime(dashboard.deadline_at) : "—",
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DashboardStatusBadge
                    status={dashboard.status as never}
                    label={t(`statuses.dashboard.${dashboard.status}`)}
                  />
                  {myGroup ? (
                    <>
                      <GroupStatusBadge
                        status={myGroup.status as never}
                        label={t(`statuses.group.${myGroup.status}`)}
                      />
                      <Link
                        href={`/app/projects/${dashboard.id}/my-group`}
                        className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        {t("hub.myGroup")}
                      </Link>
                    </>
                  ) : canCreate ? (
                    <span className="text-xs text-muted-foreground">{t("hub.canCreate")}</span>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
        {visibleDashboards.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("hub.emptyStudent")}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-bold" data-testid="stat-value">
        {value}
      </dd>
    </div>
  );
}

function StudentGroupCard({
  group,
  t,
}: {
  group: GroupRow;
  t: Awaited<ReturnType<typeof getTranslations<"Projects">>>;
}) {
  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{group.group_id}</p>
          <p className="text-sm font-semibold">{group.project_title || "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <GroupStatusBadge
            status={group.status as never}
            label={t(`statuses.group.${group.status}`)}
          />
          <Link
            href={`/app/projects/${group.dashboard_id}/my-group`}
            className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted"
          >
            {t("hub.myGroup")}
          </Link>
        </div>
      </div>
    </article>
  );
}
