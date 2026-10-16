import { z } from "zod";

/**
 * T-A005 app-side contract for the `student_dashboard()` RPC (see the
 * announcements_dashboard migration). The RPC is one bounded call so the
 * dashboard renders in a single round trip (D2 / page-specs). Every payload
 * the RPC returns is parsed here so a schema/format drift fails loudly at the
 * boundary instead of corrupting the UI.
 */

export const dashboardMarkSchema = z.object({
  assessment_title: z.string(),
  assessment_type: z.string(),
  course_code: z.string(),
  course_title: z.string(),
  offering_id: z.string().uuid(),
  score: z.coerce.number().nullable(),
  total: z.coerce.number(),
  recorded_at: z.string(),
});

export const dashboardAnnouncementSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body_html: z.string(),
  section_code: z.string(),
  course_code: z.string(),
  offering_id: z.string().uuid(),
  created_at: z.string(),
});

export const dashboardAssessmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  assessment_type: z.string(),
  total: z.coerce.number(),
  weight: z.coerce.number(),
  course_code: z.string(),
  offering_id: z.string().uuid(),
  created_at: z.string(),
});

export const studentDashboardSchema = z.object({
  latest_marks: z.array(dashboardMarkSchema),
  announcements: z.array(dashboardAnnouncementSchema),
  upcoming_assessments: z.array(dashboardAssessmentSchema),
  // T-A006 fills this in (expand-only); parsed as opaque for now.
  evaluation_slots: z.array(z.unknown()),
});

export type StudentDashboard = z.infer<typeof studentDashboardSchema>;

type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

/**
 * Loads and parses the caller's dashboard. Throws the Zod error on drift and
 * the Postgres error on failure so the caller's error boundary handles it.
 */
export async function loadStudentDashboard(supabase: unknown): Promise<StudentDashboard> {
  const { data, error } = await (supabase as RpcTransport).rpc("student_dashboard");
  if (error) throw new Error(error.message);
  return studentDashboardSchema.parse(data);
}
