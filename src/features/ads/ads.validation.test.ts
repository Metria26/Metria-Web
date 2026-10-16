import { beforeEach, describe, expect, it } from "vitest";
import {
  adConfigSnapshotSchema,
  adKillStateSchema,
  resolverContextSchema,
  type AdConfigSnapshot,
  type AdKillState,
  type AdPlacement,
  type ResolverContext,
} from "./contracts";
import { resolveAdUnits } from "./resolver";
import { POP_STYLE_WINDOW_MS, orderPlacements, popStyleAllowed } from "./rules";
import {
  defaultConsent,
  hasCurrentConsent,
  parseConsentCookie,
  regionClass,
  serializeConsentState,
} from "./consent";
import {
  newVisitorId,
  parseVisitorCookie,
  serializeVisitorState,
  visitorForContext,
  withPopStyleShown,
} from "./visitor";
import {
  clearAdCaches,
  configTtlSeconds,
  killTtlSeconds,
  loadAdConfig,
  loadAdContext,
  type RpcCaller,
} from "./config";

/**
 * T-B002 unit boundary: resolver gates, consent/visitor cookies and the
 * server-side loader cache. The database re-checks its own invariants (see the
 * monetization_ads migration and its pgTAP file); these tests pin the pure
 * behaviour every page render depends on.
 */

const baseConfig: AdConfigSnapshot = {
  source: "live",
  version: 0,
  page_types: [
    { key: "dashboard", is_auth: false, enabled: true },
    { key: "disabled_page", is_auth: false, enabled: false },
    { key: "login", is_auth: true, enabled: false },
  ],
  formats: [
    { key: "banner", is_pop_style: false, needs_consent: true, injection_mode: "script_async" },
    { key: "pop_under", is_pop_style: true, needs_consent: true, injection_mode: "script_pop" },
    {
      key: "direct_sponsor",
      is_pop_style: false,
      needs_consent: false,
      injection_mode: "first_party",
    },
  ],
  networks: [
    { key: "adsterra", name: "Adsterra", enabled: true },
    { key: "paused", name: "Paused Net", enabled: false },
  ],
  placements: [
    {
      slot_key: "dashboard-top",
      page_type: "dashboard",
      network: "adsterra",
      format: "banner",
      enabled: true,
      priority: 10,
      frequency_cap: null,
      isolation_mode: "no_script_ads",
    },
    {
      slot_key: "dashboard-top",
      page_type: "dashboard",
      network: "paused",
      format: "banner",
      enabled: true,
      priority: 20,
      frequency_cap: null,
      isolation_mode: "iframe_only",
    },
    {
      slot_key: "dashboard-top",
      page_type: "dashboard",
      network: "adsterra",
      format: "banner",
      enabled: false,
      priority: 40,
      frequency_cap: null,
      isolation_mode: "iframe_only",
    },
    {
      slot_key: "dashboard-pop",
      page_type: "dashboard",
      network: "adsterra",
      format: "pop_under",
      enabled: true,
      priority: 30,
      frequency_cap: 1,
      isolation_mode: "iframe_only",
    },
    {
      slot_key: "dashboard-pop",
      page_type: "dashboard",
      network: "adsterra",
      format: "pop_under",
      enabled: true,
      priority: 25,
      frequency_cap: 1,
      isolation_mode: "iframe_only",
    },
    {
      slot_key: "sponsor-slot",
      page_type: "dashboard",
      network: "adsterra",
      format: "direct_sponsor",
      enabled: true,
      priority: 5,
      frequency_cap: null,
      isolation_mode: "no_script_ads",
    },
    {
      slot_key: "login-banner",
      page_type: "login",
      network: "adsterra",
      format: "banner",
      enabled: true,
      priority: 50,
      frequency_cap: null,
      isolation_mode: "no_script_ads",
    },
  ],
};

const baseKill: AdKillState = {
  flags: { enabled: true, public_enabled: true, private_enabled: true, global_kill: false },
  global: false,
  killed_networks: [],
};

const baseContext: ResolverContext = {
  pageType: "dashboard",
  slotKey: "dashboard-top",
  authenticated: false,
  device: "desktop",
  consent: { analytics: false, ads: true },
  recentPopStyleAt: null,
};

