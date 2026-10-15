import { createHash } from "node:crypto";
import {
  CSV_MAX_BYTES,
  importPreviewRequestSchema,
  importPreviewResponseSchema,
  type ImportCounts,
  type ImportErrorRow,
} from "@/features/marks/contracts";
import {
  errorResponse,
  newCorrelationId,
  okResponse,
  requireSession,
  zodFieldErrors,
} from "@/features/marks/http";
import { classifyRows, rowHashInput, type ClassifiedRow } from "@/features/marks/import-logic";

/**
 * POST /api/imports/preview (api-contracts.md): parse + validate the client-
 * pre-parsed CSV, store an expiring preview (import_batches + import_rows) and
 * return counts. NOTHING is written to `marks` before /confirm (2.2 / R10).
 * Preview is idempotent per idempotency_key: a replay returns the stored batch
 * (first request wins). Partial failures leave state='failed'; a retry with
 * the same key + payload re-runs only the row insert, never a marks write.
 */

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHUNK = 500;

type BatchRow = {
  id: string;
  state: string;
  expires_at: string;
  assessment_id: string;
  overwrite_existing: boolean;
};

export async function POST(request: Request): Promise<Response> {
  const correlationId = newCorrelationId();
  const { supabase, userId } = await requireSession();
  if (!userId) return errorResponse("unauthenticated", correlationId);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > CSV_MAX_BYTES) {
    // ADR-002: reject larger payloads before parsing.
    return errorResponse("validation_error", correlationId, { file: ["tooLarge"] });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", correlationId, { body: ["invalidJson"] });
  }
  const parsed = importPreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", correlationId, zodFieldErrors(parsed.error));
  }
  const { assessmentId, idempotencyKey, overwrite, rows } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!profile) return errorResponse("forbidden", correlationId);

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, offering_id, total, university_id")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!assessment || assessment.university_id !== profile.university_id) {
    return errorResponse("not_found", correlationId);
  }
  const { data: staffRow } = await supabase
    .from("offering_staff")
    .select("id")
    .eq("offering_id", assessment.offering_id)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!staffRow) return errorResponse("forbidden", correlationId);

  // Idempotent replay: same key returns the stored preview (first wins).
  const { data: prior } = await supabase
    .from("import_batches")
    .select("id, state, expires_at, assessment_id, overwrite_existing")
    .eq("university_id", profile.university_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (prior && prior.state !== "failed") {
    if (prior.assessment_id !== assessmentId) {
      return errorResponse("conflict", correlationId);
    }
    return okResponse(await replayPayload(supabase, prior as BatchRow), correlationId);
  }

  const { resolvedProfiles, enrolledIds, markedIds } = await buildResolvers(
    supabase,
    rows.map((row) => row.email),
    profile.university_id,
    assessment.offering_id,
    assessmentId,
  );
  const classified = classifyRows(rows, {
    assessmentTotal: assessment.total,
    resolve: (email) => {
      const profileId = resolvedProfiles.get(email);
      if (!profileId) return undefined;
      return { profileId, enrolled: enrolledIds.has(profileId) };
    },
    markExists: (profileId) => markedIds.has(profileId),
  });

  let batch = prior as BatchRow | null;
  if (!batch) {
    const { data: created, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        university_id: profile.university_id,
        created_by: profile.id,
        assessment_id: assessmentId,
        idempotency_key: idempotencyKey,
        state: "preview",
        expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
        overwrite_existing: overwrite,
      })
      .select("id, state, expires_at, assessment_id, overwrite_existing")
      .single();
    if (batchError) {
      if (batchError.code === "23505") {
        // Lost a race with an identical concurrent preview: replay it.
        const { data: raced } = await supabase
          .from("import_batches")
          .select("id, state, expires_at, assessment_id, overwrite_existing")
          .eq("university_id", profile.university_id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (raced)
          return okResponse(await replayPayload(supabase, raced as BatchRow), correlationId);
      }
      return errorResponse("temporarily_unavailable", correlationId);
    }
    batch = created as BatchRow;
  }

  const rowsError = await insertRows(supabase, batch.id, profile, classified.rows);
  if (rowsError) {
    await supabase.from("import_batches").update({ state: "failed" }).eq("id", batch.id);
    return errorResponse("temporarily_unavailable", correlationId);
  }
  if (batch.state === "failed") {
    await supabase.from("import_batches").update({ state: "preview" }).eq("id", batch.id);
    batch.state = "preview";
  }

  return respond(
    payloadFromRows(
      batch.id,
      "preview",
      classified.rows.map((row) => ({
        row_number: row.rowNumber,
        email: row.email,
        status: row.status,
        error_code: row.errorCode,
      })),
      batch.expires_at,
    ),
    correlationId,
  );
}

