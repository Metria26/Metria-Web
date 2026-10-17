import { cookies } from "next/headers";
import { CONSENT_COOKIE, parseConsentCookie, policyVersionFromEnv } from "./consent";
import { AD_VISITOR_COOKIE, parseVisitorCookie } from "./visitor";
import { loadAdKillState, type RpcCaller } from "./config";
import { resolveAdSlots, type ResolveAdSlotsResult } from "./slots";
import { loadAdViewer } from "./viewer";
import { createClient } from "@/lib/supabase/server";

/**
 * Request-scoped ad plumbing shared by <AdSlot>, the (app) layout banner gate
 * and pages that need `revealValues` directly (marksheet). Keeps cookie
 * parsing, session/tenant lookup and the RPC cast in ONE place — every call
 * path resolves ads exactly the same way (consent from first-party cookie,
 * tenant from the cached profile lookup, fail closed without a session).
 * Server-only: never import this module from client code or unit tests (it
 * needs next/headers request scope); the pure logic lives in slots.ts.
 */

type PageAdsInput = {
  pageType: string;
  slotKeys: string[];
  withSponsor?: boolean;
  sensitive?: boolean;
  authenticated?: boolean;
};

function toRpcCaller(supabase: unknown): RpcCaller {
  return supabase as RpcCaller;
}

export async function resolvePageAds(input: PageAdsInput): Promise<ResolveAdSlotsResult> {
  const viewer = await loadAdViewer();
  if (!viewer) {
    return {
      active: false,
      revealValues: false,
      consent: { analytics: false, ads: false },
      slots: input.slotKeys.map((slotKey) => ({
        slotKey,
        unit: null,
        sponsor: null,
        isolationMode: "no_script_ads",
      })),
    };
  }

  const cookieStore = await cookies();
  const consent = parseConsentCookie(
    cookieStore.get(CONSENT_COOKIE)?.value,
    policyVersionFromEnv(),
  );
  const visitor = parseVisitorCookie(cookieStore.get(AD_VISITOR_COOKIE)?.value);
  const supabase = await createClient();

  return resolveAdSlots({
    supabase: toRpcCaller(supabase),
    universityId: viewer.universityId,
    pageType: input.pageType,
    slotKeys: input.slotKeys,
    consent: consent.categories,
    recentPopStyleAt: visitor?.popStyleShownAt ?? null,
    withSponsor: input.withSponsor,
    sensitive: input.sensitive,
    authenticated: input.authenticated ?? true,
  });
}

/**
 * Consent-banner gate (T-B003): the banner mounts on authenticated surfaces
 * only while the private ad layer can actually serve (platform flag on, no
 * master/university kill, private layer enabled). With the shipped defaults
 * (ads.enabled=false, ads.global_kill=true) it never renders, so pre-T-B003
 * pages and tests keep byte-identical DOM. The public layer mounts its own
 * banner with the public flag when Track A lands.
 */
export async function privateAdSurfaceOpen(universityId: string): Promise<boolean> {
  const supabase = await createClient();
  const killState = await loadAdKillState(toRpcCaller(supabase), universityId);
  if (!killState) return false;
  return (
    killState.flags.enabled &&
    !killState.flags.global_kill &&
    !killState.global &&
    killState.flags.private_enabled
  );
}
