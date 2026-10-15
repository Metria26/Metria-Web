import {
  importConfirmRequestSchema,
  importConfirmResponseSchema,
} from "@/features/marks/contracts";
import {
  errorResponse,
  newCorrelationId,
  okResponse,
  requireSession,
  rpcErrorToCode,
  zodFieldErrors,
} from "@/features/marks/http";
import { privateRpc } from "@/features/marks/rpc";

/**
 * POST /api/imports/{id}/confirm (api-contracts.md): offering staff + matching
 * idempotency key, then private.confirm_mark_import applies the preview
 * atomically (marks + mark_history in one transaction). Retrying an applied
 * batch returns the same stored counts — same result on retry (P9).
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const correlationId = newCorrelationId();
  const { batchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
    return errorResponse("not_found", correlationId);
  }

  const { supabase, userId } = await requireSession();
  if (!userId) return errorResponse("unauthenticated", correlationId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", correlationId, { body: ["invalidJson"] });
  }
  const parsed = importConfirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", correlationId, zodFieldErrors(parsed.error));
  }

  // Staff-scoped read (RLS import_batches_staff_read): a batch from another
  // tenant or an unstaffed offering is indistinguishable from a missing one.
  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, idempotency_key")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return errorResponse("not_found", correlationId);
  if (batch.idempotency_key !== parsed.data.idempotencyKey) {
    return errorResponse("conflict", correlationId);
  }

  const { data, error } = await privateRpc(supabase).rpc("confirm_mark_import", {
    p_batch_id: batchId,
  });
  if (error) {
    return errorResponse(rpcErrorToCode(error.message), correlationId);
  }

  const safe = importConfirmResponseSchema.safeParse(data);
  if (!safe.success) {
    return errorResponse("temporarily_unavailable", correlationId);
  }
  return okResponse(safe.data, correlationId);
}
