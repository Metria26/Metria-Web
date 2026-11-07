import { CSV_MAX_BYTES, CSV_MAX_ROWS, type ImportCounts } from "./contracts";
import { parseRollInput } from "@/features/academics/roll-email";

/**
 * Pure two-phase import classification (feature 2.2 / T-A004). The route
 * resolves emails against the tenant and delegates the row decisions here so
 * preview counts are unit-testable without a database. Cascade per row:
 * email/roll format → score parse/range → within-file duplicate → resolvability
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
  return parseRollInput(email) !== null;
}

/** First occurrence of a student wins; later rows are duplicates (documented). */
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
    const rawInput = row.email.trim();
    const rowNumber = index + 1;
    const push = (
      status: ClassifiedRow["status"],
      errorCode: string | null,
      {
        existing = false,
        proposedScore = null,
        email = rawInput.toLowerCase(),
      }: { existing?: boolean; proposedScore?: number | null; email?: string } = {},
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

    const roll = parseRollInput(rawInput);
    if (!roll) {
      push("invalid", "email_invalid");
      return;
    }
    const canonicalEmail = roll.email;

    const score = Number(row.score.trim());
    if (row.score.trim() === "" || !Number.isFinite(score) || score < 0) {
      push("invalid", "score_invalid", { email: canonicalEmail });
      return;
    }
    if (score > options.assessmentTotal) {
      push("invalid", "score_out_of_range", { email: canonicalEmail });
      return;
    }
    if (seenEmails.has(canonicalEmail)) {
      push("duplicate", "duplicate_email", { email: canonicalEmail });
      return;
    }
    seenEmails.add(canonicalEmail);

    const resolved = options.resolve(canonicalEmail);
    if (!resolved) {
      push("not_found", "student_not_found", { email: canonicalEmail });
      return;
    }
    if (!resolved.enrolled) {
      push("not_found", "not_enrolled", { email: canonicalEmail });
      return;
    }
    const existing = options.markExists(resolved.profileId);
    push("ready", existing ? "exists" : null, {
      existing,
      proposedScore: score,
      email: canonicalEmail,
    });
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
