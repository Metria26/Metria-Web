-- ============================================================================
-- Migration: 20261019100000_a_enrollment_invites (Lane A, feature: bulk CSV
-- student import). Depends on: foundation, core-academics, auth-domain allowlist.
--
-- Purpose: Teaching staff upload a CSV of student roll numbers (e.g. 24L-0612).
-- Students who already have a profile (signed in once) are enrolled directly by
-- the server action. Students who have not signed in yet get a pending
-- enrollment_invites row keyed on their derived email; sync_auth_user_profile()
-- applies those invites automatically on first sign-in (AFTER INSERT on
-- auth.users).
--
-- Roll -> email: 24L-0612 -> l240612@lhr.nu.edu.pk (campus letter first,
-- lowercase, hyphen removed). alt_email stores a zero-padded serial variant so
-- spreadsheet tools that strip leading zeros still match on signup.
--
-- No deviation from the docs schema beyond the additive table (mirrors the
-- enrollments manage-policy family and standard housekeeping columns).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: enrollment_invites table + housekeeping
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollment_invites(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, section_id uuid NOT NULL, email text NOT NULL, alt_email text, roll_input text, status text NOT NULL DEFAULT 'pending', applied_profile_id uuid, applied_at timestamptz, CONSTRAINT enrollment_invites_pkey PRIMARY KEY(id), CONSTRAINT enrollment_invites_tenant_id_key UNIQUE(university_id,id), CONSTRAINT enrollment_invites_status_check CHECK(status IN ('pending','applied','cancelled')), CONSTRAINT enrollment_invites_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT enrollment_invites_section_id_tenant_fk FOREIGN KEY(university_id,section_id) REFERENCES public.sections(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS enrollment_invites_tenant_created_idx ON public.enrollment_invites(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS enrollment_invites_creator_idx ON public.enrollment_invites(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS enrollment_invites_section_status_idx ON public.enrollment_invites(university_id,section_id,status);
CREATE INDEX IF NOT EXISTS enrollment_invites_email_idx ON public.enrollment_invites(university_id,email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS enrollment_invites_alt_email_idx ON public.enrollment_invites(university_id,alt_email) WHERE status = 'pending' AND alt_email IS NOT NULL;
-- Re-uploading the same list while invites are still pending is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_invites_pending_uniq ON public.enrollment_invites(university_id,section_id,email) WHERE status = 'pending';
ALTER TABLE public.enrollment_invites ENABLE ROW LEVEL SECURITY; ALTER TABLE public.enrollment_invites FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_enrollment_invites() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS enrollment_invites_touch ON public.enrollment_invites; CREATE TRIGGER enrollment_invites_touch BEFORE UPDATE ON public.enrollment_invites FOR EACH ROW EXECUTE FUNCTION private.touch_enrollment_invites();

-- ----------------------------------------------------------------------------
-- SECTION 2: RLS policies (platform admin + offering staff manage only)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS enrollment_invites_tenant_access ON public.enrollment_invites;
CREATE POLICY enrollment_invites_tenant_access ON public.enrollment_invites FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
DROP POLICY IF EXISTS enrollment_invites_manage ON public.enrollment_invites;
CREATE POLICY enrollment_invites_manage ON public.enrollment_invites FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
REVOKE ALL ON public.enrollment_invites FROM anon;

-- ----------------------------------------------------------------------------
-- SECTION 3: apply pending invites on first sign-in. Replaces
-- private.sync_auth_user_profile() (owned by service_role, BYPASSRLS) with the
-- same provisioning logic plus invite application. Must stay schema-qualified
-- (search_path = '').
-- ----------------------------------------------------------------------------
SET LOCAL ROLE service_role;

CREATE OR REPLACE FUNCTION private.sync_auth_user_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := lower(coalesce(new.email, new.raw_user_meta_data ->> 'email'));
  v_admin text := private.bootstrap_admin_email();
  v_is_admin boolean := v_admin IS NOT NULL AND v_email = v_admin;
  v_university_id uuid;
  v_profile_id uuid;
  v_name text;
BEGIN
  IF v_is_admin THEN
    SELECT s.university_id INTO v_university_id
    FROM public.platform_settings s
    WHERE s.key = 'bootstrap_admin_email'
    LIMIT 1;
  ELSE
    SELECT d.university_id INTO v_university_id
    FROM public.university_domains d
    WHERE d.domain = split_part(v_email, '@', 2) AND d.is_allowed = true
    ORDER BY d.created_at
    LIMIT 1;
  END IF;

  IF v_university_id IS NULL THEN
    -- assert_signup_email_allowed should have blocked this; fail closed.
    RAISE EXCEPTION 'signup not allowed';
  END IF;

  v_name := nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), '');

  INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
  VALUES (v_university_id, new.id, coalesce(v_name, split_part(v_email, '@', 1)), v_email)
  ON CONFLICT (auth_user_id) DO UPDATE SET email = excluded.email
  RETURNING id INTO v_profile_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = v_university_id AND m.profile_id = v_profile_id
  ) THEN
    INSERT INTO public.university_memberships (university_id, profile_id, status)
    VALUES (v_university_id, v_profile_id, CASE WHEN v_is_admin THEN 'active' ELSE 'pending' END);
  END IF;

  IF v_is_admin THEN
    INSERT INTO public.platform_admins (university_id, profile_id, granted_by)
    VALUES (v_university_id, v_profile_id, NULL)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  -- Bulk-enrollment invites: enroll this profile in every section with a
  -- pending invite for this email (canonical or zero-padded variant).
  INSERT INTO public.enrollments (university_id, created_by, section_id, profile_id, status)
  SELECT i.university_id, i.created_by, i.section_id, v_profile_id, 'active'
  FROM public.enrollment_invites i
  WHERE i.university_id = v_university_id
    AND i.status = 'pending'
    AND (i.email = v_email OR i.alt_email = v_email)
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.university_id = i.university_id
        AND e.section_id = i.section_id
        AND e.profile_id = v_profile_id
    );

  UPDATE public.enrollment_invites
  SET status = 'applied',
      applied_profile_id = v_profile_id,
      applied_at = now()
  WHERE university_id = v_university_id
    AND status = 'pending'
    AND (email = v_email OR alt_email = v_email);

  RETURN new;
END
$$;

RESET ROLE;

-- ============================================================================
-- REGISTRY DELTA (docs/SYMBOL_REGISTRY.md v1, registry delta protocol)
-- ============================================================================
--   tables: public.enrollment_invites
--   functions (replaced): private.sync_auth_user_profile()
--   touch function: private.touch_enrollment_invites()
-- ============================================================================

-- ============================================================================
-- Rollback note (expand/contract):
--   DROP TABLE IF EXISTS public.enrollment_invites;
--   Restore the previous private.sync_auth_user_profile() body from
--   20261014213000_s_auth_domain_allowlist.sql (without the invite block).
--   No other table is touched.
-- ============================================================================
