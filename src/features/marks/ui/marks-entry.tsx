"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveMarkAction } from "@/features/marks/actions";
import type { ActionResult } from "@/features/marks/contracts";

type MarkRow = {
  studentId: string;
  name: string;
  email: string;
  score: number | null;
  status: string;
};

export type MarkEntryGroup = {
  sectionId: string;
  sectionCode: string;
  rows: MarkRow[];
};

const fieldClass =
  "h-9 w-24 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function RowForm({ assessmentId, row }: { assessmentId: string; row: MarkRow }) {
  const t = useTranslations("Marks.entry");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => saveMarkAction(formData),
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3" data-testid="mark-form">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="studentId" value={row.studentId} />
      <span className="grid min-w-40 flex-1 gap-0.5">
        <span className="font-medium" data-testid="mark-student-name">
          {row.name}
        </span>
        <span className="text-sm text-muted-foreground">{row.email}</span>
      </span>
      <span
        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
        data-testid="mark-status"
      >
        {t(`status.${row.status === "graded" ? "graded" : "pending"}`)}
      </span>
      <label className="grid gap-1">
        <span className="sr-only">{t("scoreAria", { name: row.name })}</span>
        <input
          name="score"
          type="number"
          min={0}
          step="0.01"
          defaultValue={row.score ?? ""}
          className={fieldClass}
          data-testid="mark-score"
          aria-label={t("scoreAria", { name: row.name })}
        />
      </label>
      <button type="submit" disabled={pending} className={buttonClass} data-testid="mark-save">
        {pending ? t("saving") : t("save")}
      </button>
      {state && !state.ok ? (
        <p role="alert" data-testid="mark-save-error" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Marks are grouped per section: an assessment for one section shows that
 * section only; an all-section assessment renders one list per section so a
 * TA never mixes rosters while entering scores (R10).
 */
export function MarksEntry({
  assessmentId,
  groups,
}: {
  assessmentId: string;
  groups: MarkEntryGroup[];
}) {
  const t = useTranslations("Marks.entry");
  return (
    <div className="grid gap-6" data-testid="marks-entry-groups">
      {groups.map((group) => (
        <section key={group.sectionId} className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold" data-testid="marks-section-heading">
              {t("sectionHeading", { code: group.sectionCode })}
            </h3>
            <span className="text-sm text-muted-foreground" data-testid="marks-section-count">
              {t("studentsCount", { count: group.rows.length })}
            </span>
          </div>
          <ul className="grid gap-2" data-testid="marks-entry-list">
            {group.rows.map((row) => (
              <li
                key={row.studentId}
                className="rounded-lg border bg-card px-4 py-3"
                data-testid="mark-row"
                data-section={group.sectionCode}
                data-email={row.email}
              >
                <RowForm assessmentId={assessmentId} row={row} />
              </li>
            ))}
            {group.rows.length === 0 ? (
              <li className="text-sm text-muted-foreground" data-testid="marks-entry-empty">
                {t("noStudentsSection")}
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
