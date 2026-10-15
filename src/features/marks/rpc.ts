/**
 * Bridges the registered private.* RPCs into typed calls. Two constraints meet
 * here: `supabase gen types` only emits exposed schemas, so the private
 * functions are absent from generated Functions (they type as never); and
 * PostgREST only routes the exposed [api].schemas, so HTTP actually lands on
 * the thin public wrappers of the same names (D-k, see the marks migration).
 * Callers parse the JSON payload with the Zod schemas in contracts.ts (D3).
 */

type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

export function privateRpc(supabase: unknown): RpcTransport {
  return supabase as RpcTransport;
}
