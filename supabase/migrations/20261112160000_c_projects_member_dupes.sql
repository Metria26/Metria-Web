-- ============================================================================
-- Projects: duplicate-member guards (owner QA 2026-11-12)
-- Lane: c  Module: projects
--
-- Two related holes in the add-member path, both found while reproducing the
-- "Please check the highlighted values and try again." report:
--
--   1. project_group_members had no uniqueness on (university_id, group_id,
--      profile_id), and project_validate_members' other-group check
--      deliberately excludes the TARGET group — so re-adding a student who is
--      already in that group (leader mistake, stale form, double click) would
--      insert a second member row for the same person.
--   2. The approval flow (decide_project_member_request) and the direct add
--      both go through project_validate_members, so the new own-group check
--      below covers every caller.
--   3. project_resolve_member matched email local parts with LIMIT 1 — two
--      profiles sharing a local part (import-created profile plus a later
--      signup) resolved to an arbitrary one, potentially adding the wrong
--      student to a group. Now disambiguated, fail-closed.
--
-- No data migration: the remote had zero member rows when this shipped; the
-- constraint add fails loudly if duplicates ever exist, which is the desired
-- fail-closed behavior.
--
-- Rollback: DROP CONSTRAINT project_group_members_group_profile_key and
-- restore the previous project_validate_members definition.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: hard DB stop for duplicate member rows (idempotent)
-- ----------------------------------------------------------------------------
ALTER TABLE public.project_group_members
  DROP CONSTRAINT IF EXISTS project_group_members_group_profile_key;
ALTER TABLE public.project_group_members
  ADD CONSTRAINT project_group_members_group_profile_key
  UNIQUE (university_id, group_id, profile_id);

-- ----------------------------------------------------------------------------
-- SECTION 2: project_validate_members raises duplicate_member for own-group
-- re-adds (same signature/behavior otherwise; create_project_group passes
-- p_group_id NULL and keeps the other-group check).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.project_validate_members(p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_group_id uuid, p_members jsonb, p_max_size integer) RETURNS TABLE(profile_id uuid, member_name text, member_reg_no text, member_email text, member_role text, member_resp text, member_pos integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item jsonb; v_count integer := 0; v_seen text[] := '{}'; v_norm text; v_pid uuid; v_profile public.profiles; v_name text; v_reg text; v_role text; v_resp text;
BEGIN
  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' OR jsonb_array_length(p_members) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_members) > p_max_size THEN RAISE EXCEPTION 'group_full'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_members) LOOP
    v_count := v_count + 1;
    IF v_count > 50 THEN RAISE EXCEPTION 'group_full'; END IF;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_reg := left(btrim(coalesce(v_item ->> 'reg_no', v_item ->> 'regNo', '')), 40);
    v_role := left(btrim(coalesce(v_item ->> 'member_role', v_item ->> 'memberRole', 'member')), 80);
    v_resp := left(btrim(coalesce(v_item ->> 'responsibilities', '')), 500);
    IF v_name = '' OR v_reg = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    v_norm := regexp_replace(lower(v_reg), '[^a-z0-9]', '', 'g');
    IF v_norm = ANY (v_seen) THEN RAISE EXCEPTION 'duplicate_member'; END IF;
    v_seen := array_append(v_seen, v_norm);
    v_pid := private.project_resolve_member(p_university_id, v_reg);
    IF v_pid IS NULL THEN RAISE EXCEPTION 'student_not_found'; END IF;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_pid;
    IF NOT EXISTS(
      SELECT 1 FROM public.enrollments e JOIN public.sections s ON s.id = e.section_id
      WHERE s.university_id = p_university_id AND s.offering_id = p_offering_id
        AND (p_section_id IS NULL OR s.id = p_section_id)
        AND e.profile_id = v_pid AND e.status = 'active'
    ) THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
    -- NEW: re-adding a student who is already a member of THIS group is a
    -- duplicate (the other-group check below excludes the target group, so
    -- without this guard the insert would double-row the same person).
    IF p_group_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.project_group_members m
      WHERE m.university_id = p_university_id AND m.group_id = p_group_id AND m.profile_id = v_pid
    ) THEN RAISE EXCEPTION 'duplicate_member'; END IF;
    IF EXISTS(
      SELECT 1 FROM public.project_group_members m
      JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
      JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
      WHERE d.university_id = p_university_id AND d.offering_id = p_offering_id
        AND g.deleted_at IS NULL AND g.archived_at IS NULL
        AND (p_group_id IS NULL OR g.id <> p_group_id)
        AND m.profile_id = v_pid
    ) THEN RAISE EXCEPTION 'student_in_group'; END IF;
    profile_id := v_pid;
    member_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_name);
    member_reg_no := v_reg;
    member_email := v_profile.email;
    member_role := v_role;
    member_resp := v_resp;
    member_pos := v_count - 1;
    RETURN NEXT;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 3: project_resolve_member disambiguation. Email local-part inputs
