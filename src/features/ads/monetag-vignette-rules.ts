/**
 * Pure path and surface rules for the Monetag Vignette Banner.
 *
 * The loader is mounted once in the root layout, so the browser-side pathname
 * is the final route gate. Auth/admin routes and the marks/marksheet/bookings
 * routes are excluded per R1/R3 and the ads-safety e2e suite. The same rules
 * are re-checked by the gate endpoint; malformed or missing data fails closed.
 *
 * Kept free of React, `next/*`, Supabase and DOM imports so the boundary is
 * unit-testable. The request-scoped surface itself comes from the existing
 * `public-surface.ts` / `app-surface.ts` helpers.
 */

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "/";
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? "/";
  const normalized = withoutQuery.replace(/\/+$/, "");
  return normalized || "/";
}

/** False on every route that must stay free of ad scripts. */
export function isMonetagVignettePathAllowed(pathname: string): boolean {
  const normalized = normalizePathname(pathname);

  if (normalized === "/auth" || normalized.startsWith("/auth/")) return false;
  if (normalized === "/admin" || normalized.startsWith("/admin/")) return false;
  if (normalized.startsWith("/app/marks")) return false;
  if (/^\/app\/offerings\/[^/]+\/marksheet(?:\/|$)/.test(normalized)) return false;
  if (normalized.startsWith("/app/bookings")) return false;

  return true;
}

/** The existing authenticated surface owns /app; everything else is public. */
export function monetagVignetteSurface(pathname: string): "private" | "public" {
  const normalized = normalizePathname(pathname);
  return normalized === "/app" || normalized.startsWith("/app/") ? "private" : "public";
}

/** Full loader gate: approved path + open surface + ads consent. */
export function monetagVignetteAllowed(input: {
  pathname: string;
  surfaceOpen: boolean;
  consentGranted: boolean;
}): boolean {
  return isMonetagVignettePathAllowed(input.pathname) && input.surfaceOpen && input.consentGranted;
}
