/**
 * Minimal transport for public delete RPCs whose generated types are not in
 * database.types.ts yet (they are added by the companion migration).
 */
type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

export function rpcTransport(supabase: unknown): RpcTransport {
  return supabase as RpcTransport;
}
