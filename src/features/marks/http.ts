import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ApiErrorCode } from "./contracts";

/**
 * Shared helpers for the /api/imports route handlers (api-contracts.md):
 * stable error envelope {code, message, correlationId, fieldErrors?} and
 * PostgREST error mapping. SQL details never cross the boundary — unknown
 * messages collapse to temporarily_unavailable.
 */

export type { ApiErrorCode };

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  batch_expired: 409,
  rate_limited: 429,
  temporarily_unavailable: 500,
};

const MESSAGE_BY_CODE: Record<ApiErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have permission to do this.",
  not_found: "The requested item was not found.",
  validation_error: "The submitted data is not valid.",
  conflict: "The request conflicts with the current state.",
  batch_expired: "This preview expired. Upload the file again.",
  rate_limited: "Too many requests. Try again shortly.",
  temporarily_unavailable: "Something went wrong. Try again.",
};

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function errorResponse(
  code: ApiErrorCode,
  correlationId: string,
  fieldErrors?: Record<string, string[]>,
): NextResponse {
  return NextResponse.json(
    {
      code,
      message: MESSAGE_BY_CODE[code],
      correlationId,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
    {
      status: STATUS_BY_CODE[code],
      headers: { "X-Correlation-Id": correlationId },
    },
  );
}

export function okResponse(body: unknown, correlationId: string): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: { "X-Correlation-Id": correlationId },
  });
}

/** Known RPC messages map to stable codes; everything else stays generic. */
export function rpcErrorToCode(message: string | undefined): ApiErrorCode {
  switch (message) {
    case "unauthenticated":
      return "unauthenticated";
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "batch_expired":
      return "batch_expired";
    case "conflict":
      return "conflict";
    default:
      return "temporarily_unavailable";
  }
}

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "body";
    (fieldErrors[key] ??= []).push(issue.code);
  }
  return fieldErrors;
}

export async function requireSession(): Promise<{
  // Structural client type: this module only uses auth + typed table calls
  // that exist on every Supabase client instance.
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}
