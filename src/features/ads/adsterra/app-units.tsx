import { loadPrivateAdSurface } from "../app-surface";
import { privateSurfaceAllows } from "../private-surface-rules";
import { AdsterraNativeBanner } from "./native-banner";
import { AdsterraSocialBar } from "./social-bar";

/**
 * Adsterra units for the authenticated app shell (owner request 2026-10-19):
 * every /app page gets the same three reviewed units — dashboard, marks,
 * courses, bookings and the new/edit forms.
 *
 * Mounted once in `(app)/app/layout.tsx`, so client-side navigations keep one
 * set of scripts and one native container instead of stacking copies. The
 * private surface gate runs server-side; /auth/* and /admin/* use different
 * layouts and never mount this component.
 */
export async function AppAdsterraUnits() {
  const surface = await loadPrivateAdSurface();
  if (!privateSurfaceAllows(surface)) return null;

  return (
    <div data-testid="app-adsterra-units" className="mb-8 flex flex-col gap-6">
      <AdsterraNativeBanner />
      <AdsterraSocialBar />
    </div>
  );
}
