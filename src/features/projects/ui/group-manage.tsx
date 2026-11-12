"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addMembersAction,
  archiveGroupAction,
  createReviewAction,
  decideMemberRequestAction,
  deleteGroupAction,
  deleteLinkAction,
  deleteReviewAction,
  removeMemberAction,
  requestMemberChangeAction,
  setGroupStatusAction,
  setLeaderAction,
  submitProjectAction,
  transferMemberAction,
  updateReviewAction,
  upsertLinkAction,
} from "../actions";
import { GROUP_STATUSES, REVIEW_TYPES, type ActionResult } from "../contracts";
import { parseBulkMembers } from "../rules";

export type MemberRow = {
  id: string;
  name: string;
  reg_no: string;
  email: string | null;
  member_role: string;
  responsibilities: string;
};

export type LinkRow = { id: string; title: string; url: string; description: string };

export type ReviewRow = {
  id: string;
  review_type: string;
  review_status: string;
  general_comments: string;
  approval_explanation: string;
  rejection_reason: string;
  required_changes: string;
  suggestions: string;
  visibility: string;
  reviewer_name: string;
  is_edited: boolean;
  created_at: string;
  deleted_at: string | null;
};

export type RequestRow = {
  id: string;
  request_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  member_id: string | null;
  created_at: string;
};

export type GroupOption = { id: string; group_id: string };

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const chipClass =
  "inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
const dangerChipClass = `${chipClass} text-destructive`;

function useRunner(): {
  run: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
  result: ActionResult | null;
} {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const outcome = await fn();
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };
  return { run, pending, result };
}

