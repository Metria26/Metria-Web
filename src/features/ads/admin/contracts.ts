import { z } from "zod";
import { adConfigSnapshotSchema } from "../contracts";

/**
 * Zod contracts for the /admin/ads console (AD3, plan §6). Every server
 * action parses its FormData through these before touching the database;
 * platform-admin RLS (private.is_platform_admin) is the second gate. The
 * config schemas reuse the resolver boundary so a published payload is
 * exactly what private.ad_config_snapshot would hand the client.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export const ADS_FLAG_KEYS = [
  "ads.enabled",
  "ads.public.enabled",
  "ads.private.enabled",
  "ads.global_kill",
] as const;
export const adsFlagKeySchema = z.enum(ADS_FLAG_KEYS);
export type AdsFlagKey = z.infer<typeof adsFlagKeySchema>;

export const placementToggleSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export const networkToggleSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export const flagToggleSchema = z.object({
  key: adsFlagKeySchema,
  enabled: z.boolean(),
});

/** Absent networkId = the single global kill row. */
export const killToggleSchema = z.object({
  enabled: z.boolean(),
  networkId: z.string().uuid().optional(),
});

export const rollbackSchema = z.object({
  version: z.number().int().min(1),
});

/** Stored ad_config_versions.config: the snapshot minus source/version. */
export const storedAdConfigSchema = adConfigSnapshotSchema.omit({
  source: true,
  version: true,
});
export type StoredAdConfig = z.infer<typeof storedAdConfigSchema>;
