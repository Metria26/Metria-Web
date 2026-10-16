import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  type AdConfigSnapshot,
  type AdKillState,
} from "./contracts";

/**
 * Server-side loader for resolver inputs (T-B002). Config and kill state are
 * cached separately: config TTL is capped at the documented 60 seconds
 * (ad-system spec) and kill state uses a shorter TTL so emergency kills land
 * fast; every page load re-resolves against these caches ("client rechecks on
 * next page load"). Failures cache as null — ads fail closed.
 */

type RpcResult = { data: unknown; error: { message: string } | null };
export type RpcCaller = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export const DEFAULT_CONFIG_TTL_SECONDS = 60;
export const MAX_CONFIG_TTL_SECONDS = 60;
export const MAX_KILL_TTL_SECONDS = 15;

export function configTtlSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AD_CONFIG_CACHE_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CONFIG_TTL_SECONDS;
  return Math.min(Math.floor(raw), MAX_CONFIG_TTL_SECONDS);
}

export function killTtlSeconds(env: Record<string, string | undefined> = process.env): number {
  return Math.min(MAX_KILL_TTL_SECONDS, configTtlSeconds(env));
}

type CacheEntry = { value: unknown; expiresAt: number };
const configCache = new Map<string, CacheEntry>();
const killCache = new Map<string, CacheEntry>();

export function clearAdCaches(): void {
  configCache.clear();
  killCache.clear();
}

type LoadOptions = {
  now?: number;
  env?: Record<string, string | undefined>;
};

async function loadCached(
  cache: Map<string, CacheEntry>,
  key: string,
  ttlSeconds: number,
  now: number,
  fetchValue: () => Promise<unknown>,
): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await fetchValue();
  cache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  return value;
}

export async function loadAdConfig(
  caller: RpcCaller,
  universityId: string,
  options?: LoadOptions,
): Promise<AdConfigSnapshot | null> {
  const now = options?.now ?? Date.now();
  const value = await loadCached(
    configCache,
    universityId,
    configTtlSeconds(options?.env),
    now,
    async () => {
      const { data, error } = await caller.rpc("ad_config_snapshot", {
        p_university_id: universityId,
      });
      if (error) return null;
      const parsed = adConfigSnapshotSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
  return (value as AdConfigSnapshot | null) ?? null;
}

export async function loadAdKillState(
  caller: RpcCaller,
  universityId: string,
  options?: LoadOptions,
): Promise<AdKillState | null> {
  const now = options?.now ?? Date.now();
  const value = await loadCached(
    killCache,
    universityId,
    killTtlSeconds(options?.env),
    now,
    async () => {
      const { data, error } = await caller.rpc("ad_kill_state", {
        p_university_id: universityId,
      });
      if (error) return null;
      const parsed = adKillStateSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
  return (value as AdKillState | null) ?? null;
}

export async function loadAdContext(
  caller: RpcCaller,
  universityId: string,
  options?: LoadOptions,
): Promise<{ config: AdConfigSnapshot | null; killState: AdKillState | null }> {
  const [config, killState] = await Promise.all([
    loadAdConfig(caller, universityId, options),
    loadAdKillState(caller, universityId, options),
  ]);
  return { config, killState };
}
