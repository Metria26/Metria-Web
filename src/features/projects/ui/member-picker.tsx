"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { EligibleStudent } from "../contracts";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

/**
 * Classmate picker: members are chosen from the section roster returned by the
 * server (never typed in). The server re-validates every profile id against the
 * dashboard's section on submit.
 */
export function MemberPicker({
  students,
  selectedIds,
  onAdd,
  onRemove,
  label,
  disabled = false,
}: {
  students: EligibleStudent[];
  selectedIds: string[];
  onAdd: (student: EligibleStudent) => void;
  onRemove: (profileId: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Projects");
  const [choice, setChoice] = useState("");
  const selected = new Set(selectedIds);
  const available = students.filter((student) => !selected.has(student.profile_id));
  const chosen = students.find((student) => student.profile_id === choice) ?? null;

  return (
    <div className="grid gap-2 rounded-xl border p-4" data-testid="member-picker">
      <p className="text-sm font-semibold">{label}</p>
      {students.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("members.pickerEmpty")}</p>
      ) : (
        <div className="flex gap-2">
          <select
            className={inputClass}
            value={choice}
            disabled={disabled || available.length === 0}
            aria-label={label}
            data-testid="member-picker-select"
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">
              {available.length === 0
                ? t("members.pickerAllSelected")
                : t("members.pickerPlaceholder")}
            </option>
            {available.map((student) => (
              <option key={student.profile_id} value={student.profile_id}>
                {student.display_name} — {student.roll_no}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !chosen}
            data-testid="member-picker-add"
            onClick={() => {
              if (!chosen) return;
              onAdd(chosen);
              setChoice("");
            }}
          >
            {t("members.pickerAdd")}
          </button>
        </div>
      )}

      {selectedIds.length > 0 ? (
        <ul className="grid gap-1" data-testid="member-picker-selected">
          {selectedIds.map((profileId) => {
            const student = students.find((entry) => entry.profile_id === profileId);
            return (
              <li
                key={profileId}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-sm"
              >
                <span>
                  {student?.display_name ?? profileId}
                  {student ? ` — ${student.roll_no}` : ""}
                </span>
                <button
                  type="button"
                  className="text-xs text-destructive underline-offset-4 hover:underline disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => onRemove(profileId)}
                >
                  {t("members.pickerRemove")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("members.pickerNone")}</p>
      )}
    </div>
  );
}
