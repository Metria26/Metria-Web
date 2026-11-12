import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/projects/export (owner request 2026-11-11, section 11)
 * Query: dashboardId (required), groupIds (optional CSV of group ids).
 * Real .xlsx workbook (never CSV) built from live RLS-guarded reads; the TA
 * must be offering staff on the dashboard's offering (or a platform admin).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ExportGroup = {
  id: string;
  group_id: string;
  project_title: string;
  status: string;
  submission_status: string;
  submitted_at: string | null;
  leader_member_id: string | null;
  dashboard_id: string;
};

type ExportMember = {
  id: string;
  group_id: string;
  name: string;
  reg_no: string;
  email: string | null;
  member_role: string;
  responsibilities: string;
};

type ExportResponse = {
  submission_id: string;
  field_id: string;
  value: string;
};

type ExportLink = { group_id: string; title: string; url: string };

const HEADER_FILL = "FFF1F5F9" as const;

function styleHeader(sheet: ExcelJS.Worksheet, columns: string[]): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FF111827" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 22;
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(Math.max((columns[index]?.length ?? 0) + 6, 14), 48);
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
}

function textBody(sheet: ExcelJS.Worksheet, columnCount: number): void {
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };
  }
  void columnCount;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dashboardId = url.searchParams.get("dashboardId") ?? "";
  const groupIdsParam = url.searchParams.get("groupIds") ?? "";
  if (!UUID_RE.test(dashboardId)) {
    return new Response(JSON.stringify({ code: "validation_error" }), { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ code: "unauthenticated" }), { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile) return new Response(JSON.stringify({ code: "forbidden" }), { status: 403 });

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select("id, university_id, offering_id, title")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dashboard || dashboard.university_id !== profile.university_id) {
    return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
  }

  // Authorization: offering staff or platform admin only (RLS re-checks reads).
  const { data: staff } = await supabase
    .from("offering_staff")
    .select("id")
    .eq("offering_id", dashboard.offering_id)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!staff) {
    const { data: admin } = await supabase.from("platform_admins").select("id").maybeSingle();
    if (!admin) return new Response(JSON.stringify({ code: "forbidden" }), { status: 403 });
  }

  const requestedIds = groupIdsParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_RE.test(value));

  let groupsQuery = supabase
    .from("project_groups")
    .select(
      "id, group_id, project_title, status, submission_status, submitted_at, leader_member_id, dashboard_id",
    )
    .eq("university_id", profile.university_id)
    .eq("dashboard_id", dashboard.id)
    .is("deleted_at", null)
    .order("group_id");
  if (requestedIds.length > 0) groupsQuery = groupsQuery.in("id", requestedIds);
  const { data: groupRows } = await groupsQuery;
  const groups = (groupRows ?? []) as ExportGroup[];
  if (groups.length === 0)
    return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });

  const groupIdList = groups.map((group) => group.id);
  const [membersRes, submissionsRes, linksRes] = await Promise.all([
    supabase
      .from("project_group_members")
      .select("id, group_id, name, reg_no, email, member_role, responsibilities")
      .eq("university_id", profile.university_id)
      .in("group_id", groupIdList)
      .order("position"),
    supabase
      .from("project_submissions")
      .select("id, group_id, version")
      .eq("university_id", profile.university_id)
      .in("group_id", groupIdList)
      .order("version"),
    supabase
      .from("project_links")
      .select("group_id, title, url")
      .eq("university_id", profile.university_id)
      .in("group_id", groupIdList),
  ]);

  // Latest submission per group (highest version).
  const latestByGroup = new Map<string, { id: string; version: number }>();
  for (const submission of (submissionsRes.data ?? []) as {
    id: string;
    group_id: string;
    version: number;
  }[]) {
    const current = latestByGroup.get(submission.group_id);
    if (!current || submission.version > current.version) {
      latestByGroup.set(submission.group_id, { id: submission.id, version: submission.version });
    }
  }

  const { data: responsesRes } = await supabase
    .from("project_submission_responses")
    .select("submission_id, field_id, value")
    .eq("university_id", profile.university_id)
    .in(
      "submission_id",
      Array.from(latestByGroup.values()).map((entry) => entry.id),
    );

  // Field-id → kind via the live dashboard fields (system kinds drive columns).
  const { data: fields } = await supabase
    .from("project_dashboard_fields")
    .select("id, kind")
    .eq("university_id", profile.university_id)
    .eq("dashboard_id", dashboard.id);
  const kindByFieldId = new Map(
    ((fields ?? []) as { id: string; kind: string | null }[]).map((field) => [
      field.id,
      field.kind,
    ]),
  );

  const responseBySubmission = new Map<string, Map<string, string>>();
  for (const response of (responsesRes ?? []) as unknown as ExportResponse[]) {
    let byField = responseBySubmission.get(response.submission_id);
    if (!byField) {
      byField = new Map();
      responseBySubmission.set(response.submission_id, byField);
    }
    byField.set(response.field_id, response.value);
  }

  const membersByGroup = new Map<string, ExportMember[]>();
  for (const member of (membersRes.data ?? []) as ExportMember[]) {
    const list = membersByGroup.get(member.group_id) ?? [];
    list.push(member);
    membersByGroup.set(member.group_id, list);
  }

  const linksByGroup = new Map<string, string[]>();
  for (const link of ((linksRes.data ?? []) as unknown as ExportLink[]) ?? []) {
    const list = linksByGroup.get(link.group_id) ?? [];
    list.push(`${link.title}: ${link.url}`);
    linksByGroup.set(link.group_id, list);
  }

  const valueOf = (groupId: string, kind: string): string => {
    const latest = latestByGroup.get(groupId);
    if (!latest) return "";
    const byField = responseBySubmission.get(latest.id);
    if (!byField) return "";
    for (const [fieldId, value] of byField) {
      if (kindByFieldId.get(fieldId) === kind) return value;
    }
    return "";
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Metria Projects";
  workbook.created = new Date();

  const overview = workbook.addWorksheet("Group Overview");
  overview.addRow([
    "Group ID",
    "Project Title",
    "Project Idea",
    "Problem Statement",
    "Proposed Solution",
    "Group Members",
    "Registration Numbers",
    "Group Leader",
    "Project Status",
    "Submission Status",
    "Submission Date",
    "Project Links",
  ]);
  for (const group of groups) {
    const members = membersByGroup.get(group.id) ?? [];
    const leaderName = members.find((member) => member.id === group.leader_member_id)?.name ?? "";
    overview.addRow([
      group.group_id,
      group.project_title || valueOf(group.id, "project_title"),
      valueOf(group.id, "project_idea"),
      valueOf(group.id, "problem_statement"),
      valueOf(group.id, "proposed_solution"),
      members.map((member) => member.name).join("; "),
      members.map((member) => member.reg_no).join("; "),
      leaderName,
      group.status,
      group.submission_status,
      group.submitted_at ? new Date(group.submitted_at).toISOString() : "",
      (linksByGroup.get(group.id) ?? []).join("\n"),
    ]);
  }
  styleHeader(overview, [
    "Group ID",
    "Project Title",
    "Project Idea",
    "Problem Statement",
    "Proposed Solution",
    "Group Members",
    "Registration Numbers",
    "Group Leader",
    "Project Status",
    "Submission Status",
    "Submission Date",
    "Project Links",
  ]);
  overview.getColumn(12).width = 40;
  textBody(overview, 12);

  const details = workbook.addWorksheet("Member Details");
  details.addRow([
    "Group ID",
    "Student Name",
    "Registration Number",
    "Email",
    "Role",
    "Responsibilities",
  ]);
  for (const group of groups) {
    for (const member of membersByGroup.get(group.id) ?? []) {
      details.addRow([
        group.group_id,
        member.name,
        member.reg_no,
        member.email ?? "",
        member.member_role,
        member.responsibilities,
      ]);
    }
  }
  styleHeader(details, [
    "Group ID",
    "Student Name",
    "Registration Number",
    "Email",
    "Role",
    "Responsibilities",
  ]);
  textBody(details, 6);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `projects-${dashboard.title.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
