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
  /** Master flag on, no global kill, public layer enabled. */
  open: boolean;
  consentGranted: boolean;
  universityId: string | null;
  killState: AdKillState | null;
  config: AdConfigSnapshot | null;
};

export const ADSTERRA_NETWORK_KEY = "adsterra";
/** Landing + legal pages share the seeded `public_home` page type. */
export const PUBLIC_PAGE_TYPE = "public_home";

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
      consentGranted: input.consentGranted,
      universityId: input.universityId,
      killState: null,
      config: null,
    };
  }
  const state = kill.data;
  const pageType = config.data.page_types.find((entry) => entry.key === PUBLIC_PAGE_TYPE);
  const network = config.data.networks.find((entry) => entry.key === ADSTERRA_NETWORK_KEY);
  const open =
    state.flags.enabled &&
    !state.flags.global_kill &&
    !state.global &&
    state.flags.public_enabled &&
    Boolean(pageType?.enabled) &&
    pageType?.is_auth === false &&
    Boolean(network?.enabled) &&
    !state.killed_networks.includes(ADSTERRA_NETWORK_KEY);
  return {
    open,
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
