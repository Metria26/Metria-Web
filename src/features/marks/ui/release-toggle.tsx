"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setAssessmentReleaseAction } from "@/features/marks/actions";
import type { ActionResult } from "@/features/marks/contracts";

const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

/**
 * Staff release switch for one assessment. `assessments.visibility` is what
 * the student RLS policy, dashboard RPC and marksheet RPC all filter on, so a
 * mark stays invisible until the assessment is released here.
 */
export function ReleaseToggle({
  assessmentId,
  released,
}: {
  assessmentId: string;
  released: boolean;
}) {
  const t = useTranslations("Marks.entry");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => setAssessmentReleaseAction(formData),
    null,
  );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      data-testid="release-toggle"
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="visibility" value={released ? "private" : "students"} />
      <span className="grid gap-0.5">
        <span className="font-medium">{t("release.title")}</span>
        <span
          className="text-sm text-muted-foreground"
          data-testid="release-status"
          data-released={released}
        >
          {released ? t("release.releasedBody") : t("release.privateBody")}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {state && !state.ok ? (
          <span role="alert" data-testid="release-error" className="text-sm text-destructive">
            {t(`errors.${state.error}`)}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className={buttonClass}
          data-testid="release-submit"
        >
          {pending ? t("release.saving") : released ? t("release.hide") : t("release.release")}
        </button>
      </span>
    </form>
  );
}