function resolve(
  overrides: {
    config?: Partial<AdConfigSnapshot>;
    kill?: Partial<AdKillState>;
    context?: Partial<ResolverContext>;
  } = {},
) {
  return resolveAdUnits({
    config: { ...baseConfig, ...overrides.config },
    killState: { ...baseKill, ...overrides.kill },
    context: { ...baseContext, ...overrides.context },
  });
}

beforeEach(() => {
  clearAdCaches();
});

describe("resolver contracts", () => {
  it("accepts the fixture config and strips unknown keys", () => {
    const parsed = adConfigSnapshotSchema.safeParse({ ...baseConfig, extra: "dropped" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("extra" in parsed.data).toBe(false);
  });

  it("rejects an unknown snapshot source", () => {
    expect(adConfigSnapshotSchema.safeParse({ ...baseConfig, source: "cache" }).success).toBe(
      false,
    );
  });

  it("requires the full kill state shape", () => {
    const parsed = adKillStateSchema.safeParse({ flags: { enabled: true }, global: false });
    expect(parsed.success).toBe(false);
  });

  it("applies context defaults for device and pop timestamp", () => {
    const parsed = resolverContextSchema.safeParse({
      pageType: "dashboard",
      slotKey: "dashboard-top",
      authenticated: false,
      consent: { analytics: false, ads: false },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.device).toBe("desktop");
      expect(parsed.data.recentPopStyleAt).toBeNull();
    }
  });
});

describe("resolver gates", () => {
  it("resolves an eligible unit when every gate is open", () => {
    const units = resolve();
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      slotKey: "dashboard-top",
      network: "adsterra",
      networkName: "Adsterra",
      format: "banner",
      isPopStyle: false,
      injectionMode: "script_async",
      isolationMode: "no_script_ads",
      priority: 10,
    });
  });

  it("stays dark when ads.enabled is false", () => {
    expect(resolve({ kill: { flags: { ...baseKill.flags, enabled: false } } })).toEqual([]);
  });

  it("stays dark when the master kill flag is on", () => {
    expect(resolve({ kill: { flags: { ...baseKill.flags, global_kill: true } } })).toEqual([]);
  });

  it("honours the public layer switch for anonymous visitors", () => {
    expect(resolve({ kill: { flags: { ...baseKill.flags, public_enabled: false } } })).toEqual([]);
  });

  it("honours the private layer switch for authenticated visitors", () => {
    expect(
      resolve({
        kill: { flags: { ...baseKill.flags, private_enabled: false } },
        context: { authenticated: true },
      }),
    ).toEqual([]);
  });

  it("serves authenticated visitors when the private layer is on", () => {
    const units = resolve({
      kill: { flags: { ...baseKill.flags, public_enabled: false } },
      context: { authenticated: true },
    });
    expect(units).toHaveLength(1);
  });

  it("stays dark when the university kill switch row is on", () => {
    expect(resolve({ kill: { global: true } })).toEqual([]);
  });

  it("drops killed networks", () => {
    expect(resolve({ kill: { killed_networks: ["adsterra"] } })).toEqual([]);
  });

  it("rejects unknown, disabled and auth page types", () => {
    expect(resolve({ context: { pageType: "nope" } })).toEqual([]);
    expect(resolve({ context: { pageType: "disabled_page" } })).toEqual([]);
    expect(resolve({ context: { pageType: "login", slotKey: "login-banner" } })).toEqual([]);
  });

  it("rejects a slot with no matching placement", () => {
    expect(resolve({ context: { slotKey: "other-slot" } })).toEqual([]);
  });

  it("drops placements whose network is disabled or unknown", () => {
    const units = resolve();
    expect(units.every((unit) => unit.network === "adsterra")).toBe(true);
  });

  it("drops disabled placements even at higher priority", () => {
    const units = resolve();
    expect(units).toHaveLength(1);
    expect(units[0]?.priority).toBe(10);
  });

  it("requires consent for formats that declare it", () => {
    expect(resolve({ context: { consent: { analytics: false, ads: false } } })).toEqual([]);
  });

  it("serves no-consent formats without the ads category", () => {
    const units = resolve({
      context: { slotKey: "sponsor-slot", consent: { analytics: false, ads: false } },
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.format).toBe("direct_sponsor");
  });

  it("caps pop-style units at one per page (highest priority wins)", () => {
    const units = resolve({ context: { slotKey: "dashboard-pop" } });
    expect(units).toHaveLength(1);
    expect(units[0]?.priority).toBe(30);
  });

  it("blocks pop-style units inside the 24h window and allows them after it", () => {
    const now = 1_800_000_000_000;
    expect(
      resolveAdUnits({
        config: baseConfig,
        killState: baseKill,
        context: { ...baseContext, slotKey: "dashboard-pop", recentPopStyleAt: now - 1000 },
        now,
      }),
    ).toEqual([]);
    expect(
      resolveAdUnits({
        config: baseConfig,
        killState: baseKill,
        context: {
          ...baseContext,
          slotKey: "dashboard-pop",
          recentPopStyleAt: now - POP_STYLE_WINDOW_MS - 1,
        },
        now,
      }),
    ).toHaveLength(1);
  });

  it("accepts a device class without changing eligibility (no targeting column yet)", () => {
    expect(resolve({ context: { device: "mobile" } })).toHaveLength(1);
    expect(resolve({ context: { device: "tablet" } })).toHaveLength(1);
  });

  it("fails closed on malformed config, kill state or context", () => {
    expect(resolveAdUnits({ config: null, killState: baseKill, context: baseContext })).toEqual([]);
    expect(resolveAdUnits({ config: baseConfig, killState: {}, context: baseContext })).toEqual([]);
    expect(resolveAdUnits({ config: baseConfig, killState: baseKill, context: 42 })).toEqual([]);
  });
});

describe("rules", () => {
  it("orders placements by priority desc with a stable tiebreak", () => {
    const template: AdPlacement = {
      slot_key: "x",
      page_type: "dashboard",
      network: "adsterra",
      format: "banner",
      enabled: true,
      priority: 0,
      frequency_cap: null,
      isolation_mode: "no_script_ads",
    };
    const ordered = orderPlacements([
      { ...template, slot_key: "b", priority: 5 },
      { ...template, slot_key: "a", priority: 5 },
      { ...template, slot_key: "c", priority: 9 },
    ]);
    expect(ordered.map((placement) => placement.slot_key)).toEqual(["c", "a", "b"]);
  });

  it("popStyleAllowed respects the 24h boundary", () => {
    const now = 1_800_000_000_000;
    expect(popStyleAllowed(null, now)).toBe(true);
    expect(popStyleAllowed(now - POP_STYLE_WINDOW_MS, now)).toBe(true);
    expect(popStyleAllowed(now - POP_STYLE_WINDOW_MS + 1, now)).toBe(false);
    expect(popStyleAllowed(now, now)).toBe(false);
  });
});

describe("consent", () => {
  it("defaults deny every non-necessary category", () => {
    expect(defaultConsent("v1")).toEqual({
      policyVersion: "v1",
      categories: { analytics: false, ads: false },
    });
  });

  it("parses missing, malformed and stale cookies as defaults", () => {
    expect(parseConsentCookie(null, "v1").categories.ads).toBe(false);
    expect(parseConsentCookie("{oops", "v1").categories.ads).toBe(false);
    expect(
      parseConsentCookie(
        serializeConsentState({ policyVersion: "v0", categories: { analytics: true, ads: true } }),
        "v1",
      ).categories.ads,
    ).toBe(false);
  });

  it("round-trips a current consent state", () => {
    const state = { policyVersion: "v1", categories: { analytics: true, ads: true } };
    expect(parseConsentCookie(serializeConsentState(state), "v1")).toEqual(state);
    expect(hasCurrentConsent(serializeConsentState(state), "v1")).toBe(true);
    expect(hasCurrentConsent(serializeConsentState(state), "v2")).toBe(false);
  });

  it("classifies regions for the conservative-default policy hook", () => {
    expect(regionClass("de")).toBe("eea");
    expect(regionClass("NO")).toBe("eea");
    expect(regionClass("GB")).toBe("uk");
    expect(regionClass("ch")).toBe("ch");
    expect(regionClass("US")).toBe("other");
    expect(regionClass(null)).toBe("other");
  });
});

describe("visitor", () => {
  it("parses missing and malformed cookies as null", () => {
    expect(parseVisitorCookie(null)).toBeNull();
    expect(parseVisitorCookie("not json")).toBeNull();
    expect(parseVisitorCookie('{"popStyleShownAt": 1}')).toBeNull();
    expect(parseVisitorCookie('{"id": ""}')).toBeNull();
  });

  it("round-trips visitor state and normalises a bad timestamp", () => {
    const state = { id: "abc", popStyleShownAt: 1234 };
    expect(parseVisitorCookie(serializeVisitorState(state))).toEqual(state);
    expect(parseVisitorCookie('{"id":"abc","popStyleShownAt":"soon"}')).toEqual({
      id: "abc",
      popStyleShownAt: null,
    });
  });

  it("generates a random id only when needed", () => {
    expect(newVisitorId(() => "fixed-id")).toBe("fixed-id");
    expect(
      visitorForContext(serializeVisitorState({ id: "kept", popStyleShownAt: null }), () => "x"),
    ).toEqual({
      id: "kept",
      popStyleShownAt: null,
    });
    expect(visitorForContext(null, () => "fresh")).toEqual({ id: "fresh", popStyleShownAt: null });
  });

  it("records the pop-style timestamp without touching the id", () => {
    expect(withPopStyleShown({ id: "abc", popStyleShownAt: null }, 99)).toEqual({
      id: "abc",
      popStyleShownAt: 99,
    });
  });
});

describe("config loader", () => {
  function fakeCaller(data: unknown, error: { message: string } | null = null) {
    const calls: string[] = [];
    const caller: RpcCaller = {
      rpc: (fn) => {
        calls.push(fn);
        return Promise.resolve({ data, error });
      },
    };
    return { caller, calls };
  }

  it("clamps the config TTL to the documented 60 second maximum", () => {
    expect(configTtlSeconds({})).toBe(60);
    expect(configTtlSeconds({ AD_CONFIG_CACHE_TTL_SECONDS: "30" })).toBe(30);
    expect(configTtlSeconds({ AD_CONFIG_CACHE_TTL_SECONDS: "600" })).toBe(60);
    expect(configTtlSeconds({ AD_CONFIG_CACHE_TTL_SECONDS: "nope" })).toBe(60);
  });

  it("keeps the kill state TTL shorter than the config TTL", () => {
    expect(killTtlSeconds({})).toBe(15);
    expect(killTtlSeconds({ AD_CONFIG_CACHE_TTL_SECONDS: "5" })).toBe(5);
  });

  it("caches config per university and refetches after the TTL", async () => {
    const { caller, calls } = fakeCaller(baseConfig);
    const now = 1_000_000;
    await loadAdConfig(caller, "uni-1", { now });
    await loadAdConfig(caller, "uni-1", { now: now + 30_000 });
    expect(calls).toHaveLength(1);
    await loadAdConfig(caller, "uni-2", { now });
    expect(calls).toHaveLength(2);
    await loadAdConfig(caller, "uni-1", { now: now + 60_001 });
    expect(calls).toHaveLength(3);
  });

  it("fails closed and caches null on RPC errors or malformed payloads", async () => {
    const failed = fakeCaller(null, { message: "boom" });
    expect(await loadAdConfig(failed.caller, "uni-fail")).toBeNull();
    const malformed = fakeCaller({ nope: true });
    expect(await loadAdConfig(malformed.caller, "uni-malformed")).toBeNull();
    expect(malformed.calls).toHaveLength(1);
  });

  it("loads config and kill state together", async () => {
    const caller: RpcCaller = {
      rpc: (fn) =>
        Promise.resolve({
          data: fn === "ad_config_snapshot" ? baseConfig : baseKill,
          error: null,
        }),
    };
    const { config, killState } = await loadAdContext(caller, "uni-1");
    expect(config?.page_types).toHaveLength(3);
    expect(killState?.flags.global_kill).toBe(false);
  });
});
