import type { ActionResult } from "./contracts";
import { mapRpcError } from "./rules";

type RpcErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  stack?: string | null;
};

/**
 * Server-side RPC failures are expected action results, not thrown exceptions.
 * Log the complete diagnostic (including DB code/constraint details) and only
 * surface the raw message to the admin when it does not map to a known i18n key.
 */
export function rpcFailure(
  action: string,
  context: Record<string, unknown>,
  error: RpcErrorLike,
): ActionResult {
  const message = (error.message ?? "Unknown RPC error").trim();
  console.error(`[${action}] RPC failed`, {
    ...context,
    message,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    stack: error.stack ?? new Error(message).stack ?? null,
  });
  const key = mapRpcError(message);
  return {
    ok: false,
    error: key,
    ...(key === "generic" ? { detail: message } : {}),
  };
}
