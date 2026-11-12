import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardControls } from "@/features/projects/ui/dashboard-controls";
import { CreateGroupForm } from "@/features/projects/ui/create-group-form";
import { DashboardStatusBadge, GroupStatusBadge } from "@/features/projects/ui/status-badge";
import { formatDateTime } from "@/lib/time-format";

export const metadata: Metadata = {
  title: "Project dashboard",
};

export const instant = false;

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  await connection();
  const { dashboardId } = await params;
  const t = await getTranslations("Projects");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("id, display_name, roll_no")
        .eq("auth_user_id", user.id)
        .maybeSingle()
    : { data: null };

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select(
      "id, title, description, instructions, status, opens_at, deadline_at, late_allowed, allow_student_groups, allow_individual, min_members, max_members, group_id_prefix, offering_id, section_id",
    )
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dashboard) notFound();

  const { data: staffRow } = profile
    ? await supabase
        .from("offering_staff")
        .select("id")
        .eq("offering_id", dashboard.offering_id)
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null };
  const isStaff = staffRow !== null;

  const { data: myMembership } = profile
    ? await supabase
        .from("project_group_members")
        .select("group_id")
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null };

  const { data: myGroupRow } = myMembership
    ? await supabase
        .from("project_groups")
        .select("id, group_id, project_title, status, submission_status, dashboard_id")
        .eq("id", myMembership.group_id)
        .eq("dashboard_id", dashboard.id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  const { data: groupIdRows } = await supabase
    .from("project_groups")
    .select("id")
    .eq("dashboard_id", dashboard.id)
    .is("deleted_at", null);
  const groupCount = ((groupIdRows ?? []) as { id: string }[]).length;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <nav className="mb-4 text-sm">
        <Link href="/app/projects" className="underline-offset-4 hover:underline">
          ← {t("hub.title")}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="dashboard-title">
            {dashboard.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("hub.groupPrefix", { prefix: dashboard.group_id_prefix || "—" })} ·{" "}
            {t("hub.teamSize", { min: dashboard.min_members, max: dashboard.max_members })} ·{" "}
            {t("hub.deadline", {
              date: dashboard.deadline_at ? formatDateTime(dashboard.deadline_at) : "—",
            })}
          </p>
        </div>
        <DashboardStatusBadge
          status={dashboard.status as never}
          label={t(`statuses.dashboard.${dashboard.status}`)}
        />
      </header>

      {dashboard.description ? <p className="mt-3 text-sm">{dashboard.description}</p> : null}
      {dashboard.instructions ? (
        <div
          className="mt-3 rounded-xl border bg-muted/30 p-4 text-sm"
          data-testid="dashboard-instructions"
        >
          <p className="whitespace-pre-wrap">{dashboard.instructions}</p>
        </div>
      ) : null}

      {isStaff ? (
        <section className="mt-8 grid gap-4">
          <h2 className="text-lg font-semibold">{t("overview.staffHeading")}</h2>
          <DashboardControls
            dashboardId={dashboard.id}
            status={dashboard.status}
            opensAt={dashboard.opens_at}
            deadlineAt={dashboard.deadline_at}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href={`/app/projects/${dashboard.id}/manage`}
              className="rounded-xl border p-4 hover:bg-muted/40"
            >
              <p className="font-semibold">{t("overview.manageForm")}</p>
              <p className="text-xs text-muted-foreground">{t("overview.manageFormHint")}</p>
            </Link>
            <Link
              href={`/app/projects/${dashboard.id}/groups`}
              className="rounded-xl border p-4 hover:bg-muted/40"
            >
              <p className="font-semibold">{t("overview.groups")}</p>
              <p className="text-xs text-muted-foreground">
                {t("hub.groupCount", { count: groupCount })}
              </p>
            </Link>
            <Link
              href={`/api/projects/export?dashboardId=${dashboard.id}`}
              className="rounded-xl border p-4 hover:bg-muted/40"
            >
              <p className="font-semibold">{t("overview.export")}</p>
              <p className="text-xs text-muted-foreground">{t("overview.exportHint")}</p>
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 grid gap-4">
          {myGroupRow ? (
            <div className="rounded-xl border p-4">
              <p className="text-sm font-semibold">{t("overview.myGroup")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {myGroupRow.group_id}
                </span>
                <GroupStatusBadge
                  status={myGroupRow.status as never}
                  label={t(`statuses.group.${myGroupRow.status}`)}
                />
                <Link
                  href={`/app/projects/${dashboard.id}/my-group`}
                  className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t("hub.myGroup")}
                </Link>
              </div>
            </div>
          ) : dashboard.status === "published" && dashboard.allow_student_groups ? (
            <div className="grid gap-3">
              <h2 className="text-lg font-semibold">{t("createGroup.heading")}</h2>
              <CreateGroupForm
                dashboardId={dashboard.id}
                selfName={profile?.display_name ?? ""}
                selfRegNo={profile?.roll_no ?? ""}
              />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("overview.studentWaiting")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
