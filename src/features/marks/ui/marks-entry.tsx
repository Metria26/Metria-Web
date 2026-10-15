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

export function MarksEntry({ assessmentId, rows }: { assessmentId: string; rows: MarkRow[] }) {
  const t = useTranslations("Marks.entry");
  return (
    <ul className="grid gap-2" data-testid="marks-entry-list">
      {rows.map((row) => (
        <li
          key={row.studentId}
          className="rounded-lg border bg-card px-4 py-3"
          data-testid="mark-row"
          data-email={row.email}
        >
          <RowForm assessmentId={assessmentId} row={row} />
        </li>
      ))}
      {rows.length === 0 ? (
        <li className="text-sm text-muted-foreground" data-testid="marks-entry-empty">
          {t("noStudents")}
        </li>
      ) : null}
    </ul>
  );
}
