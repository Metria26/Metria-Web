import { CSV_MAX_BYTES, CSV_MAX_ROWS, type ImportCounts } from "./contracts";

/**
 * Pure two-phase import classification (feature 2.2 / T-A004). The route
 * resolves emails against the tenant and delegates the row decisions here so
 * preview counts are unit-testable without a database. Cascade per row:
 * email format → score parse/range → within-file duplicate → resolvability
 * (student exists + enrolled) → ready (flagged `existing` when a mark is
 * already present — the confirm step decides skip vs overwrite, R10).
 */

export type PreviewRow = { email: string; score: string };

export type RowResolution = { profileId: string; enrolled: boolean } | undefined;

export type ClassifiedRow = {
  rowNumber: number;
  email: string;
  proposedScore: number | null;
  status: "ready" | "not_found" | "duplicate" | "invalid";
  errorCode: string | null;
  existing: boolean;
};

export type ClassificationOptions = {
  assessmentTotal: number;
  resolve: (email: string) => RowResolution;
  markExists: (profileId: string) => boolean;
};

export function withinCsvLimits(byteLength: number, rowCount: number): boolean {
  return byteLength <= CSV_MAX_BYTES && rowCount <= CSV_MAX_ROWS;
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** First occurrence of an email wins; later rows are duplicates (documented). */
export function classifyRows(
  rows: PreviewRow[],
  options: ClassificationOptions,
): { rows: ClassifiedRow[]; counts: ImportCounts } {
  const seenEmails = new Set<string>();
  const classified: ClassifiedRow[] = [];
  const counts: ImportCounts = {
    ready: 0,
    not_found: 0,
    duplicate: 0,
    invalid: 0,
    existing: 0,
    applied: 0,
    skipped: 0,
  };

  rows.forEach((row, index) => {
    const email = row.email.trim().toLowerCase();
    const rowNumber = index + 1;
    const push = (
      status: ClassifiedRow["status"],
      errorCode: string | null,
      {
        existing = false,
        proposedScore = null,
      }: { existing?: boolean; proposedScore?: number | null } = {},
    ) => {
      classified.push({
        rowNumber,
        email,
        proposedScore,
        status,
        errorCode,
        existing,
      });
      counts[status] = (counts[status] ?? 0) + 1;
      if (existing) counts.existing = (counts.existing ?? 0) + 1;
    };

    if (!isValidEmail(email)) {
      push("invalid", "email_invalid");
      return;
    }
    const score = Number(row.score.trim());
    if (row.score.trim() === "" || !Number.isFinite(score) || score < 0) {
      push("invalid", "score_invalid");
      return;
    }
    if (score > options.assessmentTotal) {
      push("invalid", "score_out_of_range");
      return;
    }
    if (seenEmails.has(email)) {
      push("duplicate", "duplicate_email");
      return;
    }
    seenEmails.add(email);

    const resolved = options.resolve(email);
    if (!resolved) {
      push("not_found", "student_not_found");
      return;
    }
    if (!resolved.enrolled) {
      push("not_found", "not_enrolled");
      return;
    }
    const existing = options.markExists(resolved.profileId);
    push("ready", existing ? "exists" : null, { existing, proposedScore: score });
  });

  return { rows: classified, counts };
}

/** Error-CSV download (2.2): server-returned rows that will not apply. */
export function errorsToCsv(
  errors: { row: number; email: string; status: string; code: string }[],
): string {
  const lines = ["row,email,status,reason"];
  for (const error of errors) {
    lines.push(`${error.row},${csvEscape(error.email)},${error.status},${error.code}`);
  }
  return lines.join("\n");
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Stable row identity for the (batch_id, row_hash) uniqueness guard (P9). */
export function rowHashInput(rowNumber: number, email: string, score: string): string {
  return `${email.trim().toLowerCase()}|${score.trim()}|${rowNumber}`;
}
