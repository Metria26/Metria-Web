import { describe, expect, it } from "vitest";
import {
  ADSTERRA_UNITS,
  BANNER_468_MESSAGE_SOURCE,
  buildBanner468SrcDoc,
  isAdsterraPathAllowed,
} from "./config";
import {
  ADSTERRA_NETWORK_KEY,
  evaluatePublicSurface,
  networkNotKilled,
  publicPopunderAllowed,
  publicSurfaceAllows,
  publicUnitAllowed,
} from "../public-surface-rules";
import type { AdConfigSnapshot, AdKillState } from "../contracts";

/**
 * SS11 unit boundary: the reviewed Adsterra registry (exact unit codes/hosts,
 * forbidden units absent), the hard path allowlist, the 468x60 srcDoc builder,
 * and the pure public-surface gate (flags/kill/page-type/network/consent order,
 * fail closed).
 */

const OPEN_KILL: AdKillState = {
  flags: {
    enabled: true,
    public_enabled: true,
    private_enabled: true,
    popunder_enabled: true,
    global_kill: false,
  },
  global: false,
  killed_networks: [],
};

const OPEN_CONFIG: AdConfigSnapshot = {
  source: "live",
  version: 0,
  page_types: [{ key: "public_home", is_auth: false, enabled: true }],
  formats: [
    { key: "banner", is_pop_style: false, needs_consent: true, injection_mode: "script_async" },
  ],
  networks: [{ key: "adsterra", name: "Adsterra", enabled: true }],
  placements: [
    {
      slot_key: "landing-top",
      page_type: "public_home",
      network: "adsterra",
      format: "banner",
      enabled: true,
      priority: 10,
      frequency_cap: null,
      isolation_mode: "iframe_only",
    },
  ],
};

const base = {
  universityId: "u1",
  killState: OPEN_KILL,
  config: OPEN_CONFIG,
  consentGranted: true,
};

describe("adsterra config", () => {
  it("registers exactly the four approved units with reviewed hosts", () => {
    expect(Object.keys(ADSTERRA_UNITS).sort()).toEqual([
      "banner_468",
      "native_banner",
      "popunder",
      "social_bar",
    ]);
    for (const key of ["native_banner", "social_bar", "banner_468"] as const) {
      expect(ADSTERRA_UNITS[key].scriptUrl.startsWith("https://bauval.org/")).toBe(true);
    }
    expect(ADSTERRA_UNITS.popunder.scriptUrl).toBe(
      "https://abscloud.org/1/d5d5a4efeec12f60a2b9db7ddf75914b",
    );
    expect(ADSTERRA_UNITS.native_banner.unitId).toBe("31803282");
    expect(ADSTERRA_UNITS.social_bar.unitId).toBe("31803283");
    expect(ADSTERRA_UNITS.banner_468.unitId).toBe("31803284");
    expect(ADSTERRA_UNITS.popunder.unitId).toBe("popunder");
  });

  it("never registers smartlink", () => {
    const serialized = JSON.stringify(ADSTERRA_UNITS);
    expect(serialized).not.toContain("araplhn.org");
    expect(serialized).not.toContain("pop_under");
    expect(serialized).not.toContain("smartlink");
  });

  it("allows units only on their reviewed paths", () => {
    expect(isAdsterraPathAllowed("banner_468", "/")).toBe(true);
    expect(isAdsterraPathAllowed("banner_468", "/about")).toBe(false);
    expect(isAdsterraPathAllowed("social_bar", "/privacy")).toBe(false);
    expect(isAdsterraPathAllowed("native_banner", "/privacy")).toBe(true);
    expect(isAdsterraPathAllowed("native_banner", "/terms")).toBe(true);
    expect(isAdsterraPathAllowed("popunder", "/")).toBe(true);
    expect(isAdsterraPathAllowed("popunder", "/privacy")).toBe(true);
    expect(isAdsterraPathAllowed("popunder", "/terms")).toBe(true);
    expect(isAdsterraPathAllowed("popunder", "/about")).toBe(true);
    expect(isAdsterraPathAllowed("popunder", "/contact")).toBe(true);
    // Forbidden surfaces, including trailing-slash normalisation.
    expect(isAdsterraPathAllowed("native_banner", "/app")).toBe(false);
    expect(isAdsterraPathAllowed("native_banner", "/app/")).toBe(false);
    expect(isAdsterraPathAllowed("popunder", "/app")).toBe(false);
    expect(isAdsterraPathAllowed("popunder", "/auth/sign-in")).toBe(false);
    expect(isAdsterraPathAllowed("popunder", "/admin/ads")).toBe(false);
    expect(isAdsterraPathAllowed("native_banner", "/privacy/extra")).toBe(false);
  });

  it("builds a 468x60 srcDoc with atOptions and the reviewed script", () => {
    const doc = buildBanner468SrcDoc();
    expect(doc).toContain('"width":468');
    expect(doc).toContain('"height":60');
    expect(doc).toContain('"format":"iframe"');
    expect(doc).toContain(ADSTERRA_UNITS.banner_468.scriptUrl);
    expect(doc).toContain(BANNER_468_MESSAGE_SOURCE);
    expect(doc).toContain("postMessage");
    expect(doc).not.toContain("document.write");
  });
});

