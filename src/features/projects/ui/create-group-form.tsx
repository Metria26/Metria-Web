"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createGroupAction } from "../actions";
import { type ActionResult } from "../contracts";
import { parseBulkMembers } from "../rules";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const chipClass =
  "inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Group creation form. Students: creator is automatically the leader and the
 * Group ID is issued server-side (TA prefix + sequential counter) — students
 * never pick it. Staff (TA): manual Group ID allowed and no auto-leader (the
 * first listed member becomes leader server-side).
 */
export function CreateGroupForm({
  dashboardId,
  selfName,
  selfRegNo,
  showGroupId = false,
  staff = false,
}: {
  dashboardId: string;
  selfName?: string;
  selfRegNo?: string;
  showGroupId?: boolean;
  staff?: boolean;
}) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const bulk = parseBulkMembers(bulkText);

  return (
    <form
      className="grid gap-4"
      data-testid="create-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const projectTitle = String(formData.get("projectTitle") ?? "").trim();
        const teammates =
          bulkOpen && bulk.members.length > 0
            ? bulk.members.map((entry) => ({
                name: entry.name,
                regNo: entry.regNo,
                memberRole: "member",
                responsibilities: "",
              }))
            : [
                {
                  name: String(formData.get("name") ?? "").trim(),
                  regNo: String(formData.get("regNo") ?? "").trim(),
                  memberRole: "member",
                  responsibilities: "",
                },
              ].filter((member) => member.name.length > 0 && member.regNo.length > 0);
        const payload = new FormData();
        payload.set("dashboardId", dashboardId);
        payload.set("projectTitle", projectTitle);
        if (showGroupId) {
          const manualId = String(formData.get("groupId") ?? "").trim();
          if (manualId.length > 0) payload.set("groupId", manualId);
        }
        const leader = staff
          ? []
          : [
              {
                name: selfName ?? "",
                regNo: selfRegNo ?? "",
                memberRole: "leader",
                responsibilities: "",
              },
            ];
        payload.set("members", JSON.stringify([...leader, ...teammates]));
        startTransition(async () => {
          const outcome = await createGroupAction(payload);
          setResult(outcome);
          if (outcome.ok && outcome.id) {
            router.push(
              staff
                ? `/app/projects/${dashboardId}/groups/${outcome.id}`
                : `/app/projects/${dashboardId}/my-group`,
            );
          }
        });
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("createGroup.title")}</span>
        <input
          name="projectTitle"
          required
          minLength={3}
          maxLength={160}
          className={inputClass}
          data-testid="create-group-title"
        />
      </label>

      {showGroupId ? (
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("createGroup.groupId")}</span>
          <input
            name="groupId"
            maxLength={40}
            placeholder={t("createGroup.groupIdHint")}
            className={inputClass}
            data-testid="create-group-id"
          />
        </label>
      ) : null}

      {selfName ? (
        <div className="rounded-xl border p-4 text-sm">
          <p className="font-semibold">{t("createGroup.leader")}</p>
          <p className="text-xs text-muted-foreground">
            {selfName} — {selfRegNo}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border p-4">
        <p className="text-sm font-semibold">
          {staff ? t("createGroup.membersStaff") : t("createGroup.teammates")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("members.name")}</span>
            <input
              name="name"
              maxLength={120}
              className={inputClass}
              data-testid="create-group-name"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("members.regNo")}</span>
            <input
              name="regNo"
              maxLength={40}
              className={inputClass}
              data-testid="create-group-reg"
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            className={chipClass}
            onClick={() => setBulkOpen((value) => !value)}
          >
            {bulkOpen ? t("members.bulkHide") : t("members.bulkShow")}
          </button>
        </div>
        {bulkOpen ? (
          <div className="grid gap-2">
            <textarea
              rows={4}
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={t("members.bulkPlaceholder")}
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
              data-testid="create-group-bulk"
            />
            <div className="rounded-lg bg-muted/40 p-2 text-xs" data-testid="create-group-preview">
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
      </div>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-destructive" data-testid="create-group-error">
          {t(`errors.${result.error}`)}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          className={buttonClass}
          disabled={pending}
          data-testid="create-group-submit"
        >
          {pending ? t("saving") : t("createGroup.submit")}
        </button>
      </div>
    </form>
  );
}
