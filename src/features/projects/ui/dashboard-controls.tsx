"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  deleteDashboardAction,
  duplicateDashboardAction,
  nextGroupIdAction,
  setDashboardStatusAction,
  setDeadlineAction,
} from "../actions";
import { type ActionResult } from "../contracts";
import { toUniversityDateTimeInput } from "@/lib/time-format";

const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const chipClass =
  "inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
const dangerChipClass = `${chipClass} text-destructive`;
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

/** TA lifecycle controls for one dashboard (prompt 1.2/1.3). */
export function DashboardControls({
  dashboardId,
  status,
  opensAt,
  deadlineAt,
}: {
  dashboardId: string;
  status: string;
  opensAt: string | null;
  deadlineAt: string | null;
}) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const outcome = await fn();
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  const withDashboardId = () => {
    const formData = new FormData();
    formData.set("dashboardId", dashboardId);
    return formData;
  };

  const setStatus = (next: string) => {
    const formData = new FormData();
    formData.set("dashboardId", dashboardId);
    formData.set("status", next);
    run(() => setDashboardStatusAction(formData));
  };

  return (
    <div className="grid gap-4 rounded-xl border p-4" data-testid="dashboard-controls">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" ? (
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() => setStatus("published")}
            data-testid="dashboard-publish"
          >
            {t("controls.publish")}
          </button>
        ) : null}
        {status === "published" ? (
          <>
            <button
              type="button"
              className={chipClass}
              disabled={pending}
              onClick={() => setStatus("draft")}
            >
              {t("controls.unpublish")}
            </button>
            <button
              type="button"
              className={chipClass}
              disabled={pending}
              onClick={() => setStatus("closed")}
              data-testid="dashboard-close"
            >
              {t("controls.close")}
            </button>
          </>
        ) : null}
        {status === "closed" ? (
          <button
            type="button"
            className={chipClass}
            disabled={pending}
            onClick={() => setStatus("published")}
            data-testid="dashboard-reopen"
          >
            {t("controls.reopen")}
          </button>
        ) : null}
        {status !== "archived" ? (
          <button
            type="button"
            className={chipClass}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("controls.archiveConfirm"))) return;
              setStatus("archived");
            }}
          >
            {t("controls.archive")}
          </button>
        ) : (
          <button
            type="button"
            className={chipClass}
            disabled={pending}
            onClick={() => setStatus("published")}
          >
            {t("controls.unarchive")}
          </button>
        )}
        <button
          type="button"
          className={chipClass}
          disabled={pending}
          onClick={() => run(() => duplicateDashboardAction(withDashboardId()))}
        >
          {t("controls.duplicate")}
        </button>
        <button
          type="button"
          className={dangerChipClass}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t("controls.deleteConfirm"))) return;
            startTransition(async () => {
              const outcome = await deleteDashboardAction(withDashboardId());
              setResult(outcome);
              if (outcome.ok) router.push("/app/projects");
            });
          }}
          data-testid="dashboard-delete"
        >
          {t("controls.delete")}
        </button>
        <button
          type="button"
          className={chipClass}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const outcome = await nextGroupIdAction(withDashboardId());
              if (outcome.ok && outcome.id) setNextId(outcome.id);
              return outcome;
            })
          }
          data-testid="dashboard-next-id"
        >
          {t("controls.nextGroupId")}
        </button>
      </div>

      {nextId ? (
        <p className="text-sm" data-testid="dashboard-next-id-value">
          {t("controls.nextGroupIdValue", { id: nextId })}
        </p>
      ) : null}

      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"
        data-testid="deadline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          formData.set("dashboardId", dashboardId);
          run(() => setDeadlineAction(formData));
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.opensAt")}</span>
          <input
            type="datetime-local"
            name="opensAt"
            defaultValue={toUniversityDateTimeInput(opensAt)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("fields.deadlineAt")}
          </span>
          <input
            type="datetime-local"
            name="deadlineAt"
            defaultValue={toUniversityDateTimeInput(deadlineAt)}
            className={inputClass}
          />
        </label>
        <label className="inline-flex items-center gap-2 self-end text-xs">
          <input type="checkbox" name="lateAllowed" />
          {t("fields.lateAllowed")}
        </label>
        <button type="submit" className={`${buttonClass} self-end`} disabled={pending}>
          {t("controls.saveDeadline")}
        </button>
      </form>

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-destructive" data-testid="dashboard-controls-error">
          {t(`errors.${result.error}`)}
        </p>
      ) : null}
      {result && result.ok ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
    </div>
  );
}
