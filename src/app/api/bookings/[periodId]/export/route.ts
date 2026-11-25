import { createClient } from "@/lib/supabase/server";
import { buildBookingCsv } from "@/features/booking/csv";
import { loadPeriodBookingOverview } from "@/features/booking/overview";

/**
 * GET /api/bookings/{periodId}/export — staff-only CSV of active bookings:
 * student, slot time (Asia/Karachi) and evaluator. The overview RPC already
 * hides student/evaluator rows from non-staff; can_manage is checked again so
 * a student can never download the roster.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  const { periodId } = await params;
  if (!UUID_RE.test(periodId)) return new Response("Invalid period", { status: 400 });

  const supabase = await createClient();
  let overview: Awaited<ReturnType<typeof loadPeriodBookingOverview>>;
  try {
    overview = await loadPeriodBookingOverview(supabase, periodId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unauthenticated/i.test(message)) return new Response("Unauthenticated", { status: 401 });
    if (/forbidden/i.test(message)) return new Response("Forbidden", { status: 403 });
    throw error;
  }

  if (!overview) return new Response("Not found", { status: 404 });
  if (!overview.can_manage) return new Response("Forbidden", { status: 403 });

  const fileName = `evaluation-bookings-${periodId.slice(0, 8)}.csv`;
  return new Response(buildBookingCsv(overview), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
