"use server";

import { revalidatePath } from "next/cache";
import { auditRow, publishableConfig, type AdAdminAction } from "./audit";
import {
  flagToggleSchema,
  killToggleSchema,
  networkToggleSchema,
  placementToggleSchema,
  rollbackSchema,
  storedAdConfigSchema,
  type ActionResult,
} from "./contracts";
import { requireAdmin, type AdminContext } from "./data";

/**
 * /admin/ads server actions (AD3, plan §6). Every action: requireAdmin()
 * (session → profiles → unrevoked platform_admins row), Zod-parse the
 * FormData, tenant-scoped mutation (is_platform_admin RLS is the second
 * gate), one audit_log row, then revalidatePath. Error keys stay i18n-safe —
 * Postgres details never reach the client.
 */

type ErrorKey = "notAuthorized" | "invalidInput" | "duplicate" | "invalidReference" | "generic";

function mapError(code: string | undefined): ErrorKey {
  switch (code) {
    case "42501":
      return "notAuthorized";
    case "23505":
      return "duplicate";
    case "23503":
    case "23502":
      return "invalidReference";
    default:
      return "generic";
  }
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function boolValue(value: FormDataEntryValue | null): boolean | undefined {
  if (value !== "true" && value !== "false") return undefined;
  return value === "true";
}

function invalidInput(): ActionResult {
  return { ok: false, error: "invalidInput" };
}

/**
 * Writes the audit row after a successful mutation. Failure is reported but
 * never rolls the mutation back (the console runs without a wrapping
 * transaction); the page still revalidates so the operator sees applied
 * state plus the generic error.
 */
async function writeAudit(ctx: AdminContext, action: AdAdminAction): Promise<boolean> {
  const row = auditRow(action);
  const { error } = await ctx.supabase.from("audit_log").insert({
    university_id: ctx.universityId,
    created_by: ctx.profileId,
    actor_id: ctx.profileId,
    event_type: row.event_type,
    target_type: row.target_type,
    target_id: row.target_id,
    payload: row.payload,
  });
  if (error) {
    console.warn("[admin/ads] audit insert failed:", error.code ?? error.message);
    return false;
  }
  return true;
}

export async function setPlacementEnabledAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const parsed = placementToggleSchema.safeParse({
    id: emptyToUndefined(formData.get("id")),
    enabled: boolValue(formData.get("enabled")),
  });
  if (!parsed.success) return invalidInput();

  const { data, error } = await ctx.supabase
    .from("ad_placements")
    .update({ enabled: parsed.data.enabled })
    .eq("id", parsed.data.id)
    .eq("university_id", ctx.universityId)
    .select("id");
  if (error) return { ok: false, error: mapError(error.code) };
  if (!data || data.length === 0) return { ok: false, error: "invalidReference" };

  const audited = await writeAudit(ctx, {
    action: "placement.enabled",
    id: parsed.data.id,
    enabled: parsed.data.enabled,
  });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}

export async function setNetworkEnabledAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const parsed = networkToggleSchema.safeParse({
    id: emptyToUndefined(formData.get("id")),
    enabled: boolValue(formData.get("enabled")),
  });
  if (!parsed.success) return invalidInput();

  const { data, error } = await ctx.supabase
    .from("ad_networks")
    .update({ enabled: parsed.data.enabled })
    .eq("id", parsed.data.id)
    .eq("university_id", ctx.universityId)
    .select("id");
  if (error) return { ok: false, error: mapError(error.code) };
  if (!data || data.length === 0) return { ok: false, error: "invalidReference" };

  const audited = await writeAudit(ctx, {
    action: "network.enabled",
    id: parsed.data.id,
    enabled: parsed.data.enabled,
  });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}

export async function setAdsFlagAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const parsed = flagToggleSchema.safeParse({
    key: emptyToUndefined(formData.get("key")),
    enabled: boolValue(formData.get("enabled")),
  });
  if (!parsed.success) return invalidInput();

  const { data: existing, error: selectError } = await ctx.supabase
    .from("feature_flags")
    .select("id")
    .eq("university_id", ctx.universityId)
    .eq("key", parsed.data.key)
    .maybeSingle();
  if (selectError) return { ok: false, error: mapError(selectError.code) };

  let mutationError: { code?: string } | null = null;
  if (existing) {
    const { error } = await ctx.supabase
      .from("feature_flags")
      .update({ enabled: parsed.data.enabled })
      .eq("id", existing.id)
      .eq("university_id", ctx.universityId);
    mutationError = error;
  } else {
    const { error } = await ctx.supabase.from("feature_flags").insert({
      university_id: ctx.universityId,
      created_by: ctx.profileId,
      key: parsed.data.key,
      enabled: parsed.data.enabled,
    });
    mutationError = error;
  }
  if (mutationError) return { ok: false, error: mapError(mutationError.code) };

  const audited = await writeAudit(ctx, {
    action: "flag.set",
    key: parsed.data.key,
    enabled: parsed.data.enabled,
  });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}

