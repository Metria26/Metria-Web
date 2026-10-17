import { resolvePageAds } from "../page-ads";
import { AdSlotView } from "./ad-slot-view";

/**
 * AdSlot (T-B003, feature 10.5): server component that resolves one registered
 * slot during SSR and renders the reserved-geometry client view. Returns null
 * when ads are dark (flags off, kill active, auth page type, no session) — no
 * box, no layout difference, so pages built before T-B003 render exactly as
 * before while ads.enabled stays false. Consent and the visitor pop-cap
 * timestamp come from first-party cookies; the tenant comes from the cached
 * per-request profile lookup (see page-ads.ts).
 *
 * Mounted on: dashboard (dashboard-top), marksheet (offering-inline) and the
 * booking period page (booking-top). Never mounted on /auth/* (R3 — enforced
 * by the page-type gate as well as by not mounting there).
 */

export type AdSlotProps = {
  pageType: string;
  slotKey: string;
  /** Attach the direct-sponsor creative when one targets this page type. */
  withSponsor?: boolean;
  className?: string;
};

export async function AdSlot({ pageType, slotKey, withSponsor = false, className }: AdSlotProps) {
  const result = await resolvePageAds({
    pageType,
    slotKeys: [slotKey],
    withSponsor,
  });
  const model = result.slots[0];
  if (!result.active || !model) return null;
  return <AdSlotView model={model} consent={result.consent} className={className} />;
}
