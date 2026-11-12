import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  LinksManager,
  StudentMemberControls,
  SubmissionForm,
  type LinkRow,
  type MemberRow,
  type SubmitField,
} from "@/features/projects/ui/group-manage";
import { GroupStatusBadge, SubmissionStatusBadge } from "@/features/projects/ui/status-badge";
import { memberChangeState, studentContentAllowed } from "@/features/projects/rules";
import { formatDateTime } from "@/lib/time-format";

export const metadata: Metadata = {
  title: "My project group",
};

export const instant = false;

export default async function MyGroupPage({
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
  if (!profile) notFound();

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select(
      "id, title, status, instructions, opens_at, deadline_at, late_allowed, allow_edit_after_submission, allow_member_changes_after_submission, require_member_change_approval, min_members, max_members, allow_individual",
    )
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dashboard) notFound();

  // Only the caller's own group is reachable (RLS also enforces this).
  const { data: myMembership } = await supabase
    .from("project_group_members")
    .select("id, group_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const { data: group } = myMembership
    ? await supabase
        .from("project_groups")
        .select(
          "id, group_id, project_title, status, submission_status, submitted_at, leader_member_id, archived_at, latest_submission_id, deadline_override_at",
        )
        .eq("id", myMembership.group_id)
        .eq("dashboard_id", dashboard.id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  if (!group) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-10">
        <nav className="mb-4 text-sm">
          <Link href="/app/projects" className="underline-offset-4 hover:underline">
            ← {t("hub.title")}
          </Link>
        </nav>
        <h1 className="text-2xl font-bold">{t("myGroup.title")}</h1>
        <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("myGroup.noGroup")}
        </p>
      </main>
    );
  }

  const [membersRes, linksRes, fieldsRes, submissionsRes, reviewsRes, requestsRes, activityRes] =
    await Promise.all([
      supabase
        .from("project_group_members")
        .select("id, name, reg_no, email, member_role, responsibilities")
        .eq("group_id", group.id)
        .order("position"),
      supabase.from("project_links").select("id, title, url, description").eq("group_id", group.id),
      supabase
        .from("project_dashboard_fields")
        .select("id, label, description, field_type, required, placeholder, options")
        .eq("dashboard_id", dashboard.id)
        .is("deleted_at", null)
        .eq("enabled", true)
        .order("position"),
      supabase
        .from("project_submissions")
        .select("id, version, submitted_at, late")
        .eq("group_id", group.id)
        .order("version", { ascending: false }),
      supabase
        .from("project_reviews")
        .select(
          "id, review_type, review_status, general_comments, approval_explanation, rejection_reason, required_changes, suggestions, reviewer_name, is_edited, created_at",
        )
        .eq("group_id", group.id)
        .eq("visibility", "public")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("project_member_requests")
        .select("id, request_type, payload, status, created_at")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("project_activity_logs")
        .select("id, actor_name, action, entity_label, created_at")
        .eq("group_id", group.id)
        .eq("student_visible", true)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const links = (linksRes.data ?? []) as LinkRow[];
  const fields = ((fieldsRes.data ?? []) as SubmitField[]).map((field) => ({
    ...field,
    options: field.options ?? [],
  }));
  const submissions = (submissionsRes.data ?? []) as {
    id: string;
    version: number;
    submitted_at: string;
    late: boolean;
  }[];
  const publicReviews = (reviewsRes.data ?? []) as {
    id: string;
    review_type: string;
    review_status: string;
    general_comments: string;
    approval_explanation: string;
    rejection_reason: string;
    required_changes: string;
    suggestions: string;
    reviewer_name: string;
    is_edited: boolean;
    created_at: string;
  }[];
  const requests = (requestsRes.data ?? []) as {
    id: string;
    request_type: string;
    payload: Record<string, unknown> | null;
    status: string;
    created_at: string;
  }[];
  const activity = (activityRes.data ?? []) as {
    id: string;
    actor_name: string;
    action: string;
    entity_label: string;
    created_at: string;
  }[];

  // Existing answers of the latest submission (prefill the form).
  const latestSubmission = submissions[0];
  let responseRows: { field_id: string; value: string }[] = [];
  if (latestSubmission) {
    const { data: rows } = await supabase
      .from("project_submission_responses")
      .select("field_id, value")
      .eq("submission_id", latestSubmission.id);
    responseRows = (rows ?? []) as { field_id: string; value: string }[];
  }
  const existing = new Map(responseRows.map((row) => [row.field_id, row.value]));
  const existingResponses = Object.fromEntries(existing);

  const gating = {
    submittedAt: group.submitted_at,
    status: group.status as never,
    archivedAt: group.archived_at,
  };
  const canEditDetails = studentContentAllowed(gating, {
    status: dashboard.status as never,
    allowEditAfterSubmission: dashboard.allow_edit_after_submission,
  });
  const memberState = memberChangeState(gating, {
    status: dashboard.status as never,
    allowEditAfterSubmission: dashboard.allow_edit_after_submission,
    allowMemberChangesAfterSubmission: dashboard.allow_member_changes_after_submission,
    requireMemberChangeApproval: dashboard.require_member_change_approval,
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <nav className="mb-4 text-sm">
        <Link href="/app/projects" className="underline-offset-4 hover:underline">
          ← {t("hub.title")}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground" data-testid="my-group-id">
            {group.group_id}
          </p>
          <h1 className="text-2xl font-bold">{group.project_title || t("myGroup.title")}</h1>
          <p className="text-xs text-muted-foreground">
            {dashboard.title} ·{" "}
            {t("myGroup.effectiveDeadline", {
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

      {dashboard.instructions ? (
        <div className="mt-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p className="whitespace-pre-wrap">{dashboard.instructions}</p>
        </div>
      ) : null}

      <Section title={t("sections.members")}>
        <ul className="grid gap-2">
          {members.map((member) => (
            <li key={member.id} className="rounded-xl border p-3">
              <p className="text-sm font-semibold">
                {member.name}
                {member.id === group.leader_member_id ? (
                  <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                    {t("members.leader")}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {member.reg_no}
                {member.member_role && member.member_role !== "member"
                  ? ` · ${member.member_role}`
                  : ""}
              </p>
              {member.responsibilities ? (
                <p className="text-xs text-muted-foreground">{member.responsibilities}</p>
              ) : null}
            </li>
          ))}
        </ul>
        {memberState !== "locked" ? (
          <StudentMemberControls
            groupId={group.id}
            state={memberState}
            members={members}
            leaderMemberId={group.leader_member_id}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("members.locked")}</p>
        )}
        {requests.filter((request) => request.status === "pending").length > 0 ? (
          <ul className="grid gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning-foreground">
            {requests
              .filter((request) => request.status === "pending")
              .map((request) => (
                <li key={request.id}>
                  {request.request_type === "add"
                    ? `${t("requests.add")}: ${request.payload?.name ?? ""} ${request.payload?.regNo ?? request.payload?.reg_no ?? ""}`
                    : t("requests.remove")}{" "}
                  — {t("requests.pendingTa")}
                </li>
              ))}
          </ul>
        ) : null}
      </Section>

      <Section title={t("sections.details")}>
        {canEditDetails ? (
          <SubmissionForm
            groupId={group.id}
            fields={fields}
            existing={existingResponses}
            links={links}
          />
        ) : latestSubmission ? (
          <dl className="grid gap-2 text-sm" data-testid="my-responses">
            {fields.map((field) => (
              <div key={field.id} className="grid sm:grid-cols-[200px_1fr] gap-1">
                <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                <dd className="whitespace-pre-wrap">{existing.get(field.id) || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("myGroup.noSubmissionYet")}</p>
        )}
        {submissions.length > 0 ? (
          <ul className="mt-4 grid gap-1 text-xs text-muted-foreground">
            {submissions.map((submission) => (
              <li key={submission.id}>
                {t("details.version", { version: submission.version })} ·{" "}
                {formatDateTime(submission.submitted_at)}
                {submission.late ? ` · ${t("details.late")}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title={t("sections.links")}>
        <LinksManager groupId={group.id} links={links} editable={canEditDetails} />
      </Section>

      <Section title={t("sections.feedback")}>
        <ul className="grid gap-3" data-testid="feedback-list">
          {publicReviews.map((review) => (
            <li key={review.id} className="rounded-xl border p-4">
              <p className="text-sm font-semibold">
                {t(`reviews.types.${review.review_type}`)}
                {review.is_edited ? (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("reviews.edited")}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {review.reviewer_name} · {formatDateTime(review.created_at)}
              </p>
              <div className="mt-2 grid gap-1 text-sm">
                <FeedbackField
                  label={t("reviews.generalComments")}
                  value={review.general_comments}
                />
                <FeedbackField
                  label={t("reviews.approvalExplanation")}
                  value={review.approval_explanation}
                />
                <FeedbackField
                  label={t("reviews.rejectionReason")}
                  value={review.rejection_reason}
                />
                <FeedbackField
                  label={t("reviews.requiredChanges")}
                  value={review.required_changes}
                />
                <FeedbackField label={t("reviews.suggestions")} value={review.suggestions} />
              </div>
            </li>
          ))}
          {publicReviews.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t("myGroup.noFeedback")}</li>
          ) : null}
        </ul>
      </Section>

      <Section title={t("sections.activity")}>
        <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="my-activity">
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

function FeedbackField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid sm:grid-cols-[160px_1fr] gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}
