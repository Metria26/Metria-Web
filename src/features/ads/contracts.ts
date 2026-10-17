import { z } from "zod";

/**
 * Zod contracts for the ad resolver boundary (T-B002, features 10.1-10.4/10.6).
 * The database is authoritative: private.ad_config_snapshot and
 * private.ad_kill_state return sanitized JSON (keys only, no ids/created_by,
 * auth page types already excluded) and these schemas are the second gate
 * before the resolver trusts a payload. Anything malformed fails closed.
 */

export const adPageTypeSchema = z.object({
  key: z.string().min(1),
  is_auth: z.boolean(),
  enabled: z.boolean(),
});

export const adFormatSchema = z.object({
  key: z.string().min(1),
  is_pop_style: z.boolean(),
  needs_consent: z.boolean(),
  injection_mode: z.string().min(1),
});

export const adNetworkSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
});

export const adPlacementSchema = z.object({
  slot_key: z.string().min(1),
  page_type: z.string().min(1),
  network: z.string().min(1),
  format: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int(),
  frequency_cap: z.number().int().nullable(),
  isolation_mode: z.string().min(1),
});

export const adConfigSnapshotSchema = z.object({
  source: z.enum(["live", "version"]),
  version: z.number().int().min(0),
  page_types: z.array(adPageTypeSchema),
  formats: z.array(adFormatSchema),
  networks: z.array(adNetworkSchema),
  placements: z.array(adPlacementSchema),
});
export type AdConfigSnapshot = z.infer<typeof adConfigSnapshotSchema>;
export type AdPlacement = z.infer<typeof adPlacementSchema>;
export type AdFormat = z.infer<typeof adFormatSchema>;

export const adKillStateSchema = z.object({
  flags: z.object({
    enabled: z.boolean(),
    public_enabled: z.boolean(),
    private_enabled: z.boolean(),
    global_kill: z.boolean(),
  }),
  global: z.boolean(),
  killed_networks: z.array(z.string()),
});
export type AdKillState = z.infer<typeof adKillStateSchema>;

export const AD_DEVICES = ["desktop", "mobile", "tablet"] as const;
export const adDeviceSchema = z.enum(AD_DEVICES);
export type AdDevice = z.infer<typeof adDeviceSchema>;

/**
 * Direct-sponsor read contract (T-B003, feature 10.5):
 * public.page_sponsor_slots returns sanitized creative rows only — image link,
 * target link and slot priority, no ids, no created_by. Tenant, window, sponsor
 * and auth page filters already ran in SQL; this schema is the second gate
 * before the renderer trusts the payload (D3 pattern shared with the config
 * snapshots). The http(s)-only target filter also lives in SQL (D-B3-a).
 */
export const sponsorCreativeSchema = z.object({
  image_url: z.string().min(1),
  target_url: z.string().min(1),
  priority: z.number().int(),
});
export type SponsorCreativeRead = z.infer<typeof sponsorCreativeSchema>;

export const sponsorReadSchema = z.object({
  creatives: z.array(sponsorCreativeSchema),
});
export type SponsorRead = z.infer<typeof sponsorReadSchema>;

/** Consent categories that gate ad scripts; "necessary" is implicit and never stored. */
export const CONSENT_CATEGORIES = ["analytics", "ads"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type ConsentCategories = Record<ConsentCategory, boolean>;

export const consentStateSchema = z.object({
  policyVersion: z.string().min(1),
  categories: z.object({ analytics: z.boolean(), ads: z.boolean() }),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

/**
 * Resolver input context (ad-system spec): university and page type are implied
 * by the config/kill-state pair; device is accepted per the spec and carried
 * through as a no-op until the docs schema gains device targeting.
 */
export const resolverContextSchema = z.object({
  pageType: z.string().min(1),
  slotKey: z.string().min(1),
  authenticated: z.boolean(),
  device: adDeviceSchema.default("desktop"),
  consent: z.object({ analytics: z.boolean(), ads: z.boolean() }),
  /** First-party "pop shown" timestamp (ms) from the visitor cookie, or null. */
  recentPopStyleAt: z.number().int().nonnegative().nullable().default(null),
});
export type ResolverContext = z.infer<typeof resolverContextSchema>;
