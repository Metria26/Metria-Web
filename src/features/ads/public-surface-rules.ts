import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  type AdConfigSnapshot,
  type AdKillState,
} from "./contracts";

/**
 * Pure public-surface gate (SS11). Kept free of `next/headers`, Supabase and
 * env imports so it is unit-testable; `public-surface.ts` adds request scope
 * (cookies + tenant lookup + config/kill-state fetch) on top of these functions.
 *
 * Gate order mirrors `resolver.ts`: master flag -> master kill flag -> public
 * layer -> global kill row -> page type -> network registry + per-network kill.
 * Consent is checked separately by `publicSurfaceAllows` so the consent banner
 * can stay mounted while consent is still undecided. Malformed payloads fail
 * closed.
 */

export type PublicAdSurface = {
  /** Master flag on, no global kill, public layer enabled, Adsterra live. */
  open: boolean;
  /** Independent HilltopAds gate (owner request 2026-11-12). */
  hilltopOpen: boolean;
  /** Independent popunder switch (ADR-013); absent flag fails closed. */
  popunderEnabled: boolean;
  consentGranted: boolean;
  universityId: string | null;
  killState: AdKillState | null;
  config: AdConfigSnapshot | null;
};

export const ADSTERRA_NETWORK_KEY = "adsterra";
/** HilltopAds video network key; kill/enable switches are independent (2026-11-12). */
export const HILLTOP_NETWORK_KEY = "hilltop";
/** Landing + legal pages share the seeded `public_home` page type. */
export const PUBLIC_PAGE_TYPE = "public_home";

/**
 * One network's public gate: master flag -> master kill flag -> public layer
 * -> page type -> network registry + per-network kill. Shared by the Adsterra
 * `open` and the independent Hilltop `hilltopOpen` so the two sources can be
 * killed separately.
 */
function publicNetworkOpen(
  state: AdKillState,
  config: AdConfigSnapshot,
  networkKey: string,
): boolean {
  const pageType = config.page_types.find((entry) => entry.key === PUBLIC_PAGE_TYPE);
  const network = config.networks.find((entry) => entry.key === networkKey);
  return (
    state.flags.enabled &&
    !state.flags.global_kill &&
    !state.global &&
    state.flags.public_enabled &&
    Boolean(pageType?.enabled) &&
    pageType?.is_auth === false &&
    Boolean(network?.enabled) &&
    !state.killed_networks.includes(networkKey)
  );
}

export function evaluatePublicSurface(input: {
  universityId: string | null;
  killState: unknown;
  config: unknown;
  consentGranted: boolean;
}): PublicAdSurface {
  const kill = adKillStateSchema.safeParse(input.killState);
  const config = adConfigSnapshotSchema.safeParse(input.config);
  if (!input.universityId || !kill.success || !config.success) {
    return {
      open: false,
      hilltopOpen: false,
      popunderEnabled: false,
      consentGranted: input.consentGranted,
      universityId: input.universityId,
      killState: null,
      config: null,
    };
  }
  const state = kill.data;
  return {
    open: publicNetworkOpen(state, config.data, ADSTERRA_NETWORK_KEY),
    hilltopOpen: publicNetworkOpen(state, config.data, HILLTOP_NETWORK_KEY),
    popunderEnabled: state.flags.popunder_enabled,
    consentGranted: input.consentGranted,
    universityId: input.universityId,
    killState: state,
    config: config.data,
  };
}

/** True when a unit may render: surface open, consent granted, path approved. */
export function publicSurfaceAllows(
  surface: PublicAdSurface,
  pathname: string,
  allowed: (pathname: string) => boolean,
): boolean {
  return surface.open && surface.consentGranted && allowed(pathname);
}

/**
 * Per-network kill switch, exposed separately so tests can prove precedence
 * even when the rest of the surface is open.
 */
export function networkNotKilled(
  surface: PublicAdSurface,
  networkKey: string = ADSTERRA_NETWORK_KEY,
): boolean {
  return !surface.killState?.killed_networks.includes(networkKey);
}

/** Full unit gate: open surface + consent + network not killed + path allowlist. */
export function publicUnitAllowed(
  surface: PublicAdSurface,
  pathname: string,
  allowed: (pathname: string) => boolean,
  networkKey: string = ADSTERRA_NETWORK_KEY,
): boolean {
  return publicSurfaceAllows(surface, pathname, allowed) && networkNotKilled(surface, networkKey);
}

/** Popunder adds its independent switch on top of the normal unit gate. */
export function publicPopunderAllowed(
  surface: PublicAdSurface,
  pathname: string,
  allowed: (pathname: string) => boolean,
): boolean {
  return surface.popunderEnabled && publicUnitAllowed(surface, pathname, allowed);
}

/** Hilltop unit gate: hilltop surface + consent + path allowlist (2026-11-12). */
export function publicHilltopAllowed(
  surface: PublicAdSurface,
  pathname: string,
  allowed: (pathname: string) => boolean,
): boolean {
  return surface.hilltopOpen && surface.consentGranted && allowed(pathname);
}
