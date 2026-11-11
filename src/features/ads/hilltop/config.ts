/**
 * HilltopAds Video VAST registry (2026-11-11).
 *
 * The VAST tag is a PUBLIC ad URL, not a secret, and stays a reviewed code
 * constant (ADR-008) like the Adsterra units. It is requested directly from the
 * visitor's browser: ad networks geo-target and cap impressions by the viewer
 * IP, so proxying the tag through our server would mis-target creatives and
 * risk invalid traffic.
 *
 * The player replaces the Adsterra native banner at its three review-approved
 * mounts (landing, legal/trust pages, authenticated app shell) because the
 * video unit needs that in-page space. Social Bar and Popunder mounts are
 * unchanged. Auth/admin surfaces never import this module's player.
 *
 * Path gate (R1/R3): only the public landing/legal pages and the authenticated
 * /app shell may run the player; everything else fails closed. The marksheet
 * already keeps sensitive values behind tap-to-reveal while any ad surface is
 * open, so the video unit follows the same shell-level rules as before.
 */

export const HILLTOP_VAST_TAG_URL =
  "https://expensive-pollution.com/djmjF.zSdzGMNGvsZ-G/UQ/Aedm/9xuxZRUjl_kSPOT/cW2JMUTLcX4-M/DxEltoNBzNYLxzNkzCgnwCNBQy";

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "/";
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? "/";
  const normalized = withoutQuery.replace(/\/+$/, "");
  return normalized || "/";
}

/** True on the landing page, legal/trust pages and the authenticated shell. */
export function isHilltopVastPathAllowed(pathname: string): boolean {
  const normalized = normalizePathname(pathname);

  if (normalized === "/") return true;
  if (
    normalized === "/privacy" ||
    normalized === "/terms" ||
    normalized === "/about" ||
    normalized === "/contact"
  ) {
    return true;
  }
  if (normalized === "/app" || normalized.startsWith("/app/")) return true;

  return false;
}
