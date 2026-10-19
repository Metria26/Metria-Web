import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  type AdConfigSnapshot,
  type AdKillState,
} from "./contracts";
import { ADSTERRA_NETWORK_KEY } from "./public-surface-rules";

/**
 * Authenticated (private) Adsterra surface gate for the app shell.
 *
 * The public gate (`public-surface-rules.ts`) is path oriented because
 * anonymous pages have no session. The app shell already sits behind auth and
 * is mounted once in `(app)/app/layout.tsx`, so this gate checks the same
 * kill/network/consent boundaries without a page-type lookup: every route in
 * the shell is authenticated, and per-page placement rules still live in the
 * resolver for the reserved sponsor slots.
 *
 * Kept pure so it can be unit-tested; `app-surface.ts` adds request scope
 * (session, cookies, config/kill-state fetches). Malformed payloads fail
 * closed, matching the public surface and the resolver.
 */

export type PrivateAdSurface = {
  /** Master flag on, no global kill, private layer enabled, network live. */
  open: boolean;
  consentGranted: boolean;
  universityId: string | null;
  killState: AdKillState | null;
  config: AdConfigSnapshot | null;
};

export function evaluatePrivateSurface(input: {
  universityId: string | null;
  killState: unknown;
  config: unknown;
  consentGranted: boolean;
  authenticated: boolean;
}): PrivateAdSurface {
  const kill = adKillStateSchema.safeParse(input.killState);
  const config = adConfigSnapshotSchema.safeParse(input.config);
  if (!input.authenticated || !input.universityId || !kill.success || !config.success) {
    return {
      open: false,
      consentGranted: input.consentGranted,
      universityId: input.universityId,
      killState: null,
      config: null,
    };
  }

  const state = kill.data;
  const network = config.data.networks.find((entry) => entry.key === ADSTERRA_NETWORK_KEY);
  const hasEnabledPageType = config.data.page_types.some(
    (entry) => entry.enabled && !entry.is_auth,
  );
  const open =
    state.flags.enabled &&
    !state.flags.global_kill &&
    !state.global &&
    state.flags.private_enabled &&
    hasEnabledPageType &&
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

/** True when the app shell may mount ad units: surface open and consent given. */
export function privateSurfaceAllows(surface: PrivateAdSurface): boolean {
  return surface.open && surface.consentGranted;
}
