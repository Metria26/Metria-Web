import { createClient } from "@/lib/supabase/server";
import { rpcTransport } from "@/lib/supabase/rpc";
import {
  buildBookingWorkbook,
  buildEvaluatorZip,
  evaluatorFileSlug,
} from "@/features/booking/excel";
import { loadPeriodBookingOverview } from "@/features/booking/overview";

/**
 * GET /api/bookings/{periodId}/export — staff-only .xlsx workbook of active
 * bookings: student, email, slot date/time (Asia/Karachi), evaluator and seat.
 *
 * Query options:
 *   ?evaluator=<id>  one evaluator's bookings only
 *   ?zip=1           one .xlsx per evaluator inside a .zip
 *   (none)           all bookings + one extra sheet per evaluator
 *
 * A staff member who is also an evaluator in this period can only download
 * their own bookings; platform admins and non-evaluating staff keep the
 * existing full access.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(
  request: Request,
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

  const url = new URL(request.url);
  const requestedEvaluatorId = url.searchParams.get("evaluator") ?? "";
  const zipRequested = url.searchParams.get("zip") === "1";

  // Evaluator users may only export themselves. Admins (and staff who are not
  // on the evaluator roster) retain the pre-existing full access.
  const { data: adminResult, error: adminError } = await rpcTransport(supabase).rpc(
    "is_platform_admin",
    {},
  );
  if (adminError) return new Response(adminError.message || "Forbidden", { status: 403 });
  const isAdmin = adminResult === true;
  const { data: userResult } = await supabase.auth.getUser();
  const callerEmail = userResult.user?.email?.trim().toLowerCase() ?? null;
  const ownEvaluator =
    !isAdmin && callerEmail
      ? overview.evaluators.find((item) => item.email?.trim().toLowerCase() === callerEmail)
      : undefined;
  const restrictedEvaluatorId = ownEvaluator?.id ?? null;

  if (restrictedEvaluatorId) {
    if (zipRequested) return new Response("Forbidden", { status: 403 });
    if (requestedEvaluatorId && requestedEvaluatorId !== restrictedEvaluatorId) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const prefix = `evaluation-bookings-${periodId.slice(0, 8)}`;
  const effectiveEvaluatorId = restrictedEvaluatorId ?? (requestedEvaluatorId || undefined);

  if (zipRequested) {
    const buffer = await buildEvaluatorZip(overview, prefix);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${prefix}-evaluators.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (effectiveEvaluatorId) {
    const evaluator = overview.evaluators.find((item) => item.id === effectiveEvaluatorId);
    if (!evaluator) return new Response("Evaluator not found", { status: 404 });
    const buffer = await buildBookingWorkbook(overview, {
      evaluatorId: evaluator.id,
      includeEvaluatorSheets: false,
    });
    const fileName = `${prefix}-${evaluatorFileSlug(evaluator.name)}.xlsx`;
    return new Response(buffer, {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const buffer = await buildBookingWorkbook(overview);
  return new Response(buffer, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${prefix}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
