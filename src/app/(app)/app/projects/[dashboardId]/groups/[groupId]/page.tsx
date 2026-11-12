import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  GroupStatusControl,
  LinksManager,
  MembersManager,
  RequestsPanel,
  ReviewComposer,
  ReviewList,
  type LinkRow,
  type MemberRow,
  type RequestRow,
  type ReviewRow,
} from "@/features/projects/ui/group-manage";
import { GroupStatusBadge, SubmissionStatusBadge } from "@/features/projects/ui/status-badge";
import { formatDateTime } from "@/lib/time-format";

export const metadata: Metadata = {
  title: "Project group",
};

export const instant = false;

export default async function ProjectGroupDetailPage({
  params,
}: {
  params: Promise<{ dashboardId: string; groupId: string }>;
}) {
  await connection();
  const { dashboardId, groupId } = await params;
  const t = await getTranslations("Projects");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  const { data: group } = await supabase
    .from("project_groups")
    .select(
      "id, dashboard_id, group_id, project_title, status, submission_status, submitted_at, leader_member_id, archived_at, deadline_override_at, university_id",
    )
    .eq("id", groupId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  if (!group) notFound();

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select(
      "id, title, offering_id, status, deadline_at, allow_edit_after_submission, allow_member_changes_after_submission, require_member_change_approval",
    )
    .eq("id", group.dashboard_id)
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

  const [
    membersRes,
    requestsRes,
    fieldsRes,
    submissionsRes,
    linksRes,
    reviewsRes,
    activityRes,
    otherGroupsRes,
  ] = await Promise.all([
    supabase
      .from("project_group_members")
      .select("id, name, reg_no, email, member_role, responsibilities")
      .eq("group_id", group.id)
      .order("position"),
    supabase
      .from("project_member_requests")
      .select("id, request_type, payload, member_id, status, created_at")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_dashboard_fields")
      .select("id, label, kind")
      .eq("dashboard_id", group.dashboard_id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("project_submissions")
      .select("id, version, submitted_at, late, fields_snapshot, submitted_by")
      .eq("group_id", group.id)
      .order("version", { ascending: false }),
    supabase.from("project_links").select("id, title, url, description").eq("group_id", group.id),
    supabase
      .from("project_reviews")
      .select(
        "id, review_type, review_status, general_comments, approval_explanation, rejection_reason, required_changes, suggestions, visibility, reviewer_name, is_edited, created_at, deleted_at",
      )
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_activity_logs")
      .select("id, actor_name, actor_role, action, entity_label, created_at, student_visible")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("project_groups")
      .select("id, group_id")
      .eq("dashboard_id", group.dashboard_id)
      .is("deleted_at", null)
      .neq("id", group.id),
  ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const requests = (requestsRes.data ?? []) as RequestRow[];
  const links = (linksRes.data ?? []) as LinkRow[];
  const reviews = (reviewsRes.data ?? []) as ReviewRow[];
  const submissions = (submissionsRes.data ?? []) as {
    id: string;
    version: number;
    submitted_at: string;
    late: boolean;
    fields_snapshot: { id: string; label: string; field_type: string; required: boolean }[] | null;
  }[];
  const activity = (activityRes.data ?? []) as {
    id: string;
    actor_name: string;
    actor_role: string;
    action: string;
    entity_label: string;
    created_at: string;
    student_visible: boolean;
  }[];
  const otherGroups = (otherGroupsRes.data ?? []) as { id: string; group_id: string }[];

  // Latest submission responses mapped through live field labels.
  const latestSubmission = submissions[0];
  let responses: { field_id: string; value: string }[] = [];
  if (latestSubmission) {
    const { data: responseRows } = await supabase
      .from("project_submission_responses")
      .select("field_id, value")
      .eq("submission_id", latestSubmission.id);
    responses = (responseRows ?? []) as { field_id: string; value: string }[];
  }
  const liveFields = (fieldsRes.data ?? []) as { id: string; label: string; kind: string | null }[];
  const snapshotFields = latestSubmission?.fields_snapshot ?? [];
  const labelForField = (fieldId: string): string => {
    const live = liveFields.find((field) => field.id === fieldId);
    if (live) return live.label;
    return snapshotFields.find((field) => field.id === fieldId)?.label ?? fieldId;
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <nav className="mb-4 text-sm">
        <Link
          href={`/app/projects/${dashboard.id}/groups`}
          className="underline-offset-4 hover:underline"
        >
          ← {t("groups.title")}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground" data-testid="detail-group-id">
            {group.group_id}
          </p>
          <h1 className="text-2xl font-bold">{group.project_title || t("group.noTitle")}</h1>
          <p className="text-xs text-muted-foreground">
            {dashboard.title} ·{" "}
            {t("hub.deadline", {
              date: formatDateTime(group.deadline_override_at ?? dashboard.deadline_at ?? null),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GroupStatusBadge
            status={group.status as never}
            label={t(`statuses.group.${group.status}`)}
          />
          <SubmissionStatusBadge
            status={group.submission_status as never}
            label={t(`statuses.submission.${group.submission_status}`)}
          />
        </div>
      </header>

      <section className="mt-6">
        <GroupStatusControl groupId={group.id} status={group.status} />
      </section>

      <Section title={t("sections.members")}>
        <MembersManager
          groupId={group.id}
          members={members}
          leaderMemberId={group.leader_member_id}
          otherGroups={otherGroups}
        />
        <h3 className="mt-4 text-sm font-semibold">{t("sections.requests")}</h3>
        <RequestsPanel requests={requests} />
      </Section>

      <Section title={t("sections.details")}>
        {latestSubmission ? (
          <dl className="grid gap-2 text-sm" data-testid="latest-responses">
            {responses.map((response) => (
              <div key={response.field_id} className="grid sm:grid-cols-[200px_1fr] gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  {labelForField(response.field_id)}
                </dt>
                <dd className="whitespace-pre-wrap">{response.value || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("details.notSubmitted")}</p>
        )}
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t("details.history")}</h3>
          <ul
            className="mt-2 grid gap-1 text-xs text-muted-foreground"
            data-testid="submission-history"
          >
            {submissions.map((submission) => (
              <li key={submission.id}>
                {t("details.version", { version: submission.version })} ·{" "}
                {formatDateTime(submission.submitted_at)}
                {submission.late ? ` · ${t("details.late")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title={t("sections.links")}>
        <LinksManager groupId={group.id} links={links} editable />
      </Section>

      <Section title={t("sections.reviews")}>
        <ReviewComposer groupId={group.id} />
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t("reviews.historyHeading")}</h3>
          <div className="mt-2">
            <ReviewList groupId={group.id} reviews={reviews} />
          </div>
        </div>
      </Section>

      <Section title={t("sections.activity")}>
        <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="activity-log">
          {activity.map((entry) => (
            <li key={entry.id}>
              <span className="font-medium text-foreground">{entry.actor_name}</span>{" "}
              {t.has(`activity.${entry.action}`) ? t(`activity.${entry.action}`) : entry.action}{" "}
              {entry.entity_label} · {formatDateTime(entry.created_at)}
            </li>
          ))}
          {activity.length === 0 ? <li>{t("activity.empty")}</li> : null}
        </ul>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 grid gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
