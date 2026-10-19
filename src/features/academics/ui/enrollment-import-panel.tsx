"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { bulkEnrollStudentsAction } from "@/features/academics/actions";
import { parseRollInput } from "@/features/academics/roll-email";
import type { BulkEnrollmentResult } from "@/features/academics/contracts";

type SectionOption = { id: string; label: string };
type FileErrorKey = "tooLarge" | "emptyFile" | "tooManyRows" | "parseError";
type ActionErrorKey =
  "notAuthorized" | "invalidInput" | "invalidReference" | "duplicate" | "generic";
type ParsedSheet = {
  entries: string[];
  valid: number;
  duplicates: number;
  invalid: string[];
};

const CSV_MAX_ROWS = 1000;
const CSV_MAX_BYTES = 2 * 1024 * 1024;
const HEADER_LABELS = new Set([
  "roll",
  "rollno",
  "rollnumber",
  "email",
  "student",
  "studentid",
  "id",
]);

const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const secondaryButtonClass =
  "inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function summarize(entries: string[]): ParsedSheet {
  const invalid: string[] = [];
  const seen = new Set<string>();
  let valid = 0;
  let duplicates = 0;
  for (const entry of entries) {
    const roll = parseRollInput(entry);
    if (!roll) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(roll.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(roll.email);
    valid += 1;
  }
  return { entries, valid, duplicates, invalid };
}

function isHeaderCell(value: string): boolean {
  return HEADER_LABELS.has(value.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * One-step CSV importer for roll numbers. Valid rows are submitted as-is to
 * the server action, which re-derives emails (roll-email.ts), enrolls matched
 * profiles and stores pending invites for students who have not signed in yet.
 */
export function EnrollmentImportPanel({ sections }: { sections: SectionOption[] }) {
  const t = useTranslations("Offerings.enrollImport");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileError, setFileError] = useState<FileErrorKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<BulkEnrollmentResult, { ok: true }> | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName(null);
    setSheet(null);
    setFileError(null);
    setActionError(null);
    setResult(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileError(null);
    setActionError(null);
    setResult(null);
    setSheet(null);
    setFileName(null);

    if (file.size > CSV_MAX_BYTES) {
      setFileError("tooLarge");
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError("parseError");
      return;
    }

    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const lines = (parsed.data ?? [])
      .map((line) => (Array.isArray(line) ? String(line[0] ?? "").trim() : ""))
      .filter((line) => line.length > 0);

    const firstLine = lines[0];
    if (firstLine && isHeaderCell(firstLine)) lines.shift();
    if (lines.length === 0) {
      setFileError("emptyFile");
      return;
    }
    if (lines.length > CSV_MAX_ROWS) {
      setFileError("tooManyRows");
      return;
    }

    setFileName(file.name);
    setSheet(summarize(lines));
  }

  async function handleSubmit() {
    if (!sectionId || !sheet || sheet.valid === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const formData = new FormData();
      formData.set("sectionId", sectionId);
      formData.set("entries", JSON.stringify(sheet.entries));
      const next = await bulkEnrollStudentsAction(formData);
      if (next.ok) {
        setResult(next);
        router.refresh();
      } else {
        setActionError(next.error);
      }
    } catch {
      setActionError("generic");
    } finally {
      setBusy(false);
    }
  }

  const errorKey: ActionErrorKey =
    actionError === "notAuthorized" ||
    actionError === "invalidInput" ||
    actionError === "invalidReference" ||
    actionError === "duplicate"
      ? actionError
      : "generic";

  return (
    <div
      className="grid max-w-2xl gap-4 rounded-lg border bg-card p-4"
      data-testid="enrollment-import-panel"
    >
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("help")}</p>
      </div>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{t("section")}</span>
        <select
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="enrollment-import-section"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{t("chooseFile")}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
          data-testid="enrollment-import-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </label>

      {fileError ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="enrollment-import-file-error"
        >
          {t(`fileErrors.${fileError}`)}
        </p>
      ) : null}

      {sheet ? (
        <div className="grid gap-2 text-sm" data-testid="enrollment-import-summary">
          <p className="text-muted-foreground">
            {t("fileLoaded", { name: fileName ?? "", count: sheet.entries.length })}
          </p>
          <p>
            {t("validSummary", {
              valid: sheet.valid,
              duplicates: sheet.duplicates,
              invalid: sheet.invalid.length,
            })}
          </p>
          {sheet.invalid.length > 0 ? (
            <div className="grid gap-1">
              <p className="font-medium">{t("invalidTitle")}</p>
              <p className="text-muted-foreground">{t("invalidHint")}</p>
              <ul className="grid max-h-32 gap-1 overflow-y-auto rounded-lg border p-2 text-xs">
                {sheet.invalid.slice(0, 20).map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
                {sheet.invalid.length > 20 ? <li className="text-muted-foreground">…</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="enrollment-import-error">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      {result ? (
        <div
          className="grid gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950"
          data-testid="enrollment-import-result"
        >
          <p className="font-medium">{t("resultTitle")}</p>
          <div className="flex flex-wrap gap-2">
            <CountCell label={t("resultEnrolled")} value={result.enrolled} />
            <CountCell label={t("resultAlready")} value={result.alreadyEnrolled} />
            <CountCell label={t("resultPending")} value={result.pending} />
            <CountCell label={t("resultDuplicates")} value={result.duplicates} />
            <CountCell label={t("resultInvalid")} value={result.invalid.length} />
          </div>
          <p className="text-muted-foreground">{t("pendingHint")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => void handleSubmit()}
          disabled={busy || !sheet || sheet.valid === 0 || !sectionId}
          data-testid="enrollment-import-submit"
        >
          {busy ? t("submitting") : t("submit")}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={reset}
          data-testid="enrollment-import-reset"
        >
          {t("startOver")}
        </button>
      </div>
    </div>
  );
}

function CountCell({ label, value }: { label: string; value: number }) {
  return (
    <span className="grid min-w-24 rounded-lg border px-3 py-2 text-center">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
