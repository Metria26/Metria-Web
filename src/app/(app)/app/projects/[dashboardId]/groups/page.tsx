import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { GroupsTable, type GroupRow } from "@/features/projects/ui/groups-table";
import {
  PendingRequestsDropdown,
  type PendingRequestItem,
} from "@/features/projects/ui/pending-requests-dropdown";
import { DashboardStatusBadge } from "@/features/projects/ui/status-badge";

export const metadata: Metadata = {
  title: "Project groups",
};

export const instant = false;

type MemberRequestRow = {
  id: string;
  group_id: string;
  request_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export default async function ProjectGroupsPage({
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
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select("id, title, status, offering_id, min_members, max_members, group_id_prefix")
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
  if (!staffRow) notFound(); // TA-only page

  const [groupsRes, membersRes, requestsRes] = await Promise.all([
    supabase
      .from("project_groups")
      .select(
        "id, group_id, project_title, status, submission_status, submitted_at, leader_member_id, archived_at",
      )
      .eq("dashboard_id", dashboard.id)
      .is("deleted_at", null)
      .order("group_id"),
    supabase.from("project_group_members").select("id, group_id, name, reg_no").order("position"),
    supabase
      .from("project_member_requests")
      .select("id, group_id, request_type, payload, created_at")
      .eq("status", "pending"),
  ]);

  const groupRows = (groupsRes.data ?? []) as {
    id: string;
    group_id: string;
    project_title: string;
    status: string;
    submission_status: string;
    submitted_at: string | null;
    leader_member_id: string | null;
    archived_at: string | null;
  }[];
  const memberRows = (membersRes.data ?? []) as {
    id: string;
    group_id: string;
    name: string;
    reg_no: string;
  }[];
  const requests = (requestsRes.data ?? []) as MemberRequestRow[];
  const requestsByGroup = new Map<string, MemberRequestRow[]>();
  for (const request of requests) {
    const groupRequests = requestsByGroup.get(request.group_id) ?? [];
    groupRequests.push(request);
    requestsByGroup.set(request.group_id, groupRequests);
  }
  const pendingItems: PendingRequestItem[] = groupRows.flatMap((group) => {
    const groupRequests = requestsByGroup.get(group.id) ?? [];
    if (groupRequests.length === 0) return [];
    return [
      {
        id: group.id,
        primary: t("hub.pendingProject", { project: dashboard.title }),
        secondary: [
          t("hub.pendingGroup", { group: group.group_id }),
          group.project_title,
          t("hub.pendingRequestCount", { count: groupRequests.length }),
        ]
          .filter(Boolean)
          .join(" · "),
        count: groupRequests.length,
        href: `/app/projects/${dashboard.id}/groups/${group.id}`,
        changes: groupRequests.map((request) => {
          if (request.request_type !== "add") return t("requests.remove");
          const payload = request.payload ?? {};
          const name = typeof payload.name === "string" ? payload.name : "";
          const regNo =
            typeof payload.reg_no === "string"
              ? payload.reg_no
              : typeof payload.regNo === "string"
                ? payload.regNo
                : "";
          return `${t("requests.add")}: ${[name, regNo].filter(Boolean).join(" ")}`.trim();
        }),
      },
    ];
  });

  const rows: GroupRow[] = groupRows.map((group) => {
    const members = memberRows.filter((member) => member.group_id === group.id);
    const leader = members.find((member) => member.id === group.leader_member_id);
    return {
      id: group.id,
      group_id: group.group_id,
      project_title: group.project_title,
      status: group.status,
      submission_status: group.submission_status,
      submitted_at: group.submitted_at,
      leader_name: leader?.name ?? "",
      member_count: members.length,
      member_names: members.map((member) => `${member.name} ${member.reg_no}`).join(" "),
      archived_at: group.archived_at,
    };
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <nav className="mb-4 text-sm">
        <Link href={`/app/projects/${dashboard.id}`} className="underline-offset-4 hover:underline">
          ← {dashboard.title}
        </Link>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="groups-title">
            {t("groups.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("hub.groupPrefix", { prefix: dashboard.group_id_prefix || "—" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DashboardStatusBadge
            status={dashboard.status as never}
            label={t(`statuses.dashboard.${dashboard.status}`)}
          />
          <a
            href={`/api/projects/export?dashboardId=${dashboard.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            data-testid="groups-export-link"
          >
            {t("groups.exportAll")}
          </a>
        </div>
      </header>

      <PendingRequestsDropdown
        title={t("hub.pendingRequests", {
          count: pendingItems.reduce((sum, item) => sum + item.count, 0),
        })}
        hint={t("hub.pendingRequestsHint")}
        reviewLabel={t("hub.pendingReview")}
        items={pendingItems}
      />

      <section className="mt-6">
        <GroupsTable dashboardId={dashboard.id} groups={rows} />
      </section>
    </main>
  );
}
