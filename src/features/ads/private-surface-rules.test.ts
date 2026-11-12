import { describe, expect, it } from "vitest";
import type { AdConfigSnapshot, AdKillState } from "./contracts";
import {
  evaluatePrivateSurface,
  privateHilltopAllowed,
  privatePopunderAllowed,
  privateSurfaceAllows,
} from "./private-surface-rules";

const OPEN_KILL: AdKillState = {
  flags: {
    enabled: true,
    public_enabled: false,
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
  page_types: [{ key: "dashboard", is_auth: false, enabled: true }],
  formats: [
    { key: "banner", is_pop_style: false, needs_consent: true, injection_mode: "script_async" },
  ],
  networks: [{ key: "adsterra", name: "Adsterra", enabled: true }],
  placements: [],
};

const base = {
  universityId: "u1",
  killState: OPEN_KILL,
  config: OPEN_CONFIG,
  consentGranted: true,
  authenticated: true,
};

/** Both seeded networks (2026-11-12): hilltop gets its own row and gate. */
const CONFIG_BOTH: AdConfigSnapshot = {
  ...OPEN_CONFIG,
  networks: [
    { key: "adsterra", name: "Adsterra", enabled: true },
    { key: "hilltop", name: "Hilltop", enabled: true },
  ],
};

describe("private ad surface", () => {
  it("opens for an authenticated viewer when flags, network and consent allow", () => {
    const surface = evaluatePrivateSurface(base);
    expect(surface.open).toBe(true);
    expect(surface.popunderEnabled).toBe(true);
    expect(privateSurfaceAllows(surface)).toBe(true);
    expect(privatePopunderAllowed(surface)).toBe(true);
  });

  it("keeps popunder independently switchable without closing other units", () => {
    const surface = evaluatePrivateSurface({
      ...base,
      killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, popunder_enabled: false } },
    });
    expect(surface.open).toBe(true);
    expect(privateSurfaceAllows(surface)).toBe(true);
    expect(privatePopunderAllowed(surface)).toBe(false);
  });

  it("fails closed without a session or a tenant", () => {
    expect(evaluatePrivateSurface({ ...base, authenticated: false }).open).toBe(false);
    expect(evaluatePrivateSurface({ ...base, universityId: null }).open).toBe(false);
  });

  it("requires the private layer and both kill switches", () => {
    expect(
      evaluatePrivateSurface({
        ...base,
        killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, private_enabled: false } },
      }).open,
    ).toBe(false);
    expect(
      evaluatePrivateSurface({
        ...base,
        killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, enabled: false } },
      }).open,
    ).toBe(false);
    expect(
      evaluatePrivateSurface({
        ...base,
        killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, global_kill: true } },
      }).open,
    ).toBe(false);
    expect(
      evaluatePrivateSurface({ ...base, killState: { ...OPEN_KILL, global: true } }).open,
    ).toBe(false);
  });

  it("respects network enablement, page-type availability and per-network kill", () => {
    expect(
      evaluatePrivateSurface({
        ...base,
        config: {
          ...OPEN_CONFIG,
          networks: [{ key: "adsterra", name: "Adsterra", enabled: false }],
        },
      }).open,
    ).toBe(false);
    expect(evaluatePrivateSurface({ ...base, config: { ...OPEN_CONFIG, networks: [] } }).open).toBe(
      false,
    );
    expect(
      evaluatePrivateSurface({
        ...base,
        config: {
          ...OPEN_CONFIG,
          page_types: [{ key: "login", is_auth: true, enabled: false }],
        },
      }).open,
    ).toBe(false);
    expect(
      evaluatePrivateSurface({
        ...base,
        killState: { ...OPEN_KILL, killed_networks: ["adsterra"] },
      }).open,
    ).toBe(false);
  });

  it("judges the hilltop network independently of adsterra (2026-11-12)", () => {
    const both = { ...base, config: CONFIG_BOTH };

    // Killing Adsterra leaves the Hilltop video unit standing.
    const adsterraKilled = evaluatePrivateSurface({
      ...both,
      killState: { ...OPEN_KILL, killed_networks: ["adsterra"] },
    });
    expect(adsterraKilled.open).toBe(false);
    expect(adsterraKilled.hilltopOpen).toBe(true);
    expect(privateHilltopAllowed(adsterraKilled)).toBe(true);
    expect(privateSurfaceAllows(adsterraKilled)).toBe(false);

    // Killing Hilltop leaves the Adsterra units standing.
    const hilltopKilled = evaluatePrivateSurface({
      ...both,
      killState: { ...OPEN_KILL, killed_networks: ["hilltop"] },
    });
    expect(hilltopKilled.open).toBe(true);
    expect(hilltopKilled.hilltopOpen).toBe(false);
    expect(privateHilltopAllowed(hilltopKilled)).toBe(false);
    expect(privateSurfaceAllows(hilltopKilled)).toBe(true);

    // Disabling the hilltop row fails Hilltop closed, Adsterra open.
    const hilltopDisabled = evaluatePrivateSurface({
      ...both,
      config: {
        ...CONFIG_BOTH,
        networks: [
          { key: "adsterra", name: "Adsterra", enabled: true },
          { key: "hilltop", name: "Hilltop", enabled: false },
        ],
      },
    });
    expect(hilltopDisabled.open).toBe(true);
    expect(hilltopDisabled.hilltopOpen).toBe(false);

    // A missing hilltop row fails Hilltop closed without touching Adsterra.
    const noHilltopRow = evaluatePrivateSurface({ ...base });
    expect(noHilltopRow.open).toBe(true);
    expect(noHilltopRow.hilltopOpen).toBe(false);

    // Consent is still required per visitor even when the hilltop gate is open.
    const noConsent = evaluatePrivateSurface({ ...both, consentGranted: false });
    expect(noConsent.hilltopOpen).toBe(true);
    expect(privateHilltopAllowed(noConsent)).toBe(false);

    // The global kill and master flags close every network at once.
    expect(
      evaluatePrivateSurface({ ...both, killState: { ...OPEN_KILL, global: true } }).hilltopOpen,
    ).toBe(false);
    expect(
      evaluatePrivateSurface({
        ...both,
        killState: { ...OPEN_KILL, flags: { ...OPEN_KILL.flags, enabled: false } },
      }).hilltopOpen,
    ).toBe(false);
  });

  it("withholds rendering until consent and fails closed on malformed payloads", () => {
    const surface = evaluatePrivateSurface({ ...base, consentGranted: false });
    expect(surface.open).toBe(true);
    expect(privateSurfaceAllows(surface)).toBe(false);
    expect(privatePopunderAllowed(surface)).toBe(false);
    expect(evaluatePrivateSurface({ ...base, killState: {} }).open).toBe(false);
    expect(evaluatePrivateSurface({ ...base, config: {} }).open).toBe(false);
  });
});
