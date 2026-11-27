import { z } from "zod";

/**
 * App-side contract for private.booking_export_groups() (see the group export
 * migration). The export endpoint is staff-only, but the RPC repeats the check
 * so a direct call can never expose another group's roster.
 */

export const exportGroupMemberSchema = z.object({
  profileId: z.string().uuid().nullable(),
  name: z.string(),
  rollNo: z.string().nullable(),
  email: z.string().nullable(),
  isBooker: z.boolean(),
});

export const exportGroupSchema = z.object({
  bookingId: z.string().uuid(),
  groupId: z.string(),
  memberCount: z.coerce.number().int().nonnegative(),
  members: z.array(exportGroupMemberSchema),
});

export type ExportGroupMember = z.infer<typeof exportGroupMemberSchema>;
export type ExportGroup = z.infer<typeof exportGroupSchema>;

type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

export async function loadBookingExportGroups(
  supabase: unknown,
  periodId: string,
): Promise<ExportGroup[]> {
  const { data, error } = await (supabase as RpcTransport).rpc("booking_export_groups", {
    p_period_id: periodId,
  });
  if (error) throw new Error(error.message);
  return z.array(exportGroupSchema).parse(data ?? []);
}
