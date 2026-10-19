import { cache } from "react";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, clientEnv } from "@/lib/env";
import { CONSENT_COOKIE, parseConsentCookie, policyVersionFromEnv } from "./consent";
import { loadAdConfig, loadAdKillState, type RpcCaller } from "./config";
import { evaluatePublicSurface, type PublicAdSurface } from "./public-surface-rules";

/**
 * Public (anonymous) ad surface gate (SS11, plan.md §11).
 *
 * The authenticated ads path resolves its tenant from the session
 * (`viewer.ts`); anonymous landing pages have no session, and `page-ads.ts`
 * deliberately fails closed for them. This helper supplies the missing piece
 * without weakening any gate:
 *
 *   - tenant: read-only service-role lookup of the single enabled university.
 *     The launch is single-tenant; zero or multiple rows fail CLOSED (no ads)
 *     until a public tenant-resolution strategy exists.
 *   - kill state: the existing cached `loadAdKillState` (anon-callable public
 *     RPC), so global kills and per-network kills apply within the short TTL.
 *   - consent: the same first-party cookie the authenticated path uses.
 *
 * The pure gate lives in `public-surface-rules.ts` (unit-tested); this module
 * adds request scope. Server-only: never import from a client component.
 */

export type { PublicAdSurface } from "./public-surface-rules";

const UNIVERSITY_LOOKUP_TTL_MS = 60_000;

type UniversityCacheEntry = { id: string | null; expiresAt: number };
let universityCache: UniversityCacheEntry | null = null;

/** Test seam: reset the module-level tenant cache. */
export function clearPublicSurfaceCache(): void {
  universityCache = null;
}

function serviceRpcCaller(): RpcCaller {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const supabase = createSupabaseClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return supabase as unknown as RpcCaller;
}

/**
 * Exactly one enabled tenant or null. Cached briefly: tenant rows change only
 * through platform-admin operations, and a stale id still passes every kill
 * gate, so the blast radius of the cache is "ads stay dark".
 */
async function loadPublicUniversityId(now: number = Date.now()): Promise<string | null> {
  if (universityCache && universityCache.expiresAt > now) {
    return universityCache.id;
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const supabase = createSupabaseClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("universities")
    .select("id")
    .eq("is_enabled", true)
    .is("deleted_at", null)
    .limit(2);

  const id = !error && data?.length === 1 ? data[0]!.id : null;
  universityCache = { id, expiresAt: now + UNIVERSITY_LOOKUP_TTL_MS };
  return id;
}

/**
 * Request-scoped (React cache) so the landing page, its consent banner and all
 * three units share one tenant lookup, one kill-state fetch and one cookie
 * parse per render.
 */
export const loadPublicAdSurface = cache(async (): Promise<PublicAdSurface> => {
  const universityId = await loadPublicUniversityId();
  const cookieStore = await cookies();
  const consent = parseConsentCookie(
    cookieStore.get(CONSENT_COOKIE)?.value,
    policyVersionFromEnv(),
  );
  const consentGranted = consent.categories.ads;

  if (!universityId) {
    return evaluatePublicSurface({
      universityId,
      killState: null,
      config: null,
      consentGranted,
    });
  }

  const caller = serviceRpcCaller();
  const [killState, config] = await Promise.all([
    loadAdKillState(caller, universityId),
    loadAdConfig(caller, universityId),
  ]);
  return evaluatePublicSurface({ universityId, killState, config, consentGranted });
});
