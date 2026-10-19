import { describe, expect, it } from "vitest";
import type { AdConfigSnapshot, AdKillState } from "./contracts";
import { evaluatePrivateSurface, privateSurfaceAllows } from "./private-surface-rules";

const OPEN_KILL: AdKillState = {
  flags: { enabled: true, public_enabled: false, private_enabled: true, global_kill: false },
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

describe("private ad surface", () => {
  it("opens for an authenticated viewer when flags, network and consent allow", () => {
    const surface = evaluatePrivateSurface(base);
    expect(surface.open).toBe(true);
    expect(privateSurfaceAllows(surface)).toBe(true);
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

  it("withholds rendering until consent and fails closed on malformed payloads", () => {
    const surface = evaluatePrivateSurface({ ...base, consentGranted: false });
    expect(surface.open).toBe(true);
    expect(privateSurfaceAllows(surface)).toBe(false);
    expect(evaluatePrivateSurface({ ...base, killState: {} }).open).toBe(false);
    expect(evaluatePrivateSurface({ ...base, config: {} }).open).toBe(false);
  });
});
