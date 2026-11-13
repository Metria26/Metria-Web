-- ============================================================================
-- Projects & Group Management — section-scoped group membership (2026-11-13)
--
-- Owner request: students form their own groups by picking classmates from the
-- section connected to the project dashboard (no typed names / roll numbers),
-- and TAs no longer create groups.
--
-- Changes:
--   1. private.project_eligible_students — roster of active students in the
--      dashboard's section (or offering when no section is set), excluding the
--      caller and students already in a group for that offering.
--   2. private.project_validate_members — accepts an authoritative profile_id
--      per member; names/roll numbers are derived from profiles, not client
--      input. Legacy reg_no/email resolution stays for staff corrections.
--   3. private.create_project_group — student-only (leader = caller), Group ID
--      always issued server-side.
--   4. private.request_project_member_change — pending-add duplicate check also
--      keys on profile_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Section roster for the group picker
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.project_eligible_students(p_dashboard_id uuid) RETURNS TABLE(profile_id uuid, display_name text, roll_no text, email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_is_staff boolean;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_dash.status <> 'published' THEN RAISE EXCEPTION 'not_published'; END IF;
    IF (CASE WHEN v_dash.section_id IS NOT NULL THEN private.is_enrolled(v_dash.section_id) ELSE private.is_offering_enrolled(v_dash.offering_id) END) = false THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id,
    p.display_name,
    coalesce(nullif(btrim(p.roll_no), ''), split_part(p.email, '@', 1)) AS roll_no,
    p.email
  FROM public.enrollments e
  JOIN public.profiles p ON p.id = e.profile_id AND p.university_id = e.university_id AND p.deleted_at IS NULL
  WHERE e.university_id = v_dash.university_id
    AND e.status = 'active'
    AND p.id <> v_actor.id
    AND (CASE WHEN v_dash.section_id IS NOT NULL THEN e.section_id = v_dash.section_id
              ELSE e.section_id IN (SELECT s.id FROM public.sections s WHERE s.university_id = v_dash.university_id AND s.offering_id = v_dash.offering_id) END)
    AND NOT EXISTS(
      SELECT 1 FROM public.project_group_members m
      JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
      JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
      WHERE d.university_id = v_dash.university_id AND d.offering_id = v_dash.offering_id
        AND g.deleted_at IS NULL AND g.archived_at IS NULL
        AND m.profile_id = p.id
    )
  ORDER BY p.display_name, coalesce(nullif(btrim(p.roll_no), ''), split_part(p.email, '@', 1)) NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.list_project_eligible_students(p_dashboard_id uuid) RETURNS TABLE(profile_id uuid, display_name text, roll_no text, email text) LANGUAGE sql SET search_path = '' AS $$ SELECT * FROM private.project_eligible_students(p_dashboard_id) $$;

REVOKE EXECUTE ON FUNCTION private.project_eligible_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.project_eligible_students(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_project_eligible_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_eligible_students(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Member validation: profile_id is authoritative
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.project_validate_members(p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_group_id uuid, p_members jsonb, p_max_size integer) RETURNS TABLE(profile_id uuid, member_name text, member_reg_no text, member_email text, member_role text, member_resp text, member_pos integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item jsonb; v_count integer := 0; v_seen text[] := '{}'; v_norm text; v_pid text; v_pid_uuid uuid; v_profile public.profiles; v_name text; v_reg text; v_role text; v_resp text;
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
    v_pid := btrim(coalesce(v_item ->> 'profile_id', v_item ->> 'profileId', ''));

    IF v_pid = '' THEN
      IF v_name = '' OR v_reg = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    ELSE
      IF v_pid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'invalid_input'; END IF;
      v_pid_uuid := v_pid::uuid;
      SELECT * INTO v_profile FROM public.profiles WHERE id = v_pid_uuid AND university_id = p_university_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'student_not_found'; END IF;
      v_norm := v_pid_uuid::text;
      IF v_norm = ANY (v_seen) THEN RAISE EXCEPTION 'duplicate_member'; END IF;
      v_seen := array_append(v_seen, v_norm);
    END IF;

    IF v_pid_uuid IS NULL THEN
      v_norm := regexp_replace(lower(v_reg), '[^a-z0-9]', '', 'g');
      IF v_norm = ANY (v_seen) THEN RAISE EXCEPTION 'duplicate_member'; END IF;
      v_seen := array_append(v_seen, v_norm);
      v_pid_uuid := private.project_resolve_member(p_university_id, v_reg);
      IF v_pid_uuid IS NULL THEN RAISE EXCEPTION 'student_not_found'; END IF;
      SELECT * INTO v_profile FROM public.profiles WHERE id = v_pid_uuid;
    END IF;

    IF NOT EXISTS(
      SELECT 1 FROM public.enrollments e JOIN public.sections s ON s.id = e.section_id
      WHERE s.university_id = p_university_id AND s.offering_id = p_offering_id
        AND (p_section_id IS NULL OR s.id = p_section_id)
        AND e.profile_id = v_pid_uuid AND e.status = 'active'
    ) THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
    IF EXISTS(
      SELECT 1 FROM public.project_group_members m
      JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
      JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
      WHERE d.university_id = p_university_id AND d.offering_id = p_offering_id
        AND g.deleted_at IS NULL AND g.archived_at IS NULL
        AND (p_group_id IS NULL OR g.id <> p_group_id)
        AND m.profile_id = v_pid_uuid
    ) THEN RAISE EXCEPTION 'student_in_group'; END IF;

    profile_id := v_pid_uuid;
    member_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_name);
    member_reg_no := coalesce(nullif(btrim(coalesce(v_profile.roll_no, '')), ''), nullif(v_reg, ''), split_part(v_profile.email, '@', 1));
    member_email := v_profile.email;
    member_role := v_role;
    member_resp := v_resp;
    member_pos := v_count - 1;
    RETURN NEXT;

    v_pid_uuid := NULL;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Group creation is a student action (leader = caller)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_project_group(p_dashboard_id uuid, p_group_id text, p_project_title text, p_members jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_group_id text; v_new uuid; v_is_staff boolean; v_first uuid; v_pos integer := 0; v_resolved record;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  -- Groups are formed by students; staff manage existing groups instead.
  IF v_is_staff THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_dash.status <> 'published' THEN RAISE EXCEPTION 'not_published'; END IF;
  IF NOT v_dash.allow_student_groups THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF (CASE WHEN v_dash.section_id IS NOT NULL THEN private.is_enrolled(v_dash.section_id) ELSE private.is_offering_enrolled(v_dash.offering_id) END) = false THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.project_group_members m
    JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
    JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
    WHERE d.university_id = v_dash.university_id AND d.offering_id = v_dash.offering_id
      AND g.deleted_at IS NULL AND g.archived_at IS NULL AND m.profile_id = v_actor.id
  ) THEN RAISE EXCEPTION 'student_in_group'; END IF;

  IF btrim(coalesce(p_project_title, '')) = '' OR char_length(btrim(p_project_title)) > 160 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF coalesce(btrim(p_group_id, ''), '') <> '' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF btrim(v_dash.group_id_prefix) = '' THEN RAISE EXCEPTION 'prefix_required'; END IF;
  v_group_id := private.project_generate_group_id(v_dash.university_id, v_dash.id, v_dash.group_id_prefix, v_dash.group_id_seq + 1);

  -- The caller must be the first (leader) member of the group.
  FOR v_resolved IN SELECT * FROM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, NULL, p_members, v_dash.max_members) ORDER BY member_pos LOOP
    IF v_pos = 0 THEN v_first := v_resolved.profile_id; END IF;
    v_pos := v_pos + 1;
  END LOOP;
  IF v_pos = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_first IS DISTINCT FROM v_actor.id THEN RAISE EXCEPTION 'not_leader'; END IF;

  INSERT INTO public.project_group_id_ledger(university_id, created_by, dashboard_id, group_id) VALUES (v_dash.university_id, v_actor.id, v_dash.id, v_group_id);
  INSERT INTO public.project_groups(university_id, created_by, dashboard_id, group_id, project_title) VALUES (v_dash.university_id, v_actor.id, v_dash.id, v_group_id, btrim(p_project_title)) RETURNING id INTO v_new;

  INSERT INTO public.project_group_members(university_id, created_by, group_id, profile_id, name, reg_no, email, member_role, responsibilities, position)
  SELECT v_dash.university_id, v_actor.id, v_new, r.profile_id, r.member_name, r.member_reg_no, r.member_email, r.member_role, r.member_resp, r.member_pos
  FROM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, NULL, p_members, v_dash.max_members) r ORDER BY r.member_pos;

  UPDATE public.project_groups SET leader_member_id = (SELECT m.id FROM public.project_group_members m WHERE m.university_id = v_dash.university_id AND m.group_id = v_new AND m.profile_id = v_first) WHERE id = v_new;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_new, v_actor.id, 'student', v_actor.display_name, 'project.group.created', 'group', v_new, v_group_id, true, NULL, jsonb_build_object('group_id', v_group_id, 'title', btrim(p_project_title), 'members', v_pos));
  RETURN v_new;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Pending add-request duplicate check also keys on profile_id
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.request_project_member_change(p_group_id uuid, p_request_type text, p_member jsonb, p_member_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_new uuid; v_count integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT v_dash.require_member_change_approval THEN RAISE EXCEPTION 'approval_not_required'; END IF;
  IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
  IF v_group.submitted_at IS NOT NULL AND NOT v_dash.allow_member_changes_after_submission THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  IF p_request_type NOT IN ('add','remove') THEN RAISE EXCEPTION 'invalid_input'; END IF;

  IF p_request_type = 'add' THEN
    IF p_member IS NULL OR jsonb_typeof(p_member) <> 'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    SELECT count(*) INTO v_count FROM public.project_group_members WHERE university_id = v_group.university_id AND group_id = v_group.id;
    IF v_count + 1 > v_dash.max_members THEN RAISE EXCEPTION 'group_full'; END IF;
    -- Pre-validate the candidate the same way the apply step will.
    PERFORM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, v_group.id, jsonb_build_array(p_member), v_dash.max_members);
    IF EXISTS(
      SELECT 1 FROM public.project_member_requests r
      WHERE r.group_id = v_group.id AND r.status = 'pending' AND r.request_type = 'add'
        AND (
          (coalesce(nullif(p_member ->> 'profile_id', ''), nullif(p_member ->> 'profileId', '')) IS NOT NULL
            AND coalesce(r.payload ->> 'profile_id', r.payload ->> 'profileId') = coalesce(p_member ->> 'profile_id', p_member ->> 'profileId'))
          OR (coalesce(nullif(p_member ->> 'reg_no', ''), nullif(p_member ->> 'regNo', '')) IS NOT NULL
            AND lower(coalesce(r.payload ->> 'reg_no', r.payload ->> 'regNo', '')) = lower(coalesce(p_member ->> 'reg_no', p_member ->> 'regNo')))
        )
    ) THEN RAISE EXCEPTION 'request_pending'; END IF;
  ELSE
    IF p_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.project_group_members WHERE id = p_member_id AND university_id = v_group.university_id AND group_id = v_group.id) THEN RAISE EXCEPTION 'not_found'; END IF;
    IF p_member_id = v_group.leader_member_id THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF EXISTS(SELECT 1 FROM public.project_member_requests r WHERE r.group_id = v_group.id AND r.status = 'pending' AND r.request_type = 'remove' AND r.member_id = p_member_id) THEN RAISE EXCEPTION 'request_pending'; END IF;
  END IF;

  INSERT INTO public.project_member_requests(university_id, created_by, group_id, request_type, payload, member_id, requested_by)
  VALUES (v_group.university_id, v_actor.id, v_group.id, p_request_type, coalesce(p_member, jsonb_build_object('member_id', p_member_id)), p_member_id, v_actor.id)
  RETURNING id INTO v_new;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'student', v_actor.display_name, 'project.member.request.created', 'member_request', v_new, v_group.group_id, true, NULL, jsonb_build_object('type', p_request_type, 'payload', coalesce(p_member, jsonb_build_object('member_id', p_member_id))));
  RETURN v_new;
END $$;
