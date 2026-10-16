import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  resolverContextSchema,
  type AdConfigSnapshot,
  type AdKillState,
  type ResolverContext,
} from "./contracts";
import { orderPlacements, popStyleAllowed } from "./rules";

/**
 * Pure ad resolver (T-B002). Input mirrors the ad-system spec: page type, slot,
 * consent state, authenticated context and device class. Gates run in the
 * documented order: feature flag -> master kill -> layer switch -> university
 * kill switch -> page type (auth pages never serve ads, R3) -> placement
 * enablement -> network registry/kill -> consent -> D13 pop cap. Malformed
 * config/kill-state/context fails closed (empty result).
 */

export type AdUnit = {
  slotKey: string;
  pageType: string;
  network: string;
  networkName: string;
  format: string;
  isPopStyle: boolean;
  injectionMode: string;
  isolationMode: string;
  priority: number;
  frequencyCap: number | null;
};

export type ResolveAdUnitsInput = {
  config: unknown;
  killState: unknown;
  context: unknown;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
};

export function resolveAdUnits(input: ResolveAdUnitsInput): AdUnit[] {
  const config = adConfigSnapshotSchema.safeParse(input.config);
  const killState = adKillStateSchema.safeParse(input.killState);
  const context = resolverContextSchema.safeParse(input.context);
  if (!config.success || !killState.success || !context.success) return [];

  const snapshot: AdConfigSnapshot = config.data;
  const kill: AdKillState = killState.data;
  const ctx: ResolverContext = context.data;
  const now = input.now ?? Date.now();

  // Ads stay dark unless the platform flag is on and no master kill is active.
  if (!kill.flags.enabled || kill.flags.global_kill) return [];

  // Layer switch: public (anonymous) vs private (authenticated) surfaces.
  if (ctx.authenticated ? !kill.flags.private_enabled : !kill.flags.public_enabled) return [];

  // University-wide emergency kill switch.
  if (kill.global) return [];

  // Registered page type must exist, be enabled and not be an auth page (R3).
  const pageType = snapshot.page_types.find((entry) => entry.key === ctx.pageType);
  if (!pageType || !pageType.enabled || pageType.is_auth) return [];

  const formats = new Map(snapshot.formats.map((format) => [format.key, format]));
  const networks = new Map(snapshot.networks.map((network) => [network.key, network]));

  const candidates = snapshot.placements.filter((placement) => {
    if (!placement.enabled) return false;
    if (placement.page_type !== ctx.pageType || placement.slot_key !== ctx.slotKey) return false;
    const network = networks.get(placement.network);
    if (!network || !network.enabled) return false;
    if (kill.killed_networks.includes(placement.network)) return false;
    const format = formats.get(placement.format);
    if (!format) return false;
    if (format.needs_consent && !ctx.consent.ads) return false;
    return true;
  });

  const ordered = orderPlacements(candidates);
  const popAllowed = popStyleAllowed(ctx.recentPopStyleAt, now);
  let popTaken = false;
  const units: AdUnit[] = [];
  for (const placement of ordered) {
    const format = formats.get(placement.format);
    if (!format) continue;
    // D13: at most one pop-style unit per page, one per user per 24h.
    if (format.is_pop_style) {
      if (!popAllowed || popTaken) continue;
      popTaken = true;
    }
    units.push({
      slotKey: placement.slot_key,
      pageType: placement.page_type,
      network: placement.network,
      networkName: networks.get(placement.network)?.name ?? placement.network,
      format: placement.format,
      isPopStyle: format.is_pop_style,
      injectionMode: format.injection_mode,
      // Isolation mode travels with the unit; the renderer (T-B003) honours it.
      isolationMode: placement.isolation_mode,
      priority: placement.priority,
      frequencyCap: placement.frequency_cap,
    });
  }
  return units;
}
