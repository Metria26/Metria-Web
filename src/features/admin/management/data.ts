import { createClient } from "@/lib/supabase/server";

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

export type MembershipRow = {
  id: string;
  email: string;
  profile_id: string;
  university_id: string;
  status: string;
  created_at: string;
  roles: string[];
  university_name: string;
};

export type RoleAssignmentRow = {
  id: string;
  email: string;
  profile_id: string;
  university_id: string;
  role_name: string;
  role_display_name: string;
  created_at: string;
  revoked_at: string | null;
  university_name: string;
};

export async function loadMembershipsAdminData(ctx: AdminContext): Promise<MembershipRow[]> {
  const { supabase, universityId } = ctx;

  const [profilesRes, membershipsRes, rolesRes, assignmentsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, created_at, university_id")
      .eq("university_id", universityId),
    supabase
      .from("university_memberships")
      .select("profile_id, status")
      .eq("university_id", universityId),
    supabase.from("roles").select("id, name").eq("university_id", universityId),
    supabase
      .from("role_assignments")
      .select("profile_id, role_id")
      .eq("university_id", universityId)
      .is("revoked_at", null),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;

  const membershipMap = new Map<string, string>();
  for (const m of membershipsRes.data ?? []) {
    membershipMap.set(m.profile_id, m.status);
  }

  const roleNameMap = new Map<string, string>();
  for (const r of rolesRes.data ?? []) {
    roleNameMap.set(r.id, r.name);
  }

  const userRolesMap = new Map<string, string[]>();
  for (const a of assignmentsRes.data ?? []) {
    const rName = roleNameMap.get(a.role_id);
    if (rName) {
      const list = userRolesMap.get(a.profile_id) ?? [];
      list.push(rName);
      userRolesMap.set(a.profile_id, list);
    }
  }

  return (profilesRes.data ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    profile_id: p.id,
    university_id: p.university_id,
    status: membershipMap.get(p.id) ?? "active",
    created_at: p.created_at,
    roles: userRolesMap.get(p.id) ?? [],
    university_name: "FAST-NUCES Lahore",
  }));
}

export async function loadRolesAdminData(ctx: AdminContext): Promise<RoleAssignmentRow[]> {
  const { supabase, universityId } = ctx;

  const [profilesRes, rolesRes, assignmentsRes] = await Promise.all([
    supabase.from("profiles").select("id, email, university_id").eq("university_id", universityId),
    supabase.from("roles").select("id, name").eq("university_id", universityId),
    supabase
      .from("role_assignments")
      .select("id, profile_id, role_id, created_at, revoked_at")
      .eq("university_id", universityId),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;

  const profileMap = new Map<string, { email: string; university_id: string }>();
  for (const p of profilesRes.data ?? []) {
    profileMap.set(p.id, { email: p.email, university_id: p.university_id });
  }

  const roleMap = new Map<string, { name: string }>();
  for (const r of rolesRes.data ?? []) {
    roleMap.set(r.id, { name: r.name });
  }

  const rows: RoleAssignmentRow[] = [];
  for (const a of assignmentsRes.data ?? []) {
    const prof = profileMap.get(a.profile_id);
    const role = roleMap.get(a.role_id);
    if (prof) {
      const roleName = role?.name ?? "";
      rows.push({
        id: a.id,
        email: prof.email,
        profile_id: a.profile_id,
        university_id: prof.university_id,
        role_name: roleName,
        role_display_name: roleName.toUpperCase(),
        created_at: a.created_at,
        revoked_at: a.revoked_at,
        university_name: "FAST-NUCES Lahore",
      });
    }
  }

  return rows;
}
