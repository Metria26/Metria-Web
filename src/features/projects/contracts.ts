import { z } from "zod";

/**
 * Zod contracts for the Projects & Group Management module (owner request
 * 2026-11-11). FormData arrives as strings — coerce before checks. Messages
 * are i18n keys; raw Postgres details never reach the client.
 */

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export const DASHBOARD_STATUSES = ["draft", "published", "closed", "archived"] as const;
export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

export const GROUP_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "revision_required",
  "approved",
  "in_progress",
  "completed",
  "rejected",
  "archived",
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const SUBMISSION_STATUSES = ["not_submitted", "submitted", "resubmitted", "late"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const FIELD_TYPES = ["short_text", "long_text", "url", "number", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const REVIEW_TYPES = ["approve", "reject", "request_changes", "general"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_STATUSES = ["approved", "rejected", "revision_required", "unchanged"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const MEMBER_REQUEST_TYPES = ["add", "remove"] as const;
export type MemberRequestType = (typeof MEMBER_REQUEST_TYPES)[number];

/** TA-configured Group ID prefix (registry: group_id_prefix). */
const groupIdPrefixSchema = z
  .string()
  .trim()
  .max(32, "prefixMax")
  .refine((value) => value === "" || /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value), "prefixFormat");

export const dashboardInputSchema = z
  .object({
    offeringId: z.string().uuid("offeringRequired"),
    sectionId: z.string().uuid("sectionRequired").optional().or(z.literal("")),
    title: z.string().trim().min(3, "titleMin").max(160, "titleMax"),
    description: z.string().max(4000, "descriptionMax").optional().default(""),
    instructions: z.string().max(4000, "instructionsMax").optional().default(""),
    opensAt: z.string().optional().or(z.literal("")),
    deadlineAt: z.string().optional().or(z.literal("")),
    lateAllowed: z.coerce.boolean().optional().default(false),
    allowEditAfterSubmission: z.coerce.boolean().optional().default(false),
    allowMemberChangesAfterSubmission: z.coerce.boolean().optional().default(false),
    requireMemberChangeApproval: z.coerce.boolean().optional().default(false),
    allowIndividual: z.coerce.boolean().optional().default(false),
    allowStudentGroups: z.coerce.boolean().optional().default(true),
    minMembers: z.coerce.number().int("sizeInteger").min(1, "sizeMin").max(99, "sizeMax"),
    maxMembers: z.coerce.number().int("sizeInteger").min(1, "sizeMin").max(99, "sizeMax"),
    groupIdPrefix: groupIdPrefixSchema,
  })
  .refine((value) => value.maxMembers >= value.minMembers, {
    message: "maxBelowMin",
    path: ["maxMembers"],
  })
  .refine(
    (value) =>
      !value.opensAt || !value.deadlineAt || new Date(value.deadlineAt) > new Date(value.opensAt),
    { message: "deadlineBeforeOpen", path: ["deadlineAt"] },
  );
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

/** Update schema: dashboard identity fields (offering/section/dates) are not editable. */
export const dashboardUpdateSchema = z
  .object({
    title: z.string().trim().min(3, "titleMin").max(160, "titleMax"),
    description: z.string().max(4000, "descriptionMax").optional().default(""),
    instructions: z.string().max(4000, "instructionsMax").optional().default(""),
    lateAllowed: z.coerce.boolean().optional().default(false),
    allowEditAfterSubmission: z.coerce.boolean().optional().default(false),
    allowMemberChangesAfterSubmission: z.coerce.boolean().optional().default(false),
    requireMemberChangeApproval: z.coerce.boolean().optional().default(false),
    allowIndividual: z.coerce.boolean().optional().default(false),
    allowStudentGroups: z.coerce.boolean().optional().default(true),
    minMembers: z.coerce.number().int("sizeInteger").min(1, "sizeMin").max(99, "sizeMax"),
    maxMembers: z.coerce.number().int("sizeInteger").min(1, "sizeMin").max(99, "sizeMax"),
    groupIdPrefix: groupIdPrefixSchema,
  })
  .refine((value) => value.maxMembers >= value.minMembers, {
    message: "maxBelowMin",
    path: ["maxMembers"],
  });
export type DashboardUpdateInput = z.infer<typeof dashboardUpdateSchema>;

export const fieldInputSchema = z.object({
  dashboardId: z.string().uuid("dashboardRequired"),
  fieldId: z.string().uuid("fieldRequired").optional().or(z.literal("")),
  label: z.string().trim().min(1, "labelRequired").max(120, "labelMax"),
  description: z.string().max(500, "descriptionMax").optional().default(""),
  fieldType: z.enum(FIELD_TYPES, { message: "fieldTypeRequired" }),
  required: z.coerce.boolean().optional().default(false),
  placeholder: z.string().max(120, "placeholderMax").optional().default(""),
  options: z.array(z.string().trim().min(1).max(120)).max(30).optional().default([]),
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const memberInputSchema = z.object({
  /** Section roster id; when present the RPC derives name/roll number itself. */
  profileId: z.string().uuid("studentRequired").optional(),
  name: z.string().trim().min(1, "nameRequired").max(120, "nameMax"),
  regNo: z.string().trim().min(1, "regRequired").max(40, "regMax"),
  memberRole: z.string().trim().max(80, "roleMax").optional().default("member"),
  responsibilities: z.string().trim().max(500, "responsibilitiesMax").optional().default(""),
});
export type MemberInput = z.infer<typeof memberInputSchema>;

/** Roster row returned by `list_project_eligible_students`. */
export type EligibleStudent = {
  profile_id: string;
  display_name: string;
  roll_no: string;
  email: string | null;
};

export const createGroupInputSchema = z.object({
  dashboardId: z.string().uuid("dashboardRequired"),
  groupId: z.string().trim().max(40, "groupMax").optional().or(z.literal("")),
  projectTitle: z.string().trim().min(3, "titleMin").max(160, "titleMax"),
  members: z.array(memberInputSchema).min(1, "membersRequired").max(50, "membersMax"),
});
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export const submitProjectInputSchema = z.object({
  groupId: z.string().uuid("groupRequired"),
  responses: z.record(z.string(), z.string().max(2000, "responseMax")),
  links: z
    .array(
      z.object({
        title: z.string().trim().min(1, "linkTitleRequired").max(120, "linkTitleMax"),
        url: z.string().trim().max(500, "urlMax").refine(isHttpUrl, "urlInvalid"),
        description: z.string().max(300, "linkDescriptionMax").optional().default(""),
      }),
    )
    .max(20, "linksMax")
    .optional()
    .default([]),
});
export type SubmitProjectInput = z.infer<typeof submitProjectInputSchema>;

export const reviewInputSchema = z
  .object({
    groupId: z.string().uuid("groupRequired"),
    reviewType: z.enum(REVIEW_TYPES, { message: "reviewTypeRequired" }),
    generalComments: z.string().max(2000, "commentsMax").optional().default(""),
    approvalExplanation: z.string().max(2000, "commentsMax").optional().default(""),
    rejectionReason: z.string().max(2000, "commentsMax").optional().default(""),
    requiredChanges: z.string().max(2000, "commentsMax").optional().default(""),
    suggestions: z.string().max(2000, "commentsMax").optional().default(""),
    visibility: z.enum(["public", "private"]).optional().default("public"),
    newStatus: z
      .enum(
        GROUP_STATUSES.filter((status) => status !== "archived") as [GroupStatus, ...GroupStatus[]],
      )
      .optional()
      .or(z.literal("")),
  })
  .refine((value) => value.reviewType !== "reject" || value.rejectionReason.trim().length > 0, {
    message: "rejectionReasonRequired",
    path: ["rejectionReason"],
  })
  .refine(
    (value) => value.reviewType !== "request_changes" || value.requiredChanges.trim().length > 0,
    {
      message: "requiredChangesRequired",
      path: ["requiredChanges"],
    },
  );
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewUpdateInputSchema = z.object({
  reviewId: z.string().uuid("reviewRequired"),
  generalComments: z.string().max(2000, "commentsMax").optional().default(""),
  approvalExplanation: z.string().max(2000, "commentsMax").optional().default(""),
  rejectionReason: z.string().max(2000, "commentsMax").optional().default(""),
  requiredChanges: z.string().max(2000, "commentsMax").optional().default(""),
  suggestions: z.string().max(2000, "commentsMax").optional().default(""),
  visibility: z.enum(["public", "private"]).optional(),
});
export type ReviewUpdateInput = z.infer<typeof reviewUpdateInputSchema>;

/** Safe http(s) URL check shared by client preview and server RPC. */
export function isHttpUrl(value: string): boolean {
  if (value.length > 500) return false;
  return /^https?:\/\/\S+$/i.test(value.trim());
}
