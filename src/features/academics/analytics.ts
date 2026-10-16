import { z } from "zod";

/**
 * T-A005 app-side contract for the `offering_analytics()` RPC. Every aggregate
 * is already k-threshold-suppressed in SQL (D10/P14); the server nulls the
 * values and sets `suppressed`. The UI must render the suppressed state, never
 * a number, when the flag is true.
 */

export const analyticsBucketSchema = z.object({
  bucket_0_49: z.coerce.number().nullable(),
  bucket_50_74: z.coerce.number().nullable(),
  bucket_75_100: z.coerce.number().nullable(),
});

export const analyticsAssessmentSchema = z.object({
  assessment_id: z.string().uuid(),
  title: z.string(),
  assessment_type: z.string(),
  total: z.coerce.number(),
  n: z.coerce.number(),
  suppressed: z.boolean(),
  avg_percent: z.coerce.number().nullable(),
  min_percent: z.coerce.number().nullable(),
  max_percent: z.coerce.number().nullable(),
  bucket_0_49: z.coerce.number().nullable(),
  bucket_50_74: z.coerce.number().nullable(),
  bucket_75_100: z.coerce.number().nullable(),
  created_at: z.string(),
});

export const analyticsSectionSchema = z.object({
  section_id: z.string().uuid(),
  section_code: z.string(),
  n: z.coerce.number(),
  suppressed: z.boolean(),
  avg_percent: z.coerce.number().nullable(),
});

export const offeringAnalyticsSchema = z.object({
  offering_id: z.string().uuid(),
  k: z.coerce.number(),
  assessments: z.array(analyticsAssessmentSchema),
  sections: z.array(analyticsSectionSchema),
});

export type OfferingAnalytics = z.infer<typeof offeringAnalyticsSchema>;

type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

export async function loadOfferingAnalytics(
  supabase: unknown,
  offeringId: string,
): Promise<OfferingAnalytics> {
  const { data, error } = await (supabase as RpcTransport).rpc("offering_analytics", {
    p_offering_id: offeringId,
  });
  if (error) throw new Error(error.message);
  return offeringAnalyticsSchema.parse(data);
}
