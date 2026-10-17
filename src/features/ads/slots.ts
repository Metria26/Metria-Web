import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  type AdDevice,
  type ConsentCategories,
} from "./contracts";
import { loadAdContext, loadSponsorCreatives, type RpcCaller } from "./config";
import { resolveAdUnits, type AdUnit } from "./resolver";

/**
 * Ad slot resolution (T-B003, feature 10.5 + ADR-004/R1): decides whether a
 * page renders its reserved ad box at all ("active"), which unit the resolver
 * picked per slot, and which direct-sponsor creative (if any) fills it.
 *
 * Fail-closed rules:
 *  - config/kill payloads that fail Zod keep the page dark (active=false) and
 *    no box renders — the same "ads fail closed" contract as T-B002;
 *  - box visibility re-checks the platform flags, kill switches, layer switch
 *    and page-type gate (mirroring the resolver gate order so a slot never
 *    appears on login/auth pages — R3 — or after a kill). Unit resolution stays
 *    exclusively inside resolveAdUnits; if the two ever drift, the safe
 *    direction holds either way (box without unit = empty reserved geometry,
 *    hidden box = nothing serves);
 *  - a sponsor RPC failure or malformed payload leaves sponsor=null and the
 *    box still reserves its geometry.
 *
 * Inputs are injected (supabase caller, consent, visitor timestamp, clock) so
 * this module stays unit-testable without a request scope; the AdSlot server
 * component reads cookies/session and passes them in.
 */

export type AdSlotSponsor = {
  imageUrl: string;
  targetUrl: string;
  priority: number;
};

export type AdSlotModel = {
  slotKey: string;
  unit: AdUnit | null;
  /** Direct-sponsor creative; attached to the first requested slot only. */
  sponsor: AdSlotSponsor | null;
  /** Placement isolation mode, or the safest default when no unit resolved. */
  isolationMode: string;
};

export type ResolveAdSlotsResult = {
  active: boolean;
  /** True when sensitive page values must sit behind tap-to-reveal (R1). */
  revealValues: boolean;
  /** The consent state the resolver used — handed to the client view. */
  consent: ConsentCategories;
  slots: AdSlotModel[];
};

export type ResolveAdSlotsInput = {
  /** Real Supabase client or a test fake; cast to the RpcCaller boundary. */
  supabase: unknown;
  universityId: string;
  pageType: string;
  slotKeys: string[];
  consent: ConsentCategories;
  recentPopStyleAt?: number | null;
  withSponsor?: boolean;
  sensitive?: boolean;
  /** Mounted surfaces are authenticated (/app) unless a public page opts in. */
  authenticated?: boolean;
  device?: AdDevice;
  now?: number;
  env?: Record<string, string | undefined>;
};

const SAFE_ISOLATION = "no_script_ads";

function surfacingOpen(
  config: unknown,
  killState: unknown,
  pageType: string,
  authenticated: boolean,
): boolean {
  const parsedConfig = adConfigSnapshotSchema.safeParse(config);
  const parsedKill = adKillStateSchema.safeParse(killState);
  if (!parsedConfig.success || !parsedKill.success) return false;
  const kill = parsedKill.data;
  if (!kill.flags.enabled || kill.flags.global_kill || kill.global) return false;
  if (authenticated ? !kill.flags.private_enabled : !kill.flags.public_enabled) return false;
  const entry = parsedConfig.data.page_types.find((page) => page.key === pageType);
  return Boolean(entry && entry.enabled && !entry.is_auth);
}

function darkResult(
  slotKeys: string[],
  active: boolean,
  consent: ConsentCategories,
): ResolveAdSlotsResult {
  return {
    active,
    revealValues: false,
    consent,
    slots: slotKeys.map((slotKey) => ({
      slotKey,
      unit: null,
      sponsor: null,
      isolationMode: SAFE_ISOLATION,
    })),
  };
}

export async function resolveAdSlots(input: ResolveAdSlotsInput): Promise<ResolveAdSlotsResult> {
  const caller = input.supabase as RpcCaller;
  const authenticated = input.authenticated ?? true;
  const loadOptions = { now: input.now, env: input.env };

  const { config, killState } = await loadAdContext(caller, input.universityId, loadOptions);
  if (!surfacingOpen(config, killState, input.pageType, authenticated)) {
    return darkResult(input.slotKeys, false, input.consent);
  }

  const units = new Map<string, AdUnit>();
  for (const slotKey of input.slotKeys) {
    const resolved = resolveAdUnits({
      config,
      killState,
      context: {
        pageType: input.pageType,
        slotKey,
        authenticated,
        device: input.device ?? "desktop",
        consent: input.consent,
        recentPopStyleAt: input.recentPopStyleAt ?? null,
      },
      now: input.now,
    });
    const unit = resolved[0];
    if (unit) units.set(slotKey, unit);
  }

  let sponsor: AdSlotSponsor | null = null;
  if (input.withSponsor) {
    const read = await loadSponsorCreatives(
      caller,
      input.universityId,
      input.pageType,
      loadOptions,
    );
    const creative = read?.creatives[0];
    if (creative) {
      sponsor = {
        imageUrl: creative.image_url,
        targetUrl: creative.target_url,
        priority: creative.priority,
      };
    }
  }

  const [firstSlot] = input.slotKeys;
  const slots: AdSlotModel[] = input.slotKeys.map((slotKey) => {
    const unit = units.get(slotKey) ?? null;
    return {
      slotKey,
      unit,
      sponsor: slotKey === firstSlot ? sponsor : null,
      isolationMode: unit?.isolationMode ?? SAFE_ISOLATION,
    };
  });

  return { active: true, revealValues: Boolean(input.sensitive), consent: input.consent, slots };
}