function ErrorText({ result }: { result: ActionResult | null }) {
  const t = useTranslations("Projects.errors");
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="text-xs text-destructive" data-testid="group-action-error">
      {t(result.error)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** Members list with TA controls (remove, transfer, leader) + add flows. */
export function MembersManager({
  groupId,
  members,
  leaderMemberId,
  otherGroups,
}: {
  groupId: string;
  members: MemberRow[];
  leaderMemberId: string | null;
  otherGroups: GroupOption[];
}) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const bulk = parseBulkMembers(bulkText);

  return (
    <div className="grid gap-4" data-testid="members-manager">
      <ul className="grid gap-2">
        {members.map((member) => (
          <li
            key={member.id}
            className="rounded-xl border p-3"
            data-testid={`member-${member.reg_no}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {member.name}
                  {member.id === leaderMemberId ? (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {t("members.leader")}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {member.reg_no}
                  {member.email ? ` · ${member.email}` : ""}
                  {member.member_role && member.member_role !== "member"
                    ? ` · ${member.member_role}`
                    : ""}
                </p>
                {member.responsibilities ? (
                  <p className="text-xs text-muted-foreground">{member.responsibilities}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {member.id !== leaderMemberId ? (
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending}
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("groupId", groupId);
                      formData.set("memberId", member.id);
                      run(() => setLeaderAction(formData));
                    }}
                  >
                    {t("members.makeLeader")}
                  </button>
                ) : null}
                {otherGroups.length > 0 ? (
                  <select
                    aria-label={t("members.transferTo")}
                    className={`${inputClass} h-8 max-w-40 py-0 text-xs`}
                    defaultValue=""
                    disabled={pending}
                    onChange={(event) => {
                      const targetGroupId = event.target.value;
                      if (!targetGroupId) return;
                      const formData = new FormData();
                      formData.set("memberId", member.id);
                      formData.set("targetGroupId", targetGroupId);
                      run(() => transferMemberAction(formData));
                      event.target.value = "";
                    }}
                  >
                    <option value="">{t("members.transferTo")}</option>
                    {otherGroups.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.group_id}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className={dangerChipClass}
                  disabled={pending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("groupId", groupId);
                    formData.set("memberId", member.id);
                    run(() => removeMemberAction(formData));
                  }}
                >
                  {t("members.remove")}
                </button>
              </div>
            </div>
          </li>
        ))}
        {members.length === 0 ? (
          <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            {t("members.empty")}
          </li>
        ) : null}
      </ul>

      <form
        className="grid gap-3 rounded-xl border p-4"
        data-testid="add-member-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const payloadMembers =
            bulkOpen && bulk.members.length > 0
              ? bulk.members.map((entry) => ({
                  name: entry.name,
                  regNo: entry.regNo,
                  memberRole: "member",
                  responsibilities: "",
                }))
              : [
                  {
                    name: String(formData.get("name") ?? ""),
                    regNo: String(formData.get("regNo") ?? ""),
                    memberRole: String(formData.get("memberRole") ?? "member"),
                    responsibilities: String(formData.get("responsibilities") ?? ""),
                  },
                ];
          const payload = new FormData();
          payload.set("groupId", groupId);
          payload.set("members", JSON.stringify(payloadMembers));
          run(async () => {
            const outcome = await addMembersAction(payload);
            if (outcome.ok) setBulkText("");
            return outcome;
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("members.name")}</span>
            <input
              name="name"
              required
              maxLength={120}
              className={inputClass}
              data-testid="add-member-name"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("members.regNo")}</span>
            <input
              name="regNo"
              required
              maxLength={40}
              className={inputClass}
              data-testid="add-member-reg"
            />
          </label>
        </div>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("members.role")}</span>
          <input name="memberRole" maxLength={80} placeholder="member" className={inputClass} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("members.responsibilities")}</span>
          <input name="responsibilities" maxLength={500} className={inputClass} />
        </label>
        <BulkMembersFields
          bulkText={bulkText}
          setBulkText={setBulkText}
          bulk={bulk}
          open={bulkOpen}
          setOpen={setBulkOpen}
        />
        <div>
          <button type="submit" className={buttonClass} disabled={pending}>
            {t("members.add")}
          </button>
        </div>
        <ErrorText result={result} />
      </form>
    </div>
  );
}

/**
 * Shared bulk-paste block: a collapsible textarea with a live parsed preview
 * (prompt 3.2). The preview rows mirror what the RPC will validate.
 */
function BulkMembersFields({
  bulkText,
  setBulkText,
  bulk,
  open,
  setOpen,
}: {
  bulkText: string;
  setBulkText: (value: string) => void;
  bulk: ReturnType<typeof parseBulkMembers>;
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const t = useTranslations("Projects");
  return (
    <>
      <div>
        <button
          type="button"
          className={chipClass}
          onClick={() => setOpen(!open)}
          data-testid="bulk-members-toggle"
        >
          {open ? t("members.bulkHide") : t("members.bulkShow")}
        </button>
      </div>
      {open ? (
        <div className="grid gap-2">
          <textarea
            rows={4}
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            placeholder={t("members.bulkPlaceholder")}
            className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
            data-testid="bulk-members-input"
          />
          <div className="rounded-lg bg-muted/40 p-2 text-xs" data-testid="bulk-members-preview">
            <p className="font-medium">
              {t("members.bulkPreview", { count: bulk.members.length })}
            </p>
            <ul className="mt-1 grid gap-0.5">
              {bulk.members.map((member, index) => (
                <li key={`${member.regNo}-${index}`} className="font-mono">
                  {member.name} — {member.regNo}
                </li>
              ))}
            </ul>
            {bulk.errors.map((error) => (
              <p key={`${error.line}-${error.code}`} className="text-destructive">
                {t(`members.bulkErrors.${error.code}`, { line: error.line })}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Member change requests (TA decisions)
// ---------------------------------------------------------------------------

export function RequestsPanel({ requests }: { requests: RequestRow[] }) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const pendingRows = requests.filter((request) => request.status === "pending");
  const decidedRows = requests.filter((request) => request.status !== "pending");

  const decide = (requestId: string, approve: boolean) => {
    const formData = new FormData();
    formData.set("requestId", requestId);
    formData.set("approve", String(approve));
    run(() => decideMemberRequestAction(formData));
  };

  const label = (request: RequestRow): string => {
    if (request.request_type === "add") {
      const name = (request.payload?.name as string) ?? "";
      const regNo = (request.payload?.reg_no as string) ?? (request.payload?.regNo as string) ?? "";
      return `${t("requests.add")}: ${name} ${regNo}`.trim();
    }
    return t("requests.remove");
  };

  return (
    <div className="grid gap-3" data-testid="requests-panel">
      {pendingRows.map((request) => (
        <div
          key={request.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3"
        >
          <span className="text-sm">
            {label(request)} ·{" "}
            <span className="text-xs text-muted-foreground">{request.created_at}</span>
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              className={buttonClass}
              disabled={pending}
              onClick={() => decide(request.id, true)}
            >
              {t("requests.approve")}
            </button>
            <button
              type="button"
              className={dangerChipClass}
              disabled={pending}
              onClick={() => decide(request.id, false)}
            >
              {t("requests.reject")}
            </button>
          </div>
        </div>
      ))}
      {pendingRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("requests.none")}</p>
      ) : null}
      {decidedRows.length > 0 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {decidedRows.slice(0, 10).map((request) => (
            <li key={request.id}>
              {label(request)} — {t(`requests.${request.status}`)}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Review composer (approve/reject/request changes/general + visibility). */
export function ReviewComposer({ groupId }: { groupId: string }) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const [reviewType, setReviewType] = useState<string>("general");

  return (
    <form
      className="grid gap-3 rounded-xl border p-4"
      data-testid="review-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        run(async () => {
          const outcome = await createReviewAction(formData);
          if (outcome.ok) form.reset();
          return outcome;
        });
      }}
    >
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("reviews.type")}</span>
          <select
            name="reviewType"
            className={inputClass}
            value={reviewType}
            onChange={(event) => setReviewType(event.target.value)}
            data-testid="review-type"
          >
            {REVIEW_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`reviews.types.${type}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("reviews.visibility")}</span>
          <select
            name="visibility"
            className={inputClass}
            defaultValue="public"
            data-testid="review-visibility"
          >
            <option value="public">{t("reviews.public")}</option>
            <option value="private">{t("reviews.private")}</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("reviews.newStatus")}</span>
          <select
            name="newStatus"
            className={inputClass}
            defaultValue=""
            data-testid="review-status"
          >
            <option value="">{t("reviews.autoStatus")}</option>
            {GROUP_STATUSES.filter((value) => value !== "archived").map((value) => (
              <option key={value} value={value}>
                {t(`statuses.group.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("reviews.generalComments")}</span>
        <textarea
          name="generalComments"
          rows={3}
          maxLength={2000}
          className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("reviews.approvalExplanation")}</span>
        <textarea
          name="approvalExplanation"
          rows={2}
          maxLength={2000}
          className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      {reviewType === "reject" || reviewType === "request_changes" ? (
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">
            {reviewType === "reject" ? t("reviews.rejectionReason") : t("reviews.requiredChanges")}
            <span className="ml-1 text-destructive">*</span>
          </span>
          <textarea
            name={reviewType === "reject" ? "rejectionReason" : "requiredChanges"}
            required
            rows={3}
            maxLength={2000}
            className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            data-testid="review-required-text"
          />
        </label>
      ) : (
        <>
          <input type="hidden" name="rejectionReason" value="" />
          <input type="hidden" name="requiredChanges" value="" />
        </>
      )}
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("reviews.suggestions")}</span>
        <textarea
          name="suggestions"
          rows={2}
          maxLength={2000}
          className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <div>
        <button
          type="submit"
          className={buttonClass}
          disabled={pending}
          data-testid="review-submit"
        >
          {t("reviews.submit")}
        </button>
      </div>
      <ErrorText result={result} />
    </form>
  );
}

/** Review history (never overwritten): edit marks + soft-deleted trail. */
export function ReviewList({ groupId, reviews }: { groupId: string; reviews: ReviewRow[] }) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const [editingId, setEditingId] = useState<string | null>(null);
  const visible = reviews.filter((review) => review.deleted_at === null);
  const deleted = reviews.filter((review) => review.deleted_at !== null);

  return (
    <div className="grid gap-3" data-testid="review-list">
      {visible.map((review) => (
        <article
          key={review.id}
          className="rounded-xl border p-4"
          data-testid={`review-${review.review_type}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                {t(`reviews.types.${review.review_type}`)}
                {review.visibility === "private" ? (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("reviews.privateTag")}
                  </span>
                ) : null}
                {review.is_edited ? (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("reviews.edited")}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {review.reviewer_name} · {review.created_at}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className={chipClass}
                disabled={pending}
                onClick={() => setEditingId(editingId === review.id ? null : review.id)}
              >
                {t("reviews.edit")}
              </button>
              <button
                type="button"
                className={dangerChipClass}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(t("reviews.deleteConfirm"))) return;
                  const formData = new FormData();
                  formData.set("reviewId", review.id);
                  formData.set("groupId", groupId);
                  run(() => deleteReviewAction(formData));
                }}
              >
                {t("reviews.delete")}
              </button>
            </div>
          </div>
          <dl className="mt-2 grid gap-1 text-sm">
            <ReviewField label={t("reviews.generalComments")} value={review.general_comments} />
            <ReviewField
              label={t("reviews.approvalExplanation")}
              value={review.approval_explanation}
            />
            <ReviewField label={t("reviews.rejectionReason")} value={review.rejection_reason} />
            <ReviewField label={t("reviews.requiredChanges")} value={review.required_changes} />
            <ReviewField label={t("reviews.suggestions")} value={review.suggestions} />
          </dl>
          {editingId === review.id ? (
            <form
              className="mt-3 grid gap-3 rounded-lg border bg-muted/20 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                formData.set("reviewId", review.id);
                formData.set("groupId", groupId);
                run(async () => {
                  const outcome = await updateReviewAction(formData);
                  if (outcome.ok) setEditingId(null);
                  return outcome;
                });
              }}
            >
              <textarea
                name="generalComments"
                rows={2}
                maxLength={2000}
                defaultValue={review.general_comments}
                className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <textarea
                name="approvalExplanation"
                rows={2}
                maxLength={2000}
                defaultValue={review.approval_explanation}
                className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              {review.review_type === "reject" ? (
                <textarea
                  name="rejectionReason"
                  required
                  rows={2}
                  maxLength={2000}
                  defaultValue={review.rejection_reason}
                  className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              ) : (
                <input type="hidden" name="rejectionReason" value="" />
              )}
              {review.review_type === "request_changes" ? (
                <textarea
                  name="requiredChanges"
                  required
                  rows={2}
                  maxLength={2000}
                  defaultValue={review.required_changes}
                  className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              ) : (
                <input type="hidden" name="requiredChanges" value="" />
              )}
              <textarea
                name="suggestions"
                rows={2}
                maxLength={2000}
                defaultValue={review.suggestions}
                className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <select name="visibility" className={inputClass} defaultValue={review.visibility}>
                <option value="public">{t("reviews.public")}</option>
                <option value="private">{t("reviews.private")}</option>
              </select>
              <div className="flex gap-2">
                <button type="submit" className={buttonClass} disabled={pending}>
                  {t("saveChanges")}
                </button>
                <button type="button" className={chipClass} onClick={() => setEditingId(null)}>
                  {t("builder.cancel")}
                </button>
              </div>
            </form>
          ) : null}
        </article>
      ))}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reviews.none")}</p>
      ) : null}
      {deleted.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("reviews.deletedCount", { count: deleted.length })}
        </p>
      ) : null}
      <ErrorText result={result} />
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid sm:grid-cols-[160px_1fr] gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status + lifecycle controls
// ---------------------------------------------------------------------------

