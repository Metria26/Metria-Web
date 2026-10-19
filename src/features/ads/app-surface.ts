import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_COOKIE, parseConsentCookie, policyVersionFromEnv } from "./consent";
import { loadAdConfig, loadAdKillState, type RpcCaller } from "./config";
import { loadAdViewer } from "./viewer";
import { evaluatePrivateSurface, type PrivateAdSurface } from "./private-surface-rules";

/**
 * Request-scoped authenticated Adsterra surface gate for the app shell
 * (owner request 2026-10-19: all three reviewed units on every /app page).
 *
 * Mirrors `public-surface.ts`, but resolves the tenant from the signed-in
 * viewer instead of the anonymous service-role lookup and requires
 * `ads.private.enabled`. One React cache() per request means the app layout's
 * consent banner and the ad units share one viewer/config/kill-state read.
 * Failures return a closed surface (no ads), never an open one.
 */
export const loadPrivateAdSurface = cache(async (): Promise<PrivateAdSurface> => {
  const viewer = await loadAdViewer();
  const cookieStore = await cookies();
  const consent = parseConsentCookie(
    cookieStore.get(CONSENT_COOKIE)?.value,
    policyVersionFromEnv(),
  );
  const consentGranted = consent.categories.ads;

  if (!viewer) {
    return evaluatePrivateSurface({
      universityId: null,
      killState: null,
      config: null,
      consentGranted,
      authenticated: false,
    });
  }

  const supabase = await createClient();
  const caller = supabase as unknown as RpcCaller;
  const [killState, config] = await Promise.all([
    loadAdKillState(caller, viewer.universityId),
    loadAdConfig(caller, viewer.universityId),
  ]);

  return evaluatePrivateSurface({
    universityId: viewer.universityId,
    killState,
    config,
    consentGranted,
    authenticated: true,
  });
});
