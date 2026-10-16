import type { AdPlacement } from "./contracts";

/**
 * Pure resolver rules (T-B002). The database owns config and kill state; these
 * helpers order eligible placements and enforce the D13 frequency cap. The
 * window/cap values mirror docs/DECISIONS.md D13 (one pop-style unit per page,
 * one per user per 24h) and the ad-system spec.
 */

/** D13: pop-style units are capped at one per user per 24 hours. */
export const POP_STYLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Deterministic unit order: priority desc, then stable key order. */
export function orderPlacements(placements: AdPlacement[]): AdPlacement[] {
  return [...placements].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.slot_key.localeCompare(b.slot_key) ||
      a.network.localeCompare(b.network) ||
      a.format.localeCompare(b.format),
  );
}

/** True when the visitor may be shown a pop-style unit again (D13, first-party state only). */
export function popStyleAllowed(recentPopStyleAt: number | null, now: number): boolean {
  if (recentPopStyleAt === null) return true;
  return now - recentPopStyleAt >= POP_STYLE_WINDOW_MS;
}
