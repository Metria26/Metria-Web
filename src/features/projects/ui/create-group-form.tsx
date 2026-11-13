"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createGroupAction } from "../actions";
import { type ActionResult, type EligibleStudent } from "../contracts";
import { MemberPicker } from "./member-picker";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

/**
 * Student group creation: the creator is always the leader and every other
 * member comes from the dashboard section's roster (no typed name/roll number).
 * The Group ID is issued server-side from the TA-configured prefix.
 */
export function CreateGroupForm({
  dashboardId,
  self,
  students,
  minMembers,
  maxMembers,
}: {
  dashboardId: string;
  self: { profileId: string; name: string; regNo: string };
  students: EligibleStudent[];
  minMembers: number;
  maxMembers: number;
}) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const memberCount = selectedIds.length + 1;
  const belowMinimum = memberCount < minMembers;

  return (
    <form
      className="grid gap-4"
      data-testid="create-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const members = [
          {
            profileId: self.profileId,
            name: self.name,
            regNo: self.regNo,
            memberRole: "leader",
            responsibilities: "",
          },
          ...selectedIds.flatMap((profileId) => {
            const student = students.find((entry) => entry.profile_id === profileId);
            if (!student) return [];
            return [
              {
                profileId: student.profile_id,
                name: student.display_name,
                regNo: student.roll_no,
                memberRole: "member",
                responsibilities: "",
              },
            ];
          }),
        ];
        const payload = new FormData();
        payload.set("dashboardId", dashboardId);
        payload.set("projectTitle", String(formData.get("projectTitle") ?? "").trim());
        payload.set("members", JSON.stringify(members));
        startTransition(async () => {
          const outcome = await createGroupAction(payload);
          setResult(outcome);
          if (outcome.ok && outcome.id) {
            router.push(`/app/projects/${dashboardId}/my-group`);
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

      <div className="rounded-xl border bg-muted/30 p-4 text-sm">
        <p className="font-semibold">{t("createGroup.leader")}</p>
        <p className="text-xs text-muted-foreground">
          {self.name} — {self.regNo}
        </p>
      </div>

      <MemberPicker
        students={students}
        selectedIds={selectedIds}
        label={t("createGroup.teammates")}
        disabled={pending}
        onAdd={(student) => setSelectedIds((ids) => [...ids, student.profile_id])}
        onRemove={(profileId) => setSelectedIds((ids) => ids.filter((id) => id !== profileId))}
      />

      <p className="text-xs text-muted-foreground" data-testid="create-group-count">
        {t("createGroup.memberCount", { count: memberCount, max: maxMembers })}
        {belowMinimum ? ` — ${t("createGroup.belowMinimum", { min: minMembers })}` : ""}
      </p>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-destructive" data-testid="create-group-error">
          {t(`errors.${result.error}`)}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          className={buttonClass}
          disabled={pending || belowMinimum}
          data-testid="create-group-submit"
        >
          {pending ? t("saving") : t("createGroup.submit")}
        </button>
      </div>
    </form>
  );
}
