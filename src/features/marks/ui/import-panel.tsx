"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  importConfirmResponseSchema,
  importPreviewResponseSchema,
  type ApiErrorCode,
  type CsvRow,
  type ImportConfirmResponse,
  type ImportPreviewResponse,
} from "@/features/marks/contracts";
import { errorsToCsv, withinCsvLimits } from "@/features/marks/import-logic";

/**
 * Two-phase CSV importer (feature 2.2 / ADR-002): client pre-parse with
 * Papaparse enforces size/row caps, preview posts to /api/imports/preview
 * (server re-validates + stores), confirm applies atomically and is safely
 * replayable. Nothing touches `marks` before confirm.
 */

type FileErrorKey = "tooLarge" | "emptyFile" | "invalidHeader" | "tooManyRows" | "parseError";

const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const secondaryButtonClass =
  "inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

export function ImportPanel({ assessmentId }: { assessmentId: string }) {
  const t = useTranslations("Marks.import");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<FileErrorKey | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [confirmed, setConfirmed] = useState<ImportConfirmResponse | null>(null);
  const [apiError, setApiError] = useState<ApiErrorCode | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "confirm">(null);

  function reset() {
    setRows([]);
    setFileName(null);
    setFileError(null);
    setOverwrite(false);
    setIdempotencyKey("");
    setPreview(null);
    setConfirmed(null);
    setApiError(null);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setPreview(null);
    setConfirmed(null);
    setApiError(null);
    setFileError(null);
    if (!withinCsvLimits(file.size, CSV_MAX_ROWS)) {
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
    const data = (parsed.data ?? []).filter((line) => Array.isArray(line));
    if (data.length === 0) {
      setFileError("emptyFile");
      return;
    }
    const header = (data[0] ?? []).map((cell) => (cell ?? "").trim().toLowerCase());
    const emailIdx = header.indexOf("email");
    const scoreIdx = header.indexOf("score");
    if (emailIdx === -1 || scoreIdx === -1) {
      setFileError("invalidHeader");
      return;
    }
    const nextRows: CsvRow[] = [];
    for (const line of data.slice(1)) {
      const email = (line[emailIdx] ?? "").trim();
      const score = (line[scoreIdx] ?? "").trim();
      if (!email && !score) continue;
      nextRows.push({ email, score });
    }
    if (nextRows.length > CSV_MAX_ROWS) {
      setFileError("tooManyRows");
      return;
    }
    setRows(nextRows);
    setFileName(file.name);
    setIdempotencyKey(crypto.randomUUID());
  }

  async function handlePreview() {
    setBusy("preview");
    setApiError(null);
    try {
      const res = await fetch("/api/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          idempotencyKey,
          overwrite,
          rows,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        ({ code?: ApiErrorCode } & Record<string, unknown>) | null;
      if (!res.ok) {
        setApiError(body?.code ?? "temporarily_unavailable");
        return;
      }
      const safe = importPreviewResponseSchema.safeParse(body);
      if (!safe.success) {
        setApiError("temporarily_unavailable");
        return;
      }
      setConfirmed(null);
      setPreview(safe.data);
    } catch {
      setApiError("temporarily_unavailable");
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setBusy("confirm");
    setApiError(null);
    try {
      const res = await fetch(`/api/imports/${preview.batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });
      const body = (await res.json().catch(() => null)) as
        ({ code?: ApiErrorCode } & Record<string, unknown>) | null;
      if (!res.ok) {
        setApiError(body?.code ?? "temporarily_unavailable");
        return;
      }
      const safe = importConfirmResponseSchema.safeParse(body);
      if (!safe.success) {
        setApiError("temporarily_unavailable");
        return;
      }
      setConfirmed(safe.data);
      router.refresh();
    } catch {
      setApiError("temporarily_unavailable");
    } finally {
      setBusy(null);
    }
  }

  function downloadErrors() {
    if (!preview || preview.errors.length === 0) return;
    const blob = new Blob([errorsToCsv(preview.errors)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `import-errors-${preview.batchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const phase: "idle" | "parsed" | "previewed" | "confirmed" = confirmed
    ? "confirmed"
    : preview
      ? "previewed"
      : rows.length > 0
        ? "parsed"
        : "idle";

  return (
    <div className="grid max-w-2xl gap-4 rounded-lg border bg-card p-4" data-testid="import-panel">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("fileHelp", { megabytes: CSV_MAX_BYTES / (1024 * 1024), rows: CSV_MAX_ROWS })}
        </p>
      </div>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{t("chooseFile")}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
          data-testid="import-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </label>
      {fileError ? (
        <p role="alert" data-testid="import-file-error" className="text-sm text-destructive">
          {t(`fileErrors.${fileError}`)}
        </p>
      ) : null}
      {fileName ? (
        <p className="text-sm text-muted-foreground" data-testid="import-file-name">
          {t("fileLoaded", { name: fileName, count: rows.length })}
        </p>
      ) : null}

      {phase === "parsed" ? (
        <div className="grid gap-3">
          <label className="flex items-start gap-2 text-sm" data-testid="import-overwrite-label">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              data-testid="import-overwrite"
            />
            <span>
              {t("overwriteLabel")}
              <span className="block text-muted-foreground">{t("overwriteHelp")}</span>
            </span>
          </label>
          <div>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void handlePreview()}
              disabled={busy !== null}
              data-testid="import-preview"
            >
              {busy === "preview" ? t("previewing") : t("preview")}
            </button>
          </div>
        </div>
      ) : null}

      {apiError ? (
        <p role="alert" data-testid="import-api-error" className="text-sm text-destructive">
          {t(`apiErrors.${apiError}`)}
        </p>
      ) : null}

      {preview ? (
        <div className="grid gap-3" data-testid="preview-panel">
          <div className="flex flex-wrap gap-2" data-testid="preview-counts">
            <CountCell
              label={t("counts.ready")}
              value={preview.counts.ready ?? 0}
              testId="count-ready"
            />
            <CountCell
              label={t("counts.existing")}
              value={preview.counts.existing ?? 0}
              testId="count-existing"
            />
            <CountCell
              label={t("counts.not_found")}
              value={preview.counts.not_found ?? 0}
              testId="count-not-found"
            />
            <CountCell
              label={t("counts.duplicate")}
              value={preview.counts.duplicate ?? 0}
              testId="count-duplicate"
            />
            <CountCell
              label={t("counts.invalid")}
              value={preview.counts.invalid ?? 0}
              testId="count-invalid"
            />
            <CountCell label={t("counts.total")} value={preview.total} testId="count-total" />
          </div>

          {preview.errors.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium" data-testid="errors-title">
                {t("errorsTitle", { count: preview.errors.length })}
              </p>
              <ul
                className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 text-sm"
                data-testid="errors-list"
              >
                {preview.errors.slice(0, 50).map((error) => (
                  <li key={`${error.row}-${error.email}`}>
                    <span className="text-muted-foreground">#{error.row}</span> {error.email} —{" "}
                    {t(`rowReasons.${error.code}`)}
                  </li>
                ))}
              </ul>
              <div>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={downloadErrors}
                  data-testid="download-errors"
                >
                  {t("downloadErrors")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => void handleConfirm()}
              disabled={busy !== null}
              data-testid="import-confirm"
            >
              {busy === "confirm" ? t("confirming") : confirmed ? t("confirmAgain") : t("confirm")}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={reset}
              data-testid="import-reset"
            >
              {t("startOver")}
            </button>
          </div>
        </div>
      ) : null}

      {confirmed ? (
        <div
          className="grid gap-1 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950"
          data-testid="confirm-result"
        >
          <p className="font-medium">
            {t("confirmed", {
              applied: confirmed.counts.applied ?? 0,
              skipped: confirmed.counts.skipped ?? 0,
            })}
          </p>
          <p className="text-muted-foreground">{t("confirmedHint")}</p>
        </div>
      ) : null}
    </div>
  );
}

function CountCell({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <span className="grid min-w-24 rounded-lg border px-3 py-2 text-center" data-testid={testId}>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