/** Global kill (no networkId) or one network kill row — shape CHECK enforced in SQL. */
export async function setKillAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const parsed = killToggleSchema.safeParse({
    enabled: boolValue(formData.get("enabled")),
    networkId: emptyToUndefined(formData.get("networkId")),
  });
  if (!parsed.success) return invalidInput();

  const networkId = parsed.data.networkId ?? null;

  if (networkId) {
    const { data: network, error: networkError } = await ctx.supabase
      .from("ad_networks")
      .select("id")
      .eq("id", networkId)
      .eq("university_id", ctx.universityId)
      .maybeSingle();
    if (networkError) return { ok: false, error: mapError(networkError.code) };
    if (!network) return { ok: false, error: "invalidReference" };
  }

  const lookup = ctx.supabase
    .from("ad_kill_switches")
    .select("id")
    .eq("university_id", ctx.universityId)
    .eq("is_global", networkId === null);
  const { data: existing, error: selectError } = networkId
    ? await lookup.eq("network_id", networkId).maybeSingle()
    : await lookup.is("network_id", null).maybeSingle();
  if (selectError) return { ok: false, error: mapError(selectError.code) };

  let mutationError: { code?: string } | null = null;
  if (existing) {
    const { error } = await ctx.supabase
      .from("ad_kill_switches")
      .update({ enabled: parsed.data.enabled })
      .eq("id", existing.id)
      .eq("university_id", ctx.universityId);
    mutationError = error;
  } else {
    const { error } = await ctx.supabase.from("ad_kill_switches").insert({
      university_id: ctx.universityId,
      created_by: ctx.profileId,
      is_global: networkId === null,
      network_id: networkId,
      enabled: parsed.data.enabled,
    });
    mutationError = error;
  }
  if (mutationError) return { ok: false, error: mapError(mutationError.code) };

  const audited = await writeAudit(ctx, {
    action: "kill.set",
    enabled: parsed.data.enabled,
    networkId,
  });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}

/** Publishes the active snapshot as the next immutable config version. */
export async function publishAdConfigAction(): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const { data: snapshot, error: rpcError } = await ctx.supabase.rpc("ad_config_snapshot", {
    p_university_id: ctx.universityId,
  });
  if (rpcError) return { ok: false, error: mapError(rpcError.code) };

  const config = publishableConfig(snapshot);
  if (!config) return { ok: false, error: "generic" };

  const { data: latest, error: latestError } = await ctx.supabase
    .from("ad_config_versions")
    .select("version")
    .eq("university_id", ctx.universityId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { ok: false, error: mapError(latestError.code) };

  const version = (latest?.version ?? 0) + 1;
  const { error: insertError } = await ctx.supabase.from("ad_config_versions").insert({
    university_id: ctx.universityId,
    created_by: ctx.profileId,
    version,
    config,
  });
  if (insertError) return { ok: false, error: mapError(insertError.code) };

  const audited = await writeAudit(ctx, { action: "config.published", version });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}

/** Copies an old config into a new version (append-only; no UPDATE path). */
export async function rollbackAdConfigAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "notAuthorized" };

  const rawVersion = emptyToUndefined(formData.get("version"));
  const parsed = rollbackSchema.safeParse(
    rawVersion === undefined ? undefined : { version: Number(rawVersion) },
  );
  if (!parsed.success) return invalidInput();

  const { data: target, error: targetError } = await ctx.supabase
    .from("ad_config_versions")
    .select("version, config")
    .eq("university_id", ctx.universityId)
    .eq("version", parsed.data.version)
    .maybeSingle();
  if (targetError) return { ok: false, error: mapError(targetError.code) };
  if (!target) return { ok: false, error: "invalidReference" };

  const config = storedAdConfigSchema.safeParse(target.config);
  if (!config.success) return { ok: false, error: "generic" };

  const { data: latest, error: latestError } = await ctx.supabase
    .from("ad_config_versions")
    .select("version")
    .eq("university_id", ctx.universityId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { ok: false, error: mapError(latestError.code) };

  const version = (latest?.version ?? 0) + 1;
  const { error: insertError } = await ctx.supabase.from("ad_config_versions").insert({
    university_id: ctx.universityId,
    created_by: ctx.profileId,
    version,
    config: config.data,
  });
  if (insertError) return { ok: false, error: mapError(insertError.code) };

  const audited = await writeAudit(ctx, {
    action: "config.rolled_back",
    fromVersion: parsed.data.version,
    toVersion: version,
  });
  revalidatePath("/admin/ads");
  return audited ? { ok: true } : { ok: false, error: "generic" };
}
