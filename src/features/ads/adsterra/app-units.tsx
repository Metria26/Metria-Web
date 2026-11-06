import { loadPrivateAdSurface } from "../app-surface";
import { privatePopunderAllowed, privateSurfaceAllows } from "../private-surface-rules";
import { AdsterraNativeBanner } from "./native-banner";
import { AdsterraPopunder } from "./popunder";
import { AdsterraSocialBar } from "./social-bar";

/**
 * Adsterra units for the authenticated app shell (owner request 2026-10-19,
 * popunder 2026-11-06): every /app page gets the same mounted units —
 * dashboard, marks, courses, bookings and the new/edit forms. The 468x60 unit
 * remains registered but is intentionally unmounted (it rendered empty boxes).
 *
 * Mounted once in `(app)/app/layout.tsx`, so client-side navigations keep one
 * set of scripts and one native container instead of stacking copies. The
 * private surface gate runs server-side; /auth/* and /admin/* use different
 * layouts and never mount this component.
 */
export async function AppAdsterraUnits() {
  const surface = await loadPrivateAdSurface();
  if (!privateSurfaceAllows(surface)) return null;
  const showPopunder = privatePopunderAllowed(surface);

  return (
    <div data-testid="app-adsterra-units" className="mb-8 flex flex-col gap-6">
      <AdsterraNativeBanner />
      <AdsterraSocialBar />
      {showPopunder ? <AdsterraPopunder /> : null}
    </div>
  );
}
