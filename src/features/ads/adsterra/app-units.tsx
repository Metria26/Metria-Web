import { policyVersionFromEnv } from "../consent";
import { loadPrivateAdSurface } from "../app-surface";
import {
  privateHilltopAllowed,
  privatePopunderAllowed,
  privateSurfaceAllows,
} from "../private-surface-rules";
import { HilltopVastPlayer } from "../hilltop/vast-player";
import { AdsterraPopunder } from "./popunder";
import { AdsterraSocialBar } from "./social-bar";

/**
 * Mounted ad units for the authenticated app shell (owner requests 2026-10-19,
 * 2026-11-06; HilltopAds video 2026-11-11): every /app page gets the same units.
 * The in-page HilltopAds Video VAST player replaces the Adsterra native banner
 * in this top slot because the video unit needs the space; the Adsterra Social
 * Bar and popunder (independent switch) are unchanged. The 468x60 unit remains
 * registered but is intentionally unmounted (it rendered empty boxes).
 *
 * Hilltop keys on its own network gate (owner request 2026-11-12): killing or
 * disabling Adsterra in /admin/ads leaves the video unit standing, and killing
 * Hilltop leaves the Adsterra units standing — each source is judged alone.
 *
 * Mounted once in `(app)/app/layout.tsx`, so client-side navigations keep one
 * set of units instead of stacking copies. The private surface gate runs
 * server-side; /auth/* and /admin/* use different layouts and never mount this
 * component.
 */
export async function AppAdsterraUnits() {
  const surface = await loadPrivateAdSurface();
  const showHilltop = privateHilltopAllowed(surface);
  const adsterraOpen = privateSurfaceAllows(surface);
  if (!showHilltop && !adsterraOpen) return null;
  const showPopunder = adsterraOpen && privatePopunderAllowed(surface);

  return (
    <div data-testid="app-adsterra-units" className="mb-8 flex flex-col gap-6">
      {showHilltop ? <HilltopVastPlayer policyVersion={policyVersionFromEnv()} /> : null}
      {adsterraOpen ? <AdsterraSocialBar /> : null}
      {showPopunder ? <AdsterraPopunder /> : null}
    </div>
  );
}