export function GroupStatusControl({ groupId, status }: { groupId: string; status: string }) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="group-status-control">
      <select
        aria-label={t("group.setStatus")}
        className={`${inputClass} max-w-48`}
        value={status}
        disabled={pending}
        onChange={(event) => {
          const formData = new FormData();
          formData.set("groupId", groupId);
          formData.set("status", event.target.value);
          run(() => setGroupStatusAction(formData));
        }}
      >
        {GROUP_STATUSES.filter((value) => value !== "archived").map((value) => (
          <option key={value} value={value}>
            {t(`statuses.group.${value}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={chipClass}
        disabled={pending || status === "archived"}
        onClick={() => {
          const formData = new FormData();
          formData.set("groupId", groupId);
          run(() => archiveGroupAction(formData));
        }}
      >
        {t("group.archive")}
      </button>
      <button
        type="button"
        className={dangerChipClass}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(t("group.deleteConfirm"))) return;
          const formData = new FormData();
          formData.set("groupId", groupId);
          run(() => deleteGroupAction(formData));
        }}
      >
        {t("group.delete")}
      </button>
      <ErrorText result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links (shared by TA and student)
// ---------------------------------------------------------------------------

export function LinksManager({
  groupId,
  links,
  editable,
}: {
  groupId: string;
  links: LinkRow[];
  editable: boolean;
}) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="grid gap-3" data-testid="links-manager">
      <ul className="grid gap-2">
        {links.map((link) => (
          <li key={link.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {link.title}
                </a>
                <p className="truncate text-xs text-muted-foreground">{link.url}</p>
                {link.description ? (
                  <p className="text-xs text-muted-foreground">{link.description}</p>
                ) : null}
              </div>
              {editable ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={chipClass}
                    onClick={() => setEditingId(editingId === link.id ? null : link.id)}
                  >
                    {t("links.edit")}
                  </button>
                  <button
                    type="button"
                    className={dangerChipClass}
                    disabled={pending}
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("groupId", groupId);
                      formData.set("linkId", link.id);
                      run(() => deleteLinkAction(formData));
                    }}
                  >
                    {t("links.delete")}
                  </button>
                </div>
              ) : null}
            </div>
            {editingId === link.id && editable ? (
              <form
                className="mt-3 grid gap-2 rounded-lg border bg-muted/20 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  formData.set("groupId", groupId);
                  formData.set("linkId", link.id);
                  run(async () => {
                    const outcome = await upsertLinkAction(formData);
                    if (outcome.ok) setEditingId(null);
                    return outcome;
                  });
                }}
              >
                <input
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={link.title}
                  className={inputClass}
                />
                <input
                  name="url"
                  required
                  maxLength={500}
                  defaultValue={link.url}
                  className={inputClass}
                />
                <input
                  name="description"
                  maxLength={300}
                  defaultValue={link.description}
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <button type="submit" className={buttonClass} disabled={pending}>
                    {t("saveChanges")}
                  </button>
                  <button type="button" className={chipClass} onClick={() => setEditingId(null)}>
                    {t("builder.cancel")}
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
        {links.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t("links.empty")}</li>
        ) : null}
      </ul>

      {editable ? (
        <form
          className="grid gap-2 rounded-xl border p-4"
          data-testid="add-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            run(async () => {
              const outcome = await upsertLinkAction(formData);
              if (outcome.ok) form.reset();
              return outcome;
            });
          }}
        >
          <input type="hidden" name="groupId" value={groupId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              name="title"
              required
              maxLength={120}
              placeholder={t("links.title")}
              className={inputClass}
              data-testid="link-title"
            />
            <input
              name="url"
              required
              maxLength={500}
              placeholder="https://…"
              className={inputClass}
              data-testid="link-url"
            />
          </div>
          <input
            name="description"
            maxLength={300}
            placeholder={t("links.description")}
            className={inputClass}
          />
          <div>
            <button type="submit" className={buttonClass} disabled={pending} data-testid="link-add">
              {t("links.add")}
            </button>
          </div>
        </form>
      ) : null}
      <ErrorText result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student submit (dynamic form from the dashboard's enabled fields)
// ---------------------------------------------------------------------------

export type SubmitField = {
  id: string;
  label: string;
  description: string;
  field_type: string;
  required: boolean;
  placeholder: string;
  options: string[];
};

/** Student submission composer: renders enabled fields + links editor. */
export function SubmissionForm({
  groupId,
  fields,
  existing,
  links,
}: {
  groupId: string;
  fields: SubmitField[];
  existing: Record<string, string>;
  links: LinkRow[];
}) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();

  return (
    <form
      className="grid gap-4"
      data-testid="submission-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const responses: Record<string, string> = {};
        for (const field of fields) {
          const value = formData.get(`response-${field.id}`);
          if (typeof value === "string") responses[field.id] = value;
        }
        const linkInputs = formData.getAll("link-title") as string[];
        const linkUrls = formData.getAll("link-url") as string[];
        const linkDescriptions = formData.getAll("link-description") as string[];
        const payload = new FormData();
        payload.set("groupId", groupId);
        payload.set("responses", JSON.stringify(responses));
        payload.set(
          "links",
          JSON.stringify(
            linkUrls
              .map((url, index) => ({
                title: (linkInputs[index] ?? "").trim(),
                url: url.trim(),
                description: (linkDescriptions[index] ?? "").trim(),
              }))
              .filter((link) => link.url.length > 0 || link.title.length > 0),
          ),
        );
        run(() => submitProjectAction(payload));
      }}
    >
      {fields.map((field) => (
        <label key={field.id} className="grid gap-1.5">
          <span className="text-sm font-medium">
            {field.label}
            {field.required ? <span className="ml-1 text-destructive">*</span> : null}
          </span>
          {field.description ? (
            <span className="text-xs text-muted-foreground">{field.description}</span>
          ) : null}
          {field.field_type === "long_text" ? (
            <textarea
              name={`response-${field.id}`}
              rows={3}
              maxLength={2000}
              required={field.required}
              placeholder={field.placeholder}
              defaultValue={existing[field.id] ?? ""}
              className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              data-testid={`response-${field.field_type}`}
            />
          ) : field.field_type === "select" ? (
            <select
              name={`response-${field.id}`}
              required={field.required}
              defaultValue={existing[field.id] ?? ""}
              className={inputClass}
            >
              <option value="">{t("selectPlaceholder")}</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={
                field.field_type === "number"
                  ? "number"
                  : field.field_type === "url"
                    ? "url"
                    : "text"
              }
              name={`response-${field.id}`}
              required={field.required}
              maxLength={field.field_type === "url" ? 500 : 200}
              placeholder={field.placeholder}
              defaultValue={existing[field.id] ?? ""}
              className={inputClass}
              data-testid={`response-${field.field_type}`}
            />
          )}
        </label>
      ))}

      <div className="grid gap-2 rounded-xl border p-4">
        <p className="text-sm font-semibold">{t("links.heading")}</p>
        {links.map((link) => (
          <p key={link.id} className="text-xs text-muted-foreground">
            {t("links.existing", { title: link.title, url: link.url })}
          </p>
        ))}
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
            <input
              name="link-title"
              maxLength={120}
              placeholder={t("links.title")}
              className={inputClass}
            />
            <input name="link-url" maxLength={500} placeholder="https://…" className={inputClass} />
            <input
              name="link-description"
              maxLength={300}
              placeholder={t("links.description")}
              className={inputClass}
            />
          </div>
        ))}
      </div>

      <div>
        <button
          type="submit"
          className={buttonClass}
          disabled={pending}
          data-testid="submission-submit"
        >
          {pending ? t("saving") : t("submission.submit")}
        </button>
      </div>
      <ErrorText result={result} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Student member-change requests
// ---------------------------------------------------------------------------

export function StudentMemberControls({
  groupId,
  state,
  members,
  leaderMemberId,
}: {
  groupId: string;
  state: "direct" | "approval" | "locked";
  members: MemberRow[];
  leaderMemberId: string | null;
}) {
  const t = useTranslations("Projects");
  const { run, pending, result } = useRunner();
  const [addOpen, setAddOpen] = useState(false);

  if (state === "locked") {
    return <p className="text-sm text-muted-foreground">{t("members.locked")}</p>;
  }

  return (
    <div className="grid gap-3" data-testid="student-member-controls">
      {state === "approval" ? (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-warning-foreground">
          {t("members.approvalNotice")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className={chipClass} onClick={() => setAddOpen((value) => !value)}>
          {addOpen ? t("members.cancelAdd") : t("members.requestAdd")}
        </button>
      </div>
      {addOpen ? (
        <form
          className="grid gap-2 rounded-xl border p-3"
          data-testid="request-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const member = {
              name: String(formData.get("name") ?? ""),
              regNo: String(formData.get("regNo") ?? ""),
              memberRole: String(formData.get("memberRole") ?? "member"),
              responsibilities: String(formData.get("responsibilities") ?? ""),
            };
            const payload = new FormData();
            payload.set("groupId", groupId);
            payload.set("requestType", "add");
            payload.set("member", JSON.stringify(member));
            run(() => requestMemberChangeAction(payload));
          }}
        >
          <input type="hidden" name="groupId" value={groupId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              name="name"
              required
              maxLength={120}
              placeholder={t("members.name")}
              className={inputClass}
            />
            <input
              name="regNo"
              required
              maxLength={40}
              placeholder={t("members.regNo")}
              className={inputClass}
            />
          </div>
          <input
            name="memberRole"
            maxLength={80}
            placeholder={t("members.role")}
            className={inputClass}
          />
          <input
            name="responsibilities"
            maxLength={500}
            placeholder={t("members.responsibilities")}
            className={inputClass}
          />
          <div>
            <button type="submit" className={buttonClass} disabled={pending}>
              {t("members.sendRequest")}
            </button>
          </div>
        </form>
      ) : null}
      {state === "approval" ? (
        <p className="text-xs text-muted-foreground">{t("members.removeViaRequest")}</p>
      ) : (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("members.removeMember")}
          </span>
          <select
            aria-label={t("members.removeMember")}
            className={`${inputClass} max-w-64`}
            defaultValue=""
            disabled={pending}
            onChange={(event) => {
              const memberId = event.target.value;
              if (!memberId) return;
              const formData = new FormData();
              formData.set("groupId", groupId);
              formData.set("memberId", memberId);
              run(() => removeMemberAction(formData));
              event.target.value = "";
            }}
          >
            <option value="">{t("members.selectRemove")}</option>
            {members
              .filter((member) => member.id !== leaderMemberId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} — {member.reg_no}
                </option>
              ))}
          </select>
        </div>
      )}
      <ErrorText result={result} />
    </div>
  );
}