async function buildResolvers(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  emails: string[],
  universityId: string,
  offeringId: string,
  assessmentId: string,
): Promise<{
  resolvedProfiles: Map<string, string>;
  enrolledIds: Set<string>;
  markedIds: Set<string>;
}> {
  const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
  const resolvedProfiles = new Map<string, string>();
  for (let i = 0; i < uniqueEmails.length; i += EMAIL_CHUNK) {
    const chunk = uniqueEmails.slice(i, i + EMAIL_CHUNK);
    const { data } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("university_id", universityId)
      .in("email", chunk);
    for (const row of data ?? []) {
      resolvedProfiles.set(row.email.toLowerCase(), row.id);
    }
  }

  const { data: enrollmentRows } = await supabase
    .from("enrollments")
    .select("profile_id, sections!inner(offering_id)")
    .eq("status", "active")
    .eq("sections.offering_id", offeringId);
  const enrolledIds = new Set((enrollmentRows ?? []).map((row) => row.profile_id));

  const { data: markRows } = await supabase
    .from("marks")
    .select("student_id")
    .eq("assessment_id", assessmentId);
  const markedIds = new Set((markRows ?? []).map((row) => row.student_id));

  return { resolvedProfiles, enrolledIds, markedIds };
}

async function insertRows(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  batchId: string,
  profile: { id: string; university_id: string },
  rows: ClassifiedRow[],
): Promise<string | null> {
  if (rows.length === 0) return null;
  const { error } = await supabase.from("import_rows").insert(
    rows.map((row) => ({
      university_id: profile.university_id,
      created_by: profile.id,
      batch_id: batchId,
      row_number: row.rowNumber,
      row_hash: createHash("sha256")
        .update(rowHashInput(row.rowNumber, row.email, String(row.proposedScore ?? "")))
        .digest("hex"),
      email: row.email,
      proposed_score: row.proposedScore,
      status: row.status,
      error_code: row.errorCode,
    })),
  );
  return error ? error.message : null;
}

type StoredRow = {
  row_number: number;
  email: string | null;
  status: "ready" | "not_found" | "duplicate" | "invalid" | "applied" | "skipped";
  error_code: string | null;
};

async function replayPayload(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  batch: BatchRow,
): Promise<unknown> {
  const { data: storedRows } = await supabase
    .from("import_rows")
    .select("row_number, email, status, error_code")
    .eq("batch_id", batch.id)
    .order("row_number");
  const state = batch.state === "applied" ? "applied" : "preview";
  return payloadFromRows(batch.id, state, (storedRows ?? []) as StoredRow[], batch.expires_at);
}

type PayloadRow = Pick<StoredRow, "row_number" | "email" | "status" | "error_code">;

function payloadFromRows(
  batchId: string,
  state: "preview" | "applied",
  rows: PayloadRow[],
  expiresAt: string,
): unknown {
  const counts: ImportCounts = {
    ready: 0,
    not_found: 0,
    duplicate: 0,
    invalid: 0,
    existing: 0,
    applied: 0,
    skipped: 0,
  };
  const errors: ImportErrorRow[] = [];

  for (const row of rows) {
    const status = row.status;
    if (status === "ready" && row.error_code === "exists") {
      counts.existing = (counts.existing ?? 0) + 1;
    }
    if (status in counts) counts[status] = (counts[status] ?? 0) + 1;
    if (
      status === "not_found" ||
      status === "duplicate" ||
      status === "invalid" ||
      status === "skipped"
    ) {
      errors.push({
        row: row.row_number,
        email: row.email ?? "",
        status,
        code: row.error_code ?? status,
      });
    }
  }

  return {
    batchId,
    state,
    expiresAt,
    total: rows.length,
    counts,
    errors,
  };
}

function respond(payload: unknown, correlationId: string): Response {
  const safe = importPreviewResponseSchema.safeParse(payload);
  if (!safe.success) return errorResponse("temporarily_unavailable", correlationId);
  return okResponse(safe.data, correlationId);
}
