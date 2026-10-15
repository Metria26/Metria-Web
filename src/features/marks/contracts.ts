import { z } from "zod";

/**
 * Zod contracts for marks + CSV import server boundaries (D3 / T-A004).
 * FormData arrives as strings — coerce before numeric checks. Import limits
 * come from ADR-002 (10 MiB / 10,000 rows, reject before parsing).
 */

export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;

/** Manual mark entry (staff). Empty score clears the mark back to pending. */
export const markInputSchema = z.object({
  assessmentId: z.string().uuid("assessmentRequired"),
  studentId: z.string().uuid("studentRequired"),
  score: z
    .string()
    .trim()
    .max(32, "scoreInvalid")
    .optional()
    .default("")
    .refine(
      (value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "scoreInvalid",
    )
    .transform((value) => (value === "" ? null : Number(value))),
});
export type MarkInput = z.infer<typeof markInputSchema>;

/** One client-pre-parsed CSV data row (Papaparse). Row-level semantics are
 *  validated server-side in import-logic so bad rows become counted statuses
 *  instead of failing the whole request. */
export const csvRowSchema = z.object({
  email: z.string().trim().max(254, "emailMax"),
  score: z.string().trim().max(32, "scoreInvalid"),
});
export type CsvRow = z.infer<typeof csvRowSchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "idempotencyKeyMin")
  .max(128, "idempotencyKeyMax")
  .regex(/^[A-Za-z0-9_-]+$/, "idempotencyKeyCharset");

export const importPreviewRequestSchema = z.object({
  assessmentId: z.string().uuid("assessmentRequired"),
  idempotencyKey: idempotencyKeySchema,
  overwrite: z.boolean().default(false),
  rows: z.array(csvRowSchema).max(CSV_MAX_ROWS, "tooManyRows"),
});
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;

export const importConfirmRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type ImportConfirmRequest = z.infer<typeof importConfirmRequestSchema>;

export const importRowStatusSchema = z.enum([
  "ready",
  "not_found",
  "duplicate",
  "invalid",
  "applied",
  "skipped",
]);
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;

/** Preview/confirm counters. The RPC returns only statuses that exist, so
 *  every field is optional — normalize with importCounts(). */
export const importCountsSchema = z
  .object({
    ready: z.number().int().min(0).optional(),
    not_found: z.number().int().min(0).optional(),
    duplicate: z.number().int().min(0).optional(),
    invalid: z.number().int().min(0).optional(),
    existing: z.number().int().min(0).optional(),
    applied: z.number().int().min(0).optional(),
    skipped: z.number().int().min(0).optional(),
  })
  .default({});
export type ImportCounts = z.infer<typeof importCountsSchema>;

export const importErrorRowSchema = z.object({
  row: z.number().int().min(1),
  email: z.string(),
  status: importRowStatusSchema,
  code: z.string(),
});
export type ImportErrorRow = z.infer<typeof importErrorRowSchema>;

export const importPreviewResponseSchema = z.object({
  batchId: z.string().uuid(),
  state: z.enum(["preview", "applied"]),
  expiresAt: z.string(),
  total: z.number().int().min(0),
  counts: importCountsSchema,
  errors: z.array(importErrorRowSchema).max(CSV_MAX_ROWS),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importConfirmResponseSchema = z.object({
  batchId: z.string().uuid(),
  state: z.literal("applied"),
  counts: importCountsSchema,
});
export type ImportConfirmResponse = z.infer<typeof importConfirmResponseSchema>;

/** private.offering_marksheet output (registry delta 2026-10-15, T-A004). */
export const marksheetSchema = z.object({
  offeringId: z.string().uuid(),
  cohortSize: z.number().int().min(0),
  threshold: z.number().int().min(1),
  thresholdMet: z.boolean(),
  assessments: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      type: z.string(),
      total: z.number(),
      weight: z.number(),
    }),
  ),
  ownScores: z.record(z.string(), z.object({ score: z.number().nullable(), status: z.string() })),
  ownTotal: z.number(),
  ownRank: z.number().int().nullable(),
  stats: z
    .object({
      count: z.number().int().min(0),
      mean: z.number(),
      median: z.number(),
      min: z.number(),
      max: z.number(),
    })
    .nullable(),
  gradingScale: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      bands: z.array(z.object({ min: z.number(), grade: z.string() })).nullable(),
    })
    .nullable(),
});
export type Marksheet = z.infer<typeof marksheetSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Stable error-envelope codes (api-contracts.md) — shared by routes and UI. */
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "batch_expired"
  | "rate_limited"
  | "temporarily_unavailable";
