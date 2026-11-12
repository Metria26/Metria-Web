import type { DashboardStatus, GroupStatus, SubmissionStatus } from "../contracts";

/** Status → badge classes (AA-contrast pairs from the design tokens). */
const DASHBOARD_BADGES: Record<DashboardStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/15 text-success-foreground",
  closed: "bg-warning/20 text-warning-foreground",
  archived: "bg-muted text-muted-foreground border border-border",
};

const GROUP_BADGES: Record<GroupStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary",
  under_review: "bg-warning/20 text-warning-foreground",
  revision_required: "bg-destructive/10 text-destructive",
  approved: "bg-success/15 text-success-foreground",
  in_progress: "bg-primary/10 text-primary",
  completed: "bg-success/15 text-success-foreground",
  rejected: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground border border-border",
};

const SUBMISSION_BADGES: Record<SubmissionStatus, string> = {
  not_submitted: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary",
  resubmitted: "bg-primary/10 text-primary",
  late: "bg-warning/20 text-warning-foreground",
};

const base =
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

export function DashboardStatusBadge({
  status,
  label,
}: {
  status: DashboardStatus;
  label: string;
}) {
  return (
    <span className={`${base} ${DASHBOARD_BADGES[status] ?? DASHBOARD_BADGES.draft}`}>{label}</span>
  );
}

export function GroupStatusBadge({ status, label }: { status: GroupStatus; label: string }) {
  return <span className={`${base} ${GROUP_BADGES[status] ?? GROUP_BADGES.draft}`}>{label}</span>;
}

export function SubmissionStatusBadge({
  status,
  label,
}: {
  status: SubmissionStatus;
  label: string;
}) {
  return (
    <span className={`${base} ${SUBMISSION_BADGES[status] ?? SUBMISSION_BADGES.not_submitted}`}>
      {label}
    </span>
  );
}
