"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcTransport } from "@/lib/supabase/rpc";
import { universityDateTimeInputToIso } from "@/lib/time-format";
import {
  dashboardInputSchema,
  dashboardUpdateSchema,
  createGroupInputSchema,
  fieldInputSchema,
  reviewInputSchema,
  reviewUpdateInputSchema,
  submitProjectInputSchema,
  memberInputSchema,
  type ActionResult,
} from "./contracts";
import { mapRpcError, mapWriteError } from "./rules";

const z_membersArray = memberInputSchema.array().min(1).max(50);

/**
 * Server actions for the Projects module. Every mutation either goes through
 * a private-schema RPC (group ID issuance, submissions, reviews, member
 * rules) or a direct RLS-guarded table write (field builder).
 * The database re-validates authorization on every call.
 */

type Caller = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profile: { id: string; university_id: string } | null;
};

/** Caller's profile row; RLS gates this read (profiles_self_read). */
async function callerProfile(): Promise<Caller> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, profile: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, profile: profile ?? null };
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formBool(formData: FormData, key: string): boolean | undefined {
  const raw = emptyToUndefined(formData.get(key));
  if (raw === undefined) return undefined;
  return raw === "on" || raw === "true" || raw === "1";
}

function formDateOrNull(formData: FormData, key: string): string | null {
  const raw = emptyToUndefined(formData.get(key));
  if (!raw) return null;
  return universityDateTimeInputToIso(raw);
}

