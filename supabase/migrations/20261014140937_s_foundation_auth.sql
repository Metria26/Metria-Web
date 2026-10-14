-- Migration: foundation-auth (lane: shared)
-- Source (copied verbatim, order preserved):
--   docs/03-database/schema/foundation-auth.sql
--   docs/03-database/rls/foundation-auth.sql
--   docs/03-database/functions/foundation-auth.sql
-- Card: docs/08-delivery/shared/tasks/T-S001-foundation-gate.md (F1)
-- Registry: docs/SYMBOL_REGISTRY.md v1

-- ============================================================================
-- SECTION 1: SCHEMA (from docs/03-database/schema/foundation-auth.sql)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS public.universities(id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, slug text NOT NULL UNIQUE, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Karachi', is_enabled boolean NOT NULL DEFAULT true, settings jsonb NOT NULL DEFAULT '{}'::jsonb, deleted_at timestamptz, CONSTRAINT universities_pkey PRIMARY KEY(id));
CREATE INDEX IF NOT EXISTS universities_created_idx ON public.universities(created_at DESC);

ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY; ALTER TABLE public.universities FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_universities() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS universities_touch ON public.universities; CREATE TRIGGER universities_touch BEFORE UPDATE ON public.universities FOR EACH ROW EXECUTE FUNCTION private.touch_universities();
CREATE TABLE IF NOT EXISTS public.university_domains(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, domain text NOT NULL, is_verified boolean NOT NULL DEFAULT false, is_allowed boolean NOT NULL DEFAULT true, CONSTRAINT university_domains_pkey PRIMARY KEY(id), CONSTRAINT university_domains_tenant_id_key UNIQUE(university_id,id), CONSTRAINT university_domains_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS university_domains_tenant_created_idx ON public.university_domains(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS university_domains_creator_idx ON public.university_domains(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.university_domains ENABLE ROW LEVEL SECURITY; ALTER TABLE public.university_domains FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_university_domains() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS university_domains_touch ON public.university_domains; CREATE TRIGGER university_domains_touch BEFORE UPDATE ON public.university_domains FOR EACH ROW EXECUTE FUNCTION private.touch_university_domains();
CREATE TABLE IF NOT EXISTS public.profiles(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, auth_user_id uuid NOT NULL UNIQUE, display_name text NOT NULL, email text NOT NULL, roll_no text, linkedin_url text, github_url text, linkedin_public boolean NOT NULL DEFAULT false, github_public boolean NOT NULL DEFAULT false, deleted_at timestamptz, CONSTRAINT profiles_pkey PRIMARY KEY(id), CONSTRAINT profiles_tenant_id_key UNIQUE(university_id,id), CONSTRAINT profiles_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS profiles_tenant_created_idx ON public.profiles(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS profiles_creator_idx ON public.profiles(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_profiles() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS profiles_touch ON public.profiles; CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.touch_profiles();
CREATE TABLE IF NOT EXISTS public.university_memberships(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('pending','active','suspended')), CONSTRAINT university_memberships_pkey PRIMARY KEY(id), CONSTRAINT university_memberships_tenant_id_key UNIQUE(university_id,id), CONSTRAINT university_memberships_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS university_memberships_tenant_created_idx ON public.university_memberships(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS university_memberships_creator_idx ON public.university_memberships(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.university_memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE public.university_memberships FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_university_memberships() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS university_memberships_touch ON public.university_memberships; CREATE TRIGGER university_memberships_touch BEFORE UPDATE ON public.university_memberships FOR EACH ROW EXECUTE FUNCTION private.touch_university_memberships();
CREATE TABLE IF NOT EXISTS public.roles(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, name text NOT NULL, scope text NOT NULL CHECK(scope IN ('university','offering')), CONSTRAINT roles_pkey PRIMARY KEY(id), CONSTRAINT roles_tenant_id_key UNIQUE(university_id,id), CONSTRAINT roles_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS roles_tenant_created_idx ON public.roles(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS roles_creator_idx ON public.roles(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_roles() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS roles_touch ON public.roles; CREATE TRIGGER roles_touch BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION private.touch_roles();
CREATE TABLE IF NOT EXISTS public.permissions(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL UNIQUE, description text NOT NULL, CONSTRAINT permissions_pkey PRIMARY KEY(id), CONSTRAINT permissions_tenant_id_key UNIQUE(university_id,id), CONSTRAINT permissions_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS permissions_tenant_created_idx ON public.permissions(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS permissions_creator_idx ON public.permissions(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_permissions() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS permissions_touch ON public.permissions; CREATE TRIGGER permissions_touch BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION private.touch_permissions();
CREATE TABLE IF NOT EXISTS public.role_permissions(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, role_id uuid NOT NULL, permission_id uuid NOT NULL, CONSTRAINT role_permissions_pkey PRIMARY KEY(id), CONSTRAINT role_permissions_tenant_id_key UNIQUE(university_id,id), CONSTRAINT role_permissions_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS role_permissions_tenant_created_idx ON public.role_permissions(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS role_permissions_creator_idx ON public.role_permissions(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_role_permissions() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS role_permissions_touch ON public.role_permissions; CREATE TRIGGER role_permissions_touch BEFORE UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION private.touch_role_permissions();
CREATE TABLE IF NOT EXISTS public.role_assignments(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid NOT NULL, role_id uuid NOT NULL, offering_id uuid, section_id uuid, assigned_by uuid NOT NULL, revoked_at timestamptz, CONSTRAINT role_assignments_pkey PRIMARY KEY(id), CONSTRAINT role_assignments_tenant_id_key UNIQUE(university_id,id), CONSTRAINT role_assignments_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS role_assignments_tenant_created_idx ON public.role_assignments(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS role_assignments_creator_idx ON public.role_assignments(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.role_assignments FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_role_assignments() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS role_assignments_touch ON public.role_assignments; CREATE TRIGGER role_assignments_touch BEFORE UPDATE ON public.role_assignments FOR EACH ROW EXECUTE FUNCTION private.touch_role_assignments();
CREATE TABLE IF NOT EXISTS public.role_assignment_history(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, role_assignment_id uuid NOT NULL, action text NOT NULL, actor_id uuid NOT NULL, before_state text, after_state text, CONSTRAINT role_assignment_history_pkey PRIMARY KEY(id), CONSTRAINT role_assignment_history_tenant_id_key UNIQUE(university_id,id), CONSTRAINT role_assignment_history_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS role_assignment_history_tenant_created_idx ON public.role_assignment_history(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS role_assignment_history_creator_idx ON public.role_assignment_history(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.role_assignment_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.role_assignment_history FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_role_assignment_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS role_assignment_history_touch ON public.role_assignment_history; CREATE TRIGGER role_assignment_history_touch BEFORE UPDATE ON public.role_assignment_history FOR EACH ROW EXECUTE FUNCTION private.touch_role_assignment_history();
CREATE TABLE IF NOT EXISTS public.platform_admins(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid NOT NULL UNIQUE, granted_by uuid, revoked_at timestamptz, CONSTRAINT platform_admins_pkey PRIMARY KEY(id), CONSTRAINT platform_admins_tenant_id_key UNIQUE(university_id,id), CONSTRAINT platform_admins_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS platform_admins_tenant_created_idx ON public.platform_admins(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS platform_admins_creator_idx ON public.platform_admins(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY; ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_platform_admins() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS platform_admins_touch ON public.platform_admins; CREATE TRIGGER platform_admins_touch BEFORE UPDATE ON public.platform_admins FOR EACH ROW EXECUTE FUNCTION private.touch_platform_admins();
CREATE TABLE IF NOT EXISTS public.invites(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, email text NOT NULL, role_id uuid NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz, CONSTRAINT invites_pkey PRIMARY KEY(id), CONSTRAINT invites_tenant_id_key UNIQUE(university_id,id), CONSTRAINT invites_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS invites_tenant_created_idx ON public.invites(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS invites_creator_idx ON public.invites(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY; ALTER TABLE public.invites FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_invites() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS invites_touch ON public.invites; CREATE TRIGGER invites_touch BEFORE UPDATE ON public.invites FOR EACH ROW EXECUTE FUNCTION private.touch_invites();
CREATE TABLE IF NOT EXISTS public.platform_settings(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL UNIQUE, value jsonb NOT NULL, schema_version integer NOT NULL DEFAULT 1, CONSTRAINT platform_settings_pkey PRIMARY KEY(id), CONSTRAINT platform_settings_tenant_id_key UNIQUE(university_id,id), CONSTRAINT platform_settings_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS platform_settings_tenant_created_idx ON public.platform_settings(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS platform_settings_creator_idx ON public.platform_settings(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_platform_settings() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS platform_settings_touch ON public.platform_settings; CREATE TRIGGER platform_settings_touch BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION private.touch_platform_settings();
CREATE TABLE IF NOT EXISTS public.feature_flags(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL, enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}'::jsonb, CONSTRAINT feature_flags_pkey PRIMARY KEY(id), CONSTRAINT feature_flags_tenant_id_key UNIQUE(university_id,id), CONSTRAINT feature_flags_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS feature_flags_tenant_created_idx ON public.feature_flags(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS feature_flags_creator_idx ON public.feature_flags(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY; ALTER TABLE public.feature_flags FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_feature_flags() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS feature_flags_touch ON public.feature_flags; CREATE TRIGGER feature_flags_touch BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION private.touch_feature_flags();
-- Rollback only in a later expand/contract migration after consumers and data retention obligations are cleared.

-- ============================================================================
-- SECTION 2: RLS (from docs/03-database/rls/foundation-auth.sql)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.current_university_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT university_id FROM public.university_memberships WHERE profile_id=(SELECT auth.uid()) AND status='active' $$;
CREATE OR REPLACE FUNCTION private.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE profile_id=(SELECT auth.uid()) AND revoked_at IS NULL) $$;
DROP POLICY IF EXISTS universities_tenant_access ON public.universities;
CREATE POLICY universities_tenant_access ON public.universities FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.universities FROM anon;
DROP POLICY IF EXISTS university_domains_tenant_access ON public.university_domains;
CREATE POLICY university_domains_tenant_access ON public.university_domains FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.university_domains FROM anon;
DROP POLICY IF EXISTS profiles_tenant_access ON public.profiles;
CREATE POLICY profiles_tenant_access ON public.profiles FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.profiles FROM anon;
DROP POLICY IF EXISTS university_memberships_tenant_access ON public.university_memberships;
CREATE POLICY university_memberships_tenant_access ON public.university_memberships FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.university_memberships FROM anon;
DROP POLICY IF EXISTS roles_tenant_access ON public.roles;
CREATE POLICY roles_tenant_access ON public.roles FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.roles FROM anon;
DROP POLICY IF EXISTS permissions_tenant_access ON public.permissions;
CREATE POLICY permissions_tenant_access ON public.permissions FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.permissions FROM anon;
DROP POLICY IF EXISTS role_permissions_tenant_access ON public.role_permissions;
CREATE POLICY role_permissions_tenant_access ON public.role_permissions FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.role_permissions FROM anon;
DROP POLICY IF EXISTS role_assignments_tenant_access ON public.role_assignments;
CREATE POLICY role_assignments_tenant_access ON public.role_assignments FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.role_assignments FROM anon;
DROP POLICY IF EXISTS role_assignment_history_tenant_access ON public.role_assignment_history;
CREATE POLICY role_assignment_history_tenant_access ON public.role_assignment_history FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.role_assignment_history FROM anon;
REVOKE UPDATE,DELETE ON public.role_assignment_history FROM anon,authenticated;
DROP POLICY IF EXISTS platform_admins_tenant_access ON public.platform_admins;
CREATE POLICY platform_admins_tenant_access ON public.platform_admins FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.platform_admins FROM anon;
DROP POLICY IF EXISTS invites_tenant_access ON public.invites;
CREATE POLICY invites_tenant_access ON public.invites FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.invites FROM anon;
DROP POLICY IF EXISTS platform_settings_tenant_access ON public.platform_settings;
CREATE POLICY platform_settings_tenant_access ON public.platform_settings FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.platform_settings FROM anon;
DROP POLICY IF EXISTS feature_flags_tenant_access ON public.feature_flags;
CREATE POLICY feature_flags_tenant_access ON public.feature_flags FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.feature_flags FROM anon;
-- Add narrow per-operation student/staff policies only after identity and role fixtures are defined; no client receives service_role.
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ============================================================================
-- SECTION 3: FUNCTIONS (from docs/03-database/functions/foundation-auth.sql)
-- ============================================================================

-- Security-definer RPCs must set search_path to empty, validate auth.uid(), verify tenant and role, and be granted narrowly.
-- Transactional module operations are defined as narrowly scoped RPCs in the API contract before UI consumers are implemented.
-- Rollback: revoke execute first; preserve append-only audit and financial history.

-- ============================================================================
-- SECTION 4: REGISTRY HELPER (docs/SYMBOL_REGISTRY.md v1 + plan.md §3 F5)
-- has_role() is listed in the registry's private-function contract and required
-- by the Foundation Gate checklist; its dependencies (roles, role_assignments)
-- exist in this migration. is_offering_staff()/is_enrolled() arrive with the
-- core-academics module (T-A003) whose tables do not exist yet.
-- ============================================================================
CREATE OR REPLACE FUNCTION private.has_role(p_university_id uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.role_assignments ra JOIN public.roles r ON r.id=ra.role_id AND r.university_id=ra.university_id WHERE ra.university_id=p_university_id AND ra.profile_id=(SELECT auth.uid()) AND r.name=p_role AND ra.revoked_at IS NULL) $$;

-- ============================================================================
-- ROLLBACK NOTE (expand/contract, plan.md / DECISIONS rollback rule)
-- ============================================================================
-- This migration is forward-only. Never drop/rename these tables or columns in
-- a later release without an expand/contract cycle: add nullable replacement ->
-- dual-write/read -> backfill -> verify -> switch consumers -> drop in a later
-- migration. Rollback = application rollback; schema rollback only via a new
-- forward corrective migration. Append-only history rows are never deleted.
