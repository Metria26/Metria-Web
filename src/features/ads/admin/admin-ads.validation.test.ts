import { describe, expect, it } from "vitest";
import type { AdConfigSnapshot } from "../contracts";
import { auditRow, publishableConfig } from "./audit";
import {
  adsFlagKeySchema,
  flagToggleSchema,
  killToggleSchema,
  placementToggleSchema,
  rollbackSchema,
  storedAdConfigSchema,
} from "./contracts";

/**
 * AD3 unit boundary: the audit-event mapping and the publish/rollback config
 * contract. The database enforces append-only audit_log and version
 * uniqueness (admin-ads-audit.rls.test.sql); these tests pin the pure
 * behaviour every console mutation depends on.
 */

const validSnapshot: AdConfigSnapshot = {
  source: "live",
  version: 0,
  page_types: [{ key: "dashboard", is_auth: false, enabled: true }],
  formats: [
    {
      key: "banner",
      is_pop_style: false,
      needs_consent: false,
      injection_mode: "html",
    },
  ],
  networks: [{ key: "adsterra", name: "Adsterra", enabled: true }],
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
  ],
};

describe("auditRow", () => {
  it("maps placement toggles to ad.config.changed with the placement target", () => {
    expect(auditRow({ action: "placement.enabled", id: "p-1", enabled: true })).toEqual({
      event_type: "ad.config.changed",
      target_type: "placement",
      target_id: "p-1",
      payload: { action: "placement.enabled", enabled: true },
    });
  });

  it("maps network toggles to ad.config.changed with the network target", () => {
    expect(auditRow({ action: "network.enabled", id: "n-1", enabled: false })).toEqual({
      event_type: "ad.config.changed",
      target_type: "network",
      target_id: "n-1",
      payload: { action: "network.enabled", enabled: false },
    });
  });

  it("maps flag toggles to ad.config.changed keyed by the flag name", () => {
    expect(auditRow({ action: "flag.set", key: "ads.global_kill", enabled: true })).toEqual({
      event_type: "ad.config.changed",
      target_type: "feature_flag",
      target_id: null,
      payload: { action: "flag.set", key: "ads.global_kill", enabled: true },
    });
  });

  it("maps the global kill switch with scope global and no target", () => {
    expect(auditRow({ action: "kill.set", enabled: true, networkId: null })).toEqual({
      event_type: "ad.kill_switch.changed",
      target_type: "kill_switch",
      target_id: null,
      payload: { action: "kill.set", scope: "global", enabled: true },
    });
  });

  it("maps a network kill switch with scope network and the network id", () => {
    expect(auditRow({ action: "kill.set", enabled: false, networkId: "n-9" })).toEqual({
      event_type: "ad.kill_switch.changed",
      target_type: "kill_switch",
      target_id: "n-9",
      payload: { action: "kill.set", scope: "network", enabled: false },
    });
  });

  it("maps publish and rollback versions onto config_version payloads", () => {
    expect(auditRow({ action: "config.published", version: 3 })).toEqual({
      event_type: "ad.config.changed",
      target_type: "config_version",
      target_id: null,
      payload: { action: "config.published", version: 3 },
    });
    expect(auditRow({ action: "config.rolled_back", fromVersion: 2, toVersion: 4 })).toEqual({
      event_type: "ad.config.changed",
      target_type: "config_version",
      target_id: null,
      payload: { action: "config.rolled_back", from: 2, to: 4 },
    });
  });
});

describe("publishableConfig", () => {
  it("strips source and version from a valid snapshot", () => {
    const config = publishableConfig(validSnapshot);
    expect(config).not.toBeNull();
    expect(config).not.toHaveProperty("source");
    expect(config).not.toHaveProperty("version");
    expect(config?.page_types).toHaveLength(1);
    expect(config?.networks[0]?.key).toBe("adsterra");
  });

  it("round-trips through storedAdConfigSchema", () => {
    const config = publishableConfig(validSnapshot);
    expect(() => storedAdConfigSchema.parse(config)).not.toThrow();
  });

  it("rejects payloads that fail the resolver boundary", () => {
    expect(publishableConfig(null)).toBeNull();
    expect(publishableConfig("live")).toBeNull();
    expect(publishableConfig([])).toBeNull();
    expect(publishableConfig({})).toBeNull();
    expect(publishableConfig({ source: "live", version: 0 })).toBeNull();
    expect(publishableConfig({ ...validSnapshot, placements: "not-an-array" })).toBeNull();
    expect(
      publishableConfig({ ...validSnapshot, page_types: [{ key: "", is_auth: "yes" }] }),
    ).toBeNull();
  });
});

describe("admin ads input contracts", () => {
  it("accepts only the four registered ads flag keys", () => {
    for (const key of [
      "ads.enabled",
      "ads.public.enabled",
      "ads.private.enabled",
      "ads.global_kill",
    ]) {
      expect(adsFlagKeySchema.safeParse(key).success).toBe(true);
    }
    expect(adsFlagKeySchema.safeParse("ads.modes").success).toBe(false);
    expect(flagToggleSchema.safeParse({ key: "booking.enabled", enabled: true }).success).toBe(
      false,
    );
  });

  it("requires uuid ids and booleans for placement toggles", () => {
    expect(
      placementToggleSchema.safeParse({
        id: "2b0f3d1e-8f4e-4c1a-9c1e-1a2b3c4d5e6f",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(placementToggleSchema.safeParse({ id: "nope", enabled: true }).success).toBe(false);
    expect(
      placementToggleSchema.safeParse({ id: "2b0f3d1e-8f4e-4c1a-9c1e-1a2b3c4d5e6f" }).success,
    ).toBe(false);
  });

  it("treats a missing networkId as the global kill row", () => {
    const globalKill = killToggleSchema.safeParse({ enabled: true });
    expect(globalKill.success).toBe(true);
    expect(globalKill.success && globalKill.data.networkId).toBeUndefined();

    const networkKill = killToggleSchema.safeParse({
      enabled: false,
      networkId: "2b0f3d1e-8f4e-4c1a-9c1e-1a2b3c4d5e6f",
    });
    expect(networkKill.success).toBe(true);
    expect(killToggleSchema.safeParse({ enabled: true, networkId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("accepts positive integer versions only for rollbacks", () => {
    expect(rollbackSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(rollbackSchema.safeParse({ version: 42 }).success).toBe(true);
    expect(rollbackSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(rollbackSchema.safeParse({ version: -1 }).success).toBe(false);
    expect(rollbackSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(rollbackSchema.safeParse({ version: Number.NaN }).success).toBe(false);
    expect(rollbackSchema.safeParse(undefined).success).toBe(false);
  });
});