function formUuid(formData: FormData, key: string): string | null {
  const value = emptyToUndefined(formData.get(key));
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function formJson<T>(formData: FormData, key: string): T | null {
  const raw = emptyToUndefined(formData.get(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function revalidateProject(dashboardId?: string | null, groupId?: string | null): void {
  revalidatePath("/app/projects");
  if (dashboardId) {
    revalidatePath(`/app/projects/${dashboardId}`);
    revalidatePath(`/app/projects/${dashboardId}/groups`);
    revalidatePath(`/app/projects/${dashboardId}/my-group`);
    revalidatePath(`/app/projects/${dashboardId}/manage`);
    if (groupId) revalidatePath(`/app/projects/${dashboardId}/groups/${groupId}`);
  }
}

/** Calls a project RPC through the untyped transport (types not generated). */
async function callRpc(
  supabase: Caller["supabase"],
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const { data, error } = await rpcTransport(supabase).rpc(fn, args);
  if (error) return { ok: false, error: mapRpcError(error.message) };
  return { ok: true, id: typeof data === "string" && data ? data : undefined };
}

// ---------------------------------------------------------------------------
// Dashboard lifecycle
// ---------------------------------------------------------------------------

export async function createDashboardAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = dashboardInputSchema.safeParse({
    offeringId: emptyToUndefined(formData.get("offeringId")) ?? "",
    sectionId: emptyToUndefined(formData.get("sectionId")),
    title: emptyToUndefined(formData.get("title")) ?? "",
    description: emptyToUndefined(formData.get("description")),
    instructions: emptyToUndefined(formData.get("instructions")),
    opensAt: emptyToUndefined(formData.get("opensAt")),
    deadlineAt: emptyToUndefined(formData.get("deadlineAt")),
    lateAllowed: formBool(formData, "lateAllowed"),
    allowEditAfterSubmission: formBool(formData, "allowEditAfterSubmission"),
    allowMemberChangesAfterSubmission: formBool(formData, "allowMemberChangesAfterSubmission"),
    requireMemberChangeApproval: formBool(formData, "requireMemberChangeApproval"),
    allowIndividual: formBool(formData, "allowIndividual"),
    allowStudentGroups: formBool(formData, "allowStudentGroups") ?? true,
    minMembers: emptyToUndefined(formData.get("minMembers")),
    maxMembers: emptyToUndefined(formData.get("maxMembers")),
    groupIdPrefix: emptyToUndefined(formData.get("groupIdPrefix")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const data = parsed.data;

  const result = await callRpc(supabase, "create_project_dashboard", {
    p_university_id: profile.university_id,
    p_offering_id: data.offeringId,
    p_section_id: data.sectionId ? data.sectionId : null,
    p_title: data.title,
    p_description: data.description,
    p_instructions: data.instructions,
    p_opens_at: data.opensAt ? universityDateTimeInputToIso(data.opensAt) : null,
    p_deadline_at: data.deadlineAt ? universityDateTimeInputToIso(data.deadlineAt) : null,
    p_late_allowed: data.lateAllowed,
    p_allow_edit_after_submission: data.allowEditAfterSubmission,
    p_allow_member_changes_after_submission: data.allowMemberChangesAfterSubmission,
    p_require_member_change_approval: data.requireMemberChangeApproval,
    p_allow_individual: data.allowIndividual,
    p_allow_student_groups: data.allowStudentGroups,
    p_min_members: data.minMembers,
    p_max_members: data.maxMembers,
    p_group_id_prefix: data.groupIdPrefix,
  });
  if (result.ok) revalidateProject(result.id);
  return result;
}

export async function updateDashboardAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };

  const parsed = dashboardUpdateSchema.safeParse({
    title: emptyToUndefined(formData.get("title")) ?? "",
    description: emptyToUndefined(formData.get("description")),
    instructions: emptyToUndefined(formData.get("instructions")),
    lateAllowed: formBool(formData, "lateAllowed"),
    allowEditAfterSubmission: formBool(formData, "allowEditAfterSubmission"),
    allowMemberChangesAfterSubmission: formBool(formData, "allowMemberChangesAfterSubmission"),
    requireMemberChangeApproval: formBool(formData, "requireMemberChangeApproval"),
    allowIndividual: formBool(formData, "allowIndividual"),
    allowStudentGroups: formBool(formData, "allowStudentGroups") ?? true,
    minMembers: emptyToUndefined(formData.get("minMembers")),
    maxMembers: emptyToUndefined(formData.get("maxMembers")),
    groupIdPrefix: emptyToUndefined(formData.get("groupIdPrefix")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const data = parsed.data;

  const result = await callRpc(supabase, "update_project_dashboard", {
    p_dashboard_id: dashboardId,
    p_title: data.title,
    p_description: data.description,
    p_instructions: data.instructions,
    p_late_allowed: data.lateAllowed,
    p_allow_edit_after_submission: data.allowEditAfterSubmission,
    p_allow_member_changes_after_submission: data.allowMemberChangesAfterSubmission,
    p_require_member_change_approval: data.requireMemberChangeApproval,
    p_allow_individual: data.allowIndividual,
    p_allow_student_groups: data.allowStudentGroups,
    p_min_members: data.minMembers,
    p_max_members: data.maxMembers,
    p_group_id_prefix: data.groupIdPrefix,
  });
  if (result.ok) revalidateProject(dashboardId);
  return result;
}

export async function setDashboardStatusAction(formData: FormData): Promise<ActionResult> {
  const dashboardId = formUuid(formData, "dashboardId");
  const status = emptyToUndefined(formData.get("status"));
  if (!dashboardId || !status) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "set_project_dashboard_status", {
    p_dashboard_id: dashboardId,
    p_status: status,
  });
  if (result.ok) revalidateProject(dashboardId);
  return result;
}

export async function setDeadlineAction(formData: FormData): Promise<ActionResult> {
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "set_project_deadline", {
    p_dashboard_id: dashboardId,
    p_opens_at: formDateOrNull(formData, "opensAt"),
    p_deadline_at: formDateOrNull(formData, "deadlineAt"),
    p_late_allowed: formBool(formData, "lateAllowed"),
  });
  if (result.ok) revalidateProject(dashboardId);
  return result;
}

export async function duplicateDashboardAction(formData: FormData): Promise<ActionResult> {
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "duplicate_project_dashboard", {
    p_dashboard_id: dashboardId,
  });
  if (result.ok) revalidateProject(result.id);
  return result;
}

export async function deleteDashboardAction(formData: FormData): Promise<ActionResult> {
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "delete_project_dashboard", {
    p_dashboard_id: dashboardId,
  });
  if (result.ok) revalidateProject(dashboardId);
  return result;
}

/** Preview of the next sequential Group ID (consumes nothing). */
export async function nextGroupIdAction(formData: FormData): Promise<ActionResult> {
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "next_project_group_id", { p_dashboard_id: dashboardId });
  return result;
}

// ---------------------------------------------------------------------------
// Groups + members
// ---------------------------------------------------------------------------

export async function createGroupAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const dashboardId = formUuid(formData, "dashboardId");
  const members = formJson<unknown>(formData, "members");
  const parsed = createGroupInputSchema.safeParse({
    dashboardId: dashboardId ?? "",
    groupId: emptyToUndefined(formData.get("groupId")) ?? "",
    projectTitle: emptyToUndefined(formData.get("projectTitle")) ?? "",
    members,
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const result = await callRpc(supabase, "create_project_group", {
    p_dashboard_id: parsed.data.dashboardId,
    p_group_id: parsed.data.groupId || null,
    p_project_title: parsed.data.projectTitle,
    p_members: parsed.data.members,
  });
  if (result.ok) revalidateProject(parsed.data.dashboardId, result.id);
  return result;
}

export async function addMembersAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const members = formJson<unknown>(formData, "members");
  const parsedMembers = z_membersArray.safeParse(members);
  if (!groupId || !parsedMembers.success) return { ok: false, error: "invalidInput" };
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const result = await callRpc(supabase, "add_project_group_members", {
    p_group_id: groupId,
    p_members: parsedMembers.data,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

async function revalidateGroup(supabase: Caller["supabase"], groupId: string): Promise<void> {
  const { data: group } = await supabase
    .from("project_groups")
    .select("dashboard_id")
    .eq("id", groupId)
    .maybeSingle();
  revalidateProject(group?.dashboard_id ?? null, groupId);
}

export async function removeMemberAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const memberId = formUuid(formData, "memberId");
  if (!groupId || !memberId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "remove_project_group_member", {
    p_group_id: groupId,
    p_member_id: memberId,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function transferMemberAction(formData: FormData): Promise<ActionResult> {
  const memberId = formUuid(formData, "memberId");
  const targetGroupId = formUuid(formData, "targetGroupId");
  if (!memberId || !targetGroupId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "transfer_project_member", {
    p_member_id: memberId,
    p_target_group_id: targetGroupId,
  });
  if (result.ok) await revalidateGroup(supabase, targetGroupId);
  return result;
}

export async function setLeaderAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const memberId = formUuid(formData, "memberId");
  if (!groupId || !memberId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "set_project_group_leader", {
    p_group_id: groupId,
    p_member_id: memberId,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function archiveGroupAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  if (!groupId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "archive_project_group", { p_group_id: groupId });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function deleteGroupAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  if (!groupId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  await revalidateGroup(supabase, groupId); // capture paths before the row is gone
  const result = await callRpc(supabase, "delete_project_group", { p_group_id: groupId });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function requestMemberChangeAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const requestType = emptyToUndefined(formData.get("requestType"));
  if (!groupId || (requestType !== "add" && requestType !== "remove")) {
    return { ok: false, error: "invalidInput" };
  }
  const { supabase } = await callerProfile();

  const payload = requestType === "add" ? formJson<unknown>(formData, "member") : null;
  const parsedMember = requestType === "add" ? memberInputSchema.safeParse(payload) : null;
  if (requestType === "add" && !parsedMember?.success) return { ok: false, error: "invalidInput" };
  const memberId = formUuid(formData, "memberId");

  const result = await callRpc(supabase, "request_project_member_change", {
    p_group_id: groupId,
    p_request_type: requestType,
    p_member: requestType === "add" ? (parsedMember?.data ?? {}) : null,
    p_member_id: memberId,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function decideMemberRequestAction(formData: FormData): Promise<ActionResult> {
  const requestId = formUuid(formData, "requestId");
  const approve = formBool(formData, "approve");
  if (!requestId || approve === undefined) return { ok: false, error: "invalidInput" };
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  // Resolve the request's group before the decision so the right paths refresh.
  const { data: request } = await supabase
    .from("project_member_requests")
    .select("id, group_id, project_groups!inner(dashboard_id)")
    .eq("id", requestId)
    .maybeSingle();
  const dashboardId =
    ((request?.project_groups ?? null) as unknown as { dashboard_id: string } | null)
      ?.dashboard_id ?? null;

  const result = await callRpc(supabase, "decide_project_member_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (result.ok) revalidateProject(dashboardId, request?.group_id ?? null);
  return result;
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export async function submitProjectAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const groupId = formUuid(formData, "groupId");
  const responses = formJson<Record<string, string>>(formData, "responses") ?? {};
  const links = formJson<unknown>(formData, "links") ?? [];
  const parsed = submitProjectInputSchema.safeParse({ groupId: groupId ?? "", responses, links });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const result = await callRpc(supabase, "submit_project", {
    p_group_id: parsed.data.groupId,
    p_responses: parsed.data.responses,
    p_links: parsed.data.links,
  });
  if (result.ok) await revalidateGroup(supabase, parsed.data.groupId);
  return result;
}

export async function setGroupStatusAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const status = emptyToUndefined(formData.get("status"));
  if (!groupId || !status) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "set_project_group_status", {
    p_group_id: groupId,
    p_status: status,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function createReviewAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  if (!groupId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const parsed = reviewInputSchema.safeParse({
    groupId,
    reviewType: emptyToUndefined(formData.get("reviewType")) ?? "",
    generalComments: emptyToUndefined(formData.get("generalComments")),
    approvalExplanation: emptyToUndefined(formData.get("approvalExplanation")),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
    requiredChanges: emptyToUndefined(formData.get("requiredChanges")),
    suggestions: emptyToUndefined(formData.get("suggestions")),
    visibility: emptyToUndefined(formData.get("visibility")) ?? "public",
    newStatus: emptyToUndefined(formData.get("newStatus")) ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const result = await callRpc(supabase, "create_project_review", {
    p_group_id: parsed.data.groupId,
    p_review_type: parsed.data.reviewType,
    p_general_comments: parsed.data.generalComments,
    p_approval_explanation: parsed.data.approvalExplanation,
    p_rejection_reason: parsed.data.rejectionReason,
    p_required_changes: parsed.data.requiredChanges,
    p_suggestions: parsed.data.suggestions,
    p_visibility: parsed.data.visibility,
    p_new_status: parsed.data.newStatus || null,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function updateReviewAction(formData: FormData): Promise<ActionResult> {
  const reviewId = formUuid(formData, "reviewId");
  const groupId = formUuid(formData, "groupId");
  if (!reviewId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const parsed = reviewUpdateInputSchema.safeParse({
    reviewId,
    generalComments: emptyToUndefined(formData.get("generalComments")),
    approvalExplanation: emptyToUndefined(formData.get("approvalExplanation")),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
    requiredChanges: emptyToUndefined(formData.get("requiredChanges")),
    suggestions: emptyToUndefined(formData.get("suggestions")),
    visibility: emptyToUndefined(formData.get("visibility")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  // Enforce required text per the review's stored type (reject/request_changes).
  const { data: review } = await supabase
    .from("project_reviews")
    .select("id, review_type, group_id, dashboard_id")
    .eq("id", reviewId)
    .maybeSingle();
  if (!review) return { ok: false, error: "notFound" };
  if (
    (review.review_type === "reject" && !parsed.data.rejectionReason.trim()) ||
    (review.review_type === "request_changes" && !parsed.data.requiredChanges.trim())
  ) {
    return { ok: false, error: "invalidInput" };
  }

  const result = await callRpc(supabase, "update_project_review", {
    p_review_id: reviewId,
    p_general_comments: parsed.data.generalComments,
    p_approval_explanation: parsed.data.approvalExplanation,
    p_rejection_reason: parsed.data.rejectionReason,
    p_required_changes: parsed.data.requiredChanges,
    p_suggestions: parsed.data.suggestions,
    p_visibility: parsed.data.visibility ?? null,
  });
  if (result.ok) {
    const revalidateTarget =
      groupId ?? (typeof review.group_id === "string" ? review.group_id : null);
    if (revalidateTarget) await revalidateGroup(supabase, revalidateTarget);
  }
  return result;
}

export async function deleteReviewAction(formData: FormData): Promise<ActionResult> {
  const reviewId = formUuid(formData, "reviewId");
  const groupId = formUuid(formData, "groupId");
  if (!reviewId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "delete_project_review", { p_review_id: reviewId });
  if (result.ok && groupId) await revalidateGroup(supabase, groupId);
  return result;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function upsertLinkAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const linkId = formUuid(formData, "linkId");
  const title = emptyToUndefined(formData.get("title"));
  const url = emptyToUndefined(formData.get("url"));
  if (!groupId || !title || !url) return { ok: false, error: "invalidInput" };
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) return { ok: false, error: "invalidUrl" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "upsert_project_link", {
    p_group_id: groupId,
    p_link_id: linkId,
    p_title: title,
    p_url: url,
    p_description: emptyToUndefined(formData.get("description")) ?? "",
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

export async function deleteLinkAction(formData: FormData): Promise<ActionResult> {
  const groupId = formUuid(formData, "groupId");
  const linkId = formUuid(formData, "linkId");
  if (!groupId || !linkId) return { ok: false, error: "invalidInput" };
  const { supabase } = await callerProfile();
  const result = await callRpc(supabase, "delete_project_link", {
    p_group_id: groupId,
    p_link_id: linkId,
  });
  if (result.ok) await revalidateGroup(supabase, groupId);
  return result;
}

// ---------------------------------------------------------------------------
// Form builder (direct RLS-guarded writes by staff)
// ---------------------------------------------------------------------------

export async function addFieldAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const dashboardId = formUuid(formData, "dashboardId");
  if (!dashboardId) return { ok: false, error: "invalidInput" };
  const parsed = fieldInputSchema.safeParse({
    dashboardId,
    label: emptyToUndefined(formData.get("label")) ?? "",
    description: emptyToUndefined(formData.get("description")),
    fieldType: emptyToUndefined(formData.get("fieldType")) ?? "",
    required: formBool(formData, "required") ?? false,
    placeholder: emptyToUndefined(formData.get("placeholder")),
    options: formJson<string[]>(formData, "options") ?? [],
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.fieldType === "select" && parsed.data.options.length === 0) {
    return { ok: false, error: "invalidInput" };
  }

  const { data: maxRow } = await supabase
    .from("project_dashboard_fields")
    .select("position")
    .eq("university_id", profile.university_id)
    .eq("dashboard_id", dashboardId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (maxRow?.[0]?.position ?? -1) + 1;

  const { error } = await supabase.from("project_dashboard_fields").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    dashboard_id: dashboardId,
    position: nextPosition,
    label: parsed.data.label,
    description: parsed.data.description,
    field_type: parsed.data.fieldType,
    required: parsed.data.required,
    placeholder: parsed.data.placeholder,
    options: parsed.data.options,
  });
  if (error) return { ok: false, error: mapWriteError(error.code) };
  revalidateProject(dashboardId);
  return { ok: true };
}

export async function updateFieldAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const fieldId = formUuid(formData, "fieldId");
  const dashboardId = formUuid(formData, "dashboardId");
  if (!fieldId || !dashboardId) return { ok: false, error: "invalidInput" };
  const parsed = fieldInputSchema.safeParse({
    dashboardId,
    fieldId,
    label: emptyToUndefined(formData.get("label")) ?? "",
    description: emptyToUndefined(formData.get("description")),
    fieldType: emptyToUndefined(formData.get("fieldType")) ?? "",
    required: formBool(formData, "required") ?? false,
    placeholder: emptyToUndefined(formData.get("placeholder")),
    options: formJson<string[]>(formData, "options") ?? [],
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.fieldType === "select" && parsed.data.options.length === 0) {
    return { ok: false, error: "invalidInput" };
  }

  const { error } = await supabase
    .from("project_dashboard_fields")
    .update({
      label: parsed.data.label,
      description: parsed.data.description,
      field_type: parsed.data.fieldType,
      required: parsed.data.required,
      placeholder: parsed.data.placeholder,
      options: parsed.data.options,
    })
    .eq("id", fieldId)
    .eq("university_id", profile.university_id);
  if (error) return { ok: false, error: mapWriteError(error.code) };
  revalidateProject(dashboardId);
  return { ok: true };
}

export async function deleteFieldAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const fieldId = formUuid(formData, "fieldId");
  const dashboardId = formUuid(formData, "dashboardId");
  if (!fieldId || !dashboardId) return { ok: false, error: "invalidInput" };

  const { data: field } = await supabase
    .from("project_dashboard_fields")
    .select("id, is_system")
    .eq("id", fieldId)
    .eq("university_id", profile.university_id)
    .maybeSingle();
  if (!field) return { ok: false, error: "notFound" };
  if (field.is_system) return { ok: false, error: "systemField" };

  // Soft delete keeps historical submissions resolvable.
  const { error } = await supabase
    .from("project_dashboard_fields")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fieldId);
  if (error) return { ok: false, error: mapWriteError(error.code) };
  revalidateProject(dashboardId);
  return { ok: true };
}

export async function toggleFieldAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const fieldId = formUuid(formData, "fieldId");
  const dashboardId = formUuid(formData, "dashboardId");
  const patch: { enabled?: boolean; required?: boolean } = {};
  const enabled = formBool(formData, "enabled");
  const required = formBool(formData, "required");
  if (enabled !== undefined) patch.enabled = enabled;
  if (required !== undefined) patch.required = required;
  if (!fieldId || !dashboardId || Object.keys(patch).length === 0) {
    return { ok: false, error: "invalidInput" };
  }
  const { error } = await supabase
    .from("project_dashboard_fields")
    .update(patch)
    .eq("id", fieldId)
    .eq("university_id", profile.university_id);
  if (error) return { ok: false, error: mapWriteError(error.code) };
  revalidateProject(dashboardId);
  return { ok: true };
}

export async function reorderFieldsAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };
  const dashboardId = formUuid(formData, "dashboardId");
  const order = formJson<string[]>(formData, "order");
  if (
    !dashboardId ||
    !Array.isArray(order) ||
    order.length === 0 ||
    order.length > 60 ||
    order.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
  ) {
    return { ok: false, error: "invalidInput" };
  }
  for (let index = 0; index < order.length; index += 1) {
    const { error } = await supabase
      .from("project_dashboard_fields")
      .update({ position: index })
      .eq("id", order[index])
      .eq("university_id", profile.university_id)
      .eq("dashboard_id", dashboardId);
    if (error) return { ok: false, error: mapWriteError(error.code) };
  }
  revalidateProject(dashboardId);
  return { ok: true };
}
