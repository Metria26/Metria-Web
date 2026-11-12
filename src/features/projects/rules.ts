/**
 * Pure Projects-module rules shared by UI and unit tests. The database is
 * authoritative (private.submit_project etc. re-check every rule); these
 * helpers only pick labels, validate before upload and map stable error codes
 * to i18n keys.
 */
import { isHttpUrl, type DashboardStatus, type GroupStatus } from "./contracts";

/** Stable RPC error codes → i18n keys (messages pass through verbatim). */
export function mapRpcError(message: string | null | undefined): string {
  switch ((message ?? "").trim()) {
    case "not_found":
      return "notFound";
    case "invalid_input":
      return "invalidInput";
    case "prefix_required":
      return "prefixRequired";
    case "duplicate_group_id":
      return "duplicateGroupId";
    case "student_not_found":
      return "studentNotFound";
    case "student_not_enrolled":
      return "studentNotEnrolled";
    case "student_in_group":
      return "studentInGroup";
    case "duplicate_member":
      return "duplicateMember";
    case "group_full":
      return "groupFull";
    case "group_too_small":
      return "groupTooSmall";
    case "group_size":
      return "groupSize";
    case "not_leader":
      return "notLeader";
    case "not_published":
      return "notPublished";
    case "dashboard_closed":
      return "dashboardClosed";
    case "not_open":
      return "notOpen";
    case "deadline_passed":
      return "deadlinePassed";
    case "edit_not_allowed":
      return "editNotAllowed";
    case "member_changes_locked":
      return "memberChangesLocked";
    case "approval_required":
      return "approvalRequired";
    case "approval_not_required":
      return "approvalNotRequired";
    case "request_pending":
      return "requestPending";
    case "request_not_pending":
      return "requestNotPending";
    case "field_required":
      return "fieldRequired";
    case "invalid_field":
      return "invalidField";
    case "invalid_url":
      return "invalidUrl";
    case "invalid_status":
      return "invalidStatus";
    case "too_many_links":
      return "tooManyLinks";
    case "forbidden":
    case "unauthenticated":
      return "notAuthorized";
    default:
      return "generic";
  }
}

/** Postgres write error codes → i18n keys (RLS 42501, unique, FK, CHECK). */
export function mapWriteError(code: string | null | undefined): string {
  switch ((code ?? "").trim()) {
    case "42501":
      return "notAuthorized";
    case "23505":
      return "duplicate";
    case "23503":
      return "invalidReference";
    case "23502":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}

/**
 * Bulk member paste parser (prompt 3.2). One member per line, either
 * "Name, 24L-1001" or "Name 24L-1001" separated by a comma; blank lines and
 * comment lines (#) are skipped. Returns parsed rows plus per-line errors so
 * the preview can point at the offending line.
 */
export type ParsedBulkMember = { name: string; regNo: string };
export type BulkParseResult = {
  members: ParsedBulkMember[];
  errors: { line: number; code: "empty" | "duplicate" | "missingReg" | "tooLong" }[];
};

export function parseBulkMembers(text: string): BulkParseResult {
  const members: ParsedBulkMember[] = [];
  const errors: BulkParseResult["errors"] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    if (line.length > 200) {
      errors.push({ line: index + 1, code: "tooLong" });
      return;
    }
    // "Name, reg" — the first comma separates; a single comma-less line with
    // a recognizable trailing reg token also works ("Ali Ahmed 24L-1001").
    let name = line;
    let regNo = "";
    const commaIndex = line.indexOf(",");
    if (commaIndex >= 0) {
      name = line.slice(0, commaIndex);
      regNo = line.slice(commaIndex + 1);
    } else {
      // Space-separated form only when the trailing token looks like a reg
      // number (must contain a digit), so plain two-word names stay intact.
      const match = /^(\S.*\S)\s+([A-Za-z0-9-]*\d[A-Za-z0-9-]*)$/.exec(line);
      if (match) {
        name = match[1] ?? "";
        regNo = match[2] ?? "";
      }
    }
    name = name.trim();
    regNo = regNo.trim();
    if (name.length === 0 && regNo.length === 0) {
      errors.push({ line: index + 1, code: "empty" });
      return;
    }
    if (name.length === 0 || regNo.length === 0) {
      errors.push({ line: index + 1, code: "missingReg" });
      return;
    }
    const key = regNo.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) {
      errors.push({ line: index + 1, code: "duplicate" });
      return;
    }
    seen.add(key);
    members.push({ name, regNo });
  });

  return { members, errors };
}

/**
 * Student content gating mirror (SQL: private.project_student_content_allowed).
 * Pure display helper — the database re-checks on every write.
 */
export function studentContentAllowed(
  group: { submittedAt: string | null; status: GroupStatus; archivedAt: string | null },
  dashboard: { status: DashboardStatus; allowEditAfterSubmission: boolean },
): boolean {
  return (
    dashboard.status === "published" &&
    group.archivedAt === null &&
    (group.submittedAt === null ||
      dashboard.allowEditAfterSubmission ||
      group.status === "revision_required")
  );
}

/** Member-change gating for students (SQL: add/remove member RPCs). */
export function memberChangeState(
  group: { submittedAt: string | null; status: GroupStatus; archivedAt: string | null },
  dashboard: {
    status: DashboardStatus;
    allowEditAfterSubmission: boolean;
    allowMemberChangesAfterSubmission: boolean;
    requireMemberChangeApproval: boolean;
  },
): "direct" | "approval" | "locked" {
  if (dashboard.status !== "published" || group.archivedAt !== null) return "locked";
  if (group.submittedAt !== null && !dashboard.allowMemberChangesAfterSubmission) return "locked";
  if (dashboard.requireMemberChangeApproval) return "approval";
  return studentContentAllowed(group, dashboard) ? "direct" : "locked";
}

export { isHttpUrl };
