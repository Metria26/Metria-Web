import { rpcTransport } from "@/lib/supabase/rpc";
import type { EligibleStudent } from "./contracts";

/**
 * Section roster for the group picker (RPC re-checks enrollment server-side).
 * Failures degrade to an empty roster instead of breaking the page.
 */
export async function listEligibleStudents(
  supabase: unknown,
  dashboardId: string,
): Promise<EligibleStudent[]> {
  const { data, error } = await rpcTransport(supabase).rpc("list_project_eligible_students", {
    p_dashboard_id: dashboardId,
  });
  if (error || !Array.isArray(data)) return [];
  return data as EligibleStudent[];
}