-- become ambiguous when several profiles share the local part (an
-- import-created profile plus a later signup with the same email). A single
-- candidate resolves directly; with several, only a candidate that has a
-- linked auth user is safely resolvable — otherwise fail closed
-- (student_not_found) rather than attribute the member to the wrong student.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.project_resolve_member(p_university_id uuid, p_input text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_raw text := lower(btrim(coalesce(p_input, ''))); v_norm text; v_local text := ''; v_alt text := ''; v_total integer; v_resolvable integer;
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  IF position('@' in v_raw) > 0 THEN
    SELECT count(*) INTO v_total FROM public.profiles
      WHERE university_id = p_university_id AND deleted_at IS NULL AND lower(email) = v_raw;
    IF v_total = 0 THEN RETURN NULL; END IF;
    IF v_total = 1 THEN
      RETURN (SELECT id FROM public.profiles
        WHERE university_id = p_university_id AND deleted_at IS NULL AND lower(email) = v_raw LIMIT 1);
    END IF;
    SELECT count(*) INTO v_resolvable FROM public.profiles
      WHERE university_id = p_university_id AND deleted_at IS NULL AND lower(email) = v_raw AND auth_user_id IS NOT NULL;
    IF v_resolvable = 1 THEN
      RETURN (SELECT id FROM public.profiles
        WHERE university_id = p_university_id AND deleted_at IS NULL AND lower(email) = v_raw AND auth_user_id IS NOT NULL
        ORDER BY created_at LIMIT 1);
    END IF;
    RETURN NULL;
  END IF;
  v_norm := regexp_replace(v_raw, '[^a-z0-9]', '', 'g');
  IF v_norm = '' OR length(v_norm) > 40 THEN RETURN NULL; END IF;
  IF v_norm ~ '^[a-z][0-9]{4,}$' THEN
    v_local := v_norm;
  ELSIF v_norm ~ '^[0-9]{2}[a-z][0-9]{2,}$' THEN
    v_local := substring(v_norm from 3 for 1) || substring(v_norm from 1 for 2) || substring(v_norm from 4);
  ELSE
    RETURN NULL;
  END IF;
  IF length(v_local) >= 4 AND length(v_local) < 7 THEN
    v_alt := substring(v_local from 1 for 3) || lpad(substring(v_local from 4), 4, '0');
  END IF;
  SELECT count(*) INTO v_total FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL
    AND (regexp_replace(lower(coalesce(roll_no, '')), '[^a-z0-9]', '', 'g') = v_norm
      OR split_part(lower(email), '@', 1) IN (v_local, NULLIF(v_alt, '')));
  IF v_total = 0 THEN RETURN NULL; END IF;
  IF v_total = 1 THEN
    RETURN (SELECT id FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL
      AND (regexp_replace(lower(coalesce(roll_no, '')), '[^a-z0-9]', '', 'g') = v_norm
        OR split_part(lower(email), '@', 1) IN (v_local, NULLIF(v_alt, ''))) LIMIT 1);
  END IF;
  SELECT count(*) INTO v_resolvable FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    AND (regexp_replace(lower(coalesce(roll_no, '')), '[^a-z0-9]', '', 'g') = v_norm
      OR split_part(lower(email), '@', 1) IN (v_local, NULLIF(v_alt, '')));
  IF v_resolvable = 1 THEN
    RETURN (SELECT id FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL AND auth_user_id IS NOT NULL
      AND (regexp_replace(lower(coalesce(roll_no, '')), '[^a-z0-9]', '', 'g') = v_norm
        OR split_part(lower(email), '@', 1) IN (v_local, NULLIF(v_alt, '')))
    ORDER BY created_at LIMIT 1);
  END IF;
  RETURN NULL;
END $$;
