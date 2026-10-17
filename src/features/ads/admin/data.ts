import { createClient } from "@/lib/supabase/server";
import { ADS_FLAG_KEYS, type AdsFlagKey } from "./contracts";
/**
 * Server-side gate + data loader for the /admin/ads console (AD3).
 *
 * Access interpretation (plan §6 AD3): platform.manage_ads is granted to no
 * role — seed.sql grants platform caps via public.platform_admins ("never
 * roles") — so the console enforces private.is_platform_admin() exactly.
 * requireAdmin() mirrors that function: profiles row for auth.uid(), then an
 * unrevoked platform_admins row keyed on profiles.id (T-A003 D-c). The
 * platform_admins read is itself RLS-gated by is_platform_admin(), so a
 * non-admin sees zero rows before any admin data loads. No app code has ever
 * checked a permission directly (has_permission is role-only and would deny
 * an unmapped permission), hence this file is the single admin entry point.
 */

export type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profileId: string;
  universityId: string;
};

export async function requireAdmin(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile) return null;

  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("profile_id", profile.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!adminRow) return null;

  return { supabase, profileId: profile.id, universityId: profile.university_id };
}

export type FlagRow = { key: AdsFlagKey; enabled: boolean };

export type KillRow = {
  networkId: string | null;
  key: string;
  name: string;
  killed: boolean;
};

export type PlacementRow = {
  id: string;
  slotKey: string;
  enabled: boolean;
  priority: number;
  isolationMode: string;
  frequencyCap: number | null;
  pageTypeKey: string;
  isAuth: boolean;
  networkKey: string;
  networkName: string;
  formatKey: string;
};

export type NetworkRow = { id: string; key: string; name: string; enabled: boolean };

export type VersionRow = { version: number; createdAt: string };

export type AdsAdminData = {
  flags: FlagRow[];
  globalKill: boolean;
  killNetworks: KillRow[];
  placements: PlacementRow[];
  networks: NetworkRow[];
  versions: VersionRow[];
};

/**
 * Loads the console's read model. Separate selects (no PostgREST embeds —
 * T-A006 embed-union typing) joined in TS; every table is platform-admin-only
 * under RLS, so an empty result set here means "not seeded", never "leaked".
 */
export async function loadAdsAdminData(ctx: AdminContext): Promise<AdsAdminData> {
  const { supabase, universityId } = ctx;
  const [flags, kills, placementsRes, pageTypes, networks, formats, versionsRes] =
    await Promise.all([
      supabase
        .from("feature_flags")
        .select("key, enabled")
        .eq("university_id", universityId)
        .in("key", [...ADS_FLAG_KEYS]),
      supabase
        .from("ad_kill_switches")
        .select("network_id, is_global, enabled")
        .eq("university_id", universityId),
      supabase
        .from("ad_placements")
        .select(
          "id, page_type_id, network_id, format_id, slot_key, enabled, priority, isolation_mode, frequency_cap",
        )
        .eq("university_id", universityId)
        .order("slot_key"),
      supabase.from("page_types").select("id, key, is_auth").eq("university_id", universityId),
      supabase
        .from("ad_networks")
        .select("id, key, name, enabled")
        .eq("university_id", universityId)
        .order("key"),
      supabase.from("ad_formats").select("id, key").eq("university_id", universityId),
      supabase
        .from("ad_config_versions")
        .select("version, created_at")
        .eq("university_id", universityId)
        .order("version", { ascending: false })
        .limit(10),
    ]);

  const flagMap = new Map<string, boolean>();
  for (const row of flags.data ?? []) flagMap.set(row.key, row.enabled);
  const flagRows: FlagRow[] = ADS_FLAG_KEYS.map((key) => ({
    key,
    enabled: flagMap.get(key) ?? false,
  }));

  const networkRows: NetworkRow[] = networks.data ?? [];
  const networkNameById = new Map(networkRows.map((n) => [n.id, n.name]));
  const killNetworks: KillRow[] = networkRows.map((network) => {
    const row = (kills.data ?? []).find(
      (kill) => kill.network_id === network.id && !kill.is_global,
    );
    return {
      networkId: network.id,
      key: network.key,
      name: network.name,
      killed: row?.enabled ?? false,
    };
  });
  const globalKill = (kills.data ?? []).some((kill) => kill.is_global && kill.enabled);

  const pageTypeById = new Map((pageTypes.data ?? []).map((pt) => [pt.id, pt]));
  const formatById = new Map((formats.data ?? []).map((f) => [f.id, f]));
  const placements: PlacementRow[] = (placementsRes.data ?? []).map((row) => {
    const pageType = pageTypeById.get(row.page_type_id);
    return {
      id: row.id,
      slotKey: row.slot_key,
      enabled: row.enabled,
      priority: row.priority,
      isolationMode: row.isolation_mode,
      frequencyCap: row.frequency_cap,
      pageTypeKey: pageType?.key ?? "—",
      isAuth: pageType?.is_auth ?? false,
      networkKey: networkRows.find((n) => n.id === row.network_id)?.key ?? "—",
      networkName: networkNameById.get(row.network_id) ?? "—",
      formatKey: formatById.get(row.format_id)?.key ?? "—",
    };
  });

  const versions: VersionRow[] = (versionsRes.data ?? []).map((row) => ({
    version: row.version,
    createdAt: row.created_at,
  }));

  return { flags: flagRows, globalKill, killNetworks, placements, networks: networkRows, versions };
}