describe("public ad surface gate", () => {
  it("opens only when every platform gate passes", () => {
    const surface = evaluatePublicSurface(base);
    expect(surface.open).toBe(true);
    expect(surface.popunderEnabled).toBe(true);
    expect(publicSurfaceAllows(surface, "/", () => true)).toBe(true);
    expect(publicUnitAllowed(surface, "/", () => true)).toBe(true);
    expect(publicPopunderAllowed(surface, "/", () => true)).toBe(true);
  });

  it("keeps popunder independently switchable without closing other units", () => {
    const surface = evaluatePublicSurface({
      ...base,
      killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, popunder_enabled: false } },
    });
    expect(surface.open).toBe(true);
    expect(publicUnitAllowed(surface, "/", () => true)).toBe(true);
    expect(publicPopunderAllowed(surface, "/", () => true)).toBe(false);
  });

  it("fails popunder closed when the legacy kill-state omits the flag", () => {
    const legacyKill = {
      ...OPEN_KILL,
      flags: {
        enabled: true,
        public_enabled: true,
        private_enabled: true,
        global_kill: false,
      },
    };
    const surface = evaluatePublicSurface({ ...base, killState: legacyKill });
    expect(surface.open).toBe(true);
    expect(surface.popunderEnabled).toBe(false);
    expect(publicPopunderAllowed(surface, "/", () => true)).toBe(false);
  });

  it("closes on any flag or kill gate", () => {
    const cases: AdKillState[] = [
      { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, enabled: false } },
      { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, global_kill: true } },
      { ...OPEN_KILL, global: true },
      { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, public_enabled: false } },
      { ...OPEN_KILL, killed_networks: [ADSTERRA_NETWORK_KEY] },
    ];
    for (const killState of cases) {
      expect(evaluatePublicSurface({ ...base, killState }).open).toBe(false);
    }
  });

  it("closes when the page type is disabled, auth, or missing", () => {
    const variants: AdConfigSnapshot["page_types"][] = [
      [{ key: "public_home", is_auth: false, enabled: false }],
      [{ key: "public_home", is_auth: true, enabled: true }],
      [{ key: "dashboard", is_auth: false, enabled: true }],
    ];
    for (const page_types of variants) {
      const surface = evaluatePublicSurface({ ...base, config: { ...OPEN_CONFIG, page_types } });
      expect(surface.open).toBe(false);
    }
  });

  it("closes when the adsterra network is disabled or absent", () => {
    const disabled = evaluatePublicSurface({
      ...base,
      config: {
        ...OPEN_CONFIG,
        networks: [{ key: "adsterra", name: "Adsterra", enabled: false }],
      },
    });
    expect(disabled.open).toBe(false);

    const absent = evaluatePublicSurface({
      ...base,
      config: { ...OPEN_CONFIG, networks: [] },
    });
    expect(absent.open).toBe(false);
  });

  it("fails closed on missing tenant, consent or malformed payloads", () => {
    // Surface can be open without consent; the unit gate still denies.
    const noConsent = evaluatePublicSurface({ ...base, consentGranted: false });
    expect(noConsent.open).toBe(true);
    expect(publicSurfaceAllows(noConsent, "/", () => true)).toBe(false);
    expect(publicUnitAllowed(noConsent, "/", () => true)).toBe(false);
    expect(publicPopunderAllowed(noConsent, "/", () => true)).toBe(false);

    expect(evaluatePublicSurface({ ...base, universityId: null }).open).toBe(false);
    expect(evaluatePublicSurface({ ...base, killState: { nope: true } }).open).toBe(false);
    expect(evaluatePublicSurface({ ...base, config: { nope: true } }).open).toBe(false);
  });

  it("honours the per-unit path guard", () => {
    const surface = evaluatePublicSurface(base);
    expect(
      publicUnitAllowed(surface, "/app", (p) => isAdsterraPathAllowed("native_banner", p)),
    ).toBe(false);
    expect(
      publicUnitAllowed(surface, "/privacy", (p) => isAdsterraPathAllowed("native_banner", p)),
    ).toBe(true);
    expect(
      publicPopunderAllowed(surface, "/app", (p) => isAdsterraPathAllowed("popunder", p)),
    ).toBe(false);
    expect(
      publicPopunderAllowed(surface, "/about", (p) => isAdsterraPathAllowed("popunder", p)),
    ).toBe(true);
    expect(networkNotKilled(surface)).toBe(true);
  });
});
