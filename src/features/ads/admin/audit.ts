import { adConfigSnapshotSchema } from "../contracts";
import type { AdsFlagKey, StoredAdConfig } from "./contracts";

/**
 * Pure audit mapping for the /admin/ads console (AD3). Every mutation in
 * actions.ts funnels through auditRow(), so the event_type / target_type /
 * payload shape is unit-testable without a database. Event names are
 * pre-registered in docs/SYMBOL_REGISTRY.md: ad.config.changed and
 * ad.kill_switch.changed.
 */

export type AdAdminAction =
  | { action: "placement.enabled"; id: string; enabled: boolean }
  | { action: "network.enabled"; id: string; enabled: boolean }
  | { action: "flag.set"; key: AdsFlagKey; enabled: boolean }
  | { action: "kill.set"; enabled: boolean; networkId: string | null }
  | { action: "config.published"; version: number }
  | { action: "config.rolled_back"; fromVersion: number; toVersion: number };

export type AuditRow = {
  event_type: "ad.config.changed" | "ad.kill_switch.changed";
  target_type: "placement" | "network" | "feature_flag" | "kill_switch" | "config_version";
  target_id: string | null;
  payload: Record<string, unknown>;
};

export function auditRow(action: AdAdminAction): AuditRow {
  switch (action.action) {
    case "placement.enabled":
      return {
        event_type: "ad.config.changed",
        target_type: "placement",
        target_id: action.id,
        payload: { action: action.action, enabled: action.enabled },
      };
    case "network.enabled":
      return {
        event_type: "ad.config.changed",
        target_type: "network",
        target_id: action.id,
        payload: { action: action.action, enabled: action.enabled },
      };
    case "flag.set":
      return {
        event_type: "ad.config.changed",
        target_type: "feature_flag",
        target_id: null,
        payload: { action: action.action, key: action.key, enabled: action.enabled },
      };
    case "kill.set":
      return {
        event_type: "ad.kill_switch.changed",
        target_type: "kill_switch",
        target_id: action.networkId,
        payload: {
          action: action.action,
          scope: action.networkId === null ? "global" : "network",
          enabled: action.enabled,
        },
      };
    case "config.published":
      return {
        event_type: "ad.config.changed",
        target_type: "config_version",
        target_id: null,
        payload: { action: action.action, version: action.version },
      };
    case "config.rolled_back":
      return {
        event_type: "ad.config.changed",
        target_type: "config_version",
        target_id: null,
        payload: {
          action: action.action,
          from: action.fromVersion,
          to: action.toVersion,
        },
      };
  }
}

/**
 * Turns a private.ad_config_snapshot payload (source + version + config) into
 * the row stored in ad_config_versions.config: the resolver-validated config
 * only, so the stored document round-trips through storedAdConfigSchema.
 * Anything that fails the resolver boundary returns null (fail closed).
 */
export function publishableConfig(snapshot: unknown): StoredAdConfig | null {
  const parsed = adConfigSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return null;
  const { page_types, formats, networks, placements } = parsed.data;
  return { page_types, formats, networks, placements };
}
