"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createDashboardAction, updateDashboardAction } from "../actions";
import { type ActionResult } from "../contracts";

type SelectOption = { id: string; label: string };
type SectionOption = SelectOption & { offeringId: string };

export type DashboardFormDefaults = {
  title: string;
  description: string;
  instructions: string;
  opensAt: string;
  deadlineAt: string;
  lateAllowed: boolean;
  allowEditAfterSubmission: boolean;
  allowMemberChangesAfterSubmission: boolean;
  requireMemberChangeApproval: boolean;
  allowIndividual: boolean;
  allowStudentGroups: boolean;
  minMembers: number;
  maxMembers: number;
  groupIdPrefix: string;
};

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "text-sm font-medium";
const buttonClass =
  "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const checkClass =
  "inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm";

function ErrorBox({ state }: { state: ActionResult | null }) {
  const t = useTranslations("Projects.errors");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid="dashboard-form-error" className="text-sm text-destructive">
      {t(state.error)}
    </p>
  );
}

/**
 * Create/edit form for a project dashboard (prompt 1.1): title, course
 * binding, dates, deadline rules, group rules and the Group ID prefix.
 */
export function DashboardForm({
  offerings,
  sections,
  defaults,
  mode,
  dashboardId,
}: {
  offerings: SelectOption[];
  sections: SectionOption[];
  defaults?: DashboardFormDefaults;
  mode: "create" | "edit";
  dashboardId?: string;
}) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const result =
        mode === "create"
          ? await createDashboardAction(formData)
          : await updateDashboardAction(formData);
      if (result.ok && mode === "create" && result.id) {
        router.push(`/app/projects/${result.id}`);
      }
      return result;
    },
    null,
  );
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const sectionOptions = sections.filter((section) => section.offeringId === offeringId);

  useEffect(() => {
    if (state?.ok && mode === "edit") router.refresh();
  }, [state, mode, router]);

  return (
    <form action={formAction} className="grid gap-4" data-testid="dashboard-form">
      {mode === "edit" && dashboardId ? (
        <input type="hidden" name="dashboardId" value={dashboardId} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.offering")}</span>
          <select
            name="offeringId"
            required
            disabled={mode === "edit"}
            value={offeringId}
            onChange={(event) => setOfferingId(event.target.value)}
            className={fieldClass}
            data-testid="dashboard-offering"
          >
            <option value="" disabled>
              {t("selectPlaceholder")}
            </option>
            {offerings.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.section")}</span>
          <select
            name="sectionId"
            disabled={mode === "edit"}
            defaultValue=""
            className={fieldClass}
            data-testid="dashboard-section"
          >
            <option value="">{t("allSections")}</option>
            {sectionOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.title")}</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={defaults?.title}
          className={fieldClass}
          data-testid="dashboard-title"
        />
      </label>

      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.description")}</span>
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={defaults?.description}
          className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="dashboard-description"
        />
      </label>

      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.instructions")}</span>
        <textarea
          name="instructions"
          rows={4}
          maxLength={4000}
          defaultValue={defaults?.instructions}
          className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="dashboard-instructions"
        />
      </label>

      <fieldset className="grid gap-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">{t("deadlinesHeading")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={labelClass}>{t("fields.opensAt")}</span>
            <input
              type="datetime-local"
              name="opensAt"
              defaultValue={defaults?.opensAt}
              className={fieldClass}
              data-testid="dashboard-opens"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>{t("fields.deadlineAt")}</span>
            <input
              type="datetime-local"
              name="deadlineAt"
              defaultValue={defaults?.deadlineAt}
              className={fieldClass}
              data-testid="dashboard-deadline"
            />
          </label>
        </div>
        <label className={checkClass}>
          <input type="checkbox" name="lateAllowed" defaultChecked={defaults?.lateAllowed} />
          {t("fields.lateAllowed")}
        </label>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">{t("groupsHeading")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className={labelClass}>{t("fields.minMembers")}</span>
            <input
              type="number"
              name="minMembers"
              min={1}
              max={99}
              defaultValue={defaults?.minMembers ?? 2}
              required
              className={fieldClass}
              data-testid="dashboard-min-members"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>{t("fields.maxMembers")}</span>
            <input
              type="number"
              name="maxMembers"
              min={1}
              max={99}
              defaultValue={defaults?.maxMembers ?? 5}
              required
              className={fieldClass}
              data-testid="dashboard-max-members"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>{t("fields.groupIdPrefix")}</span>
            <input
              name="groupIdPrefix"
              maxLength={32}
              placeholder="COAL_P1"
              defaultValue={defaults?.groupIdPrefix}
              className={fieldClass}
              data-testid="dashboard-prefix"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("prefixHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={checkClass}>
            <input
              type="checkbox"
              name="allowIndividual"
              defaultChecked={defaults?.allowIndividual}
            />
            {t("fields.allowIndividual")}
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              name="allowStudentGroups"
              defaultChecked={defaults?.allowStudentGroups ?? true}
            />
            {t("fields.allowStudentGroups")}
          </label>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">{t("rulesHeading")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={checkClass}>
            <input
              type="checkbox"
              name="allowEditAfterSubmission"
              defaultChecked={defaults?.allowEditAfterSubmission}
            />
            {t("fields.allowEditAfterSubmission")}
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              name="allowMemberChangesAfterSubmission"
              defaultChecked={defaults?.allowMemberChangesAfterSubmission}
            />
            {t("fields.allowMemberChangesAfterSubmission")}
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              name="requireMemberChangeApproval"
              defaultChecked={defaults?.requireMemberChangeApproval}
            />
            {t("fields.requireMemberChangeApproval")}
          </label>
        </div>
      </fieldset>

      <ErrorBox state={state} />
      {state?.ok && mode === "edit" ? (
        <p className="text-sm text-muted-foreground" data-testid="dashboard-form-success">
          {t("saved")}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass}
          data-testid="dashboard-submit"
        >
          {pending ? t("saving") : mode === "create" ? t("createDashboard") : t("saveChanges")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t("fieldTypesHint")}</p>
    </form>
  );
}
