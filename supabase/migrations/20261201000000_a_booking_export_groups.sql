-- Group-aware evaluation booking export.
--
-- Bookings are made by one student per project group, but the evaluator's mark
-- sheet must list every current member of that group. This RPC resolves the
-- student's group from the live project dashboard for the period's offering and
-- section (the same link the projects feature uses), then returns the current
-- member rows. It is SECURITY DEFINER and staff-only so students cannot read
-- another group's roster through the export endpoint.

BEGIN;

CREATE OR REPLACE FUNCTION private.booking_export_groups(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_university_id uuid;
  v_offering_id uuid;
  v_section_id uuid;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT ep.university_id, ep.offering_id, ep.section_id
  INTO v_university_id, v_offering_id, v_section_id
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id;

  IF v_university_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF NOT (
    COALESCE(private.is_platform_admin(), false)
    OR COALESCE(private.is_offering_staff(v_offering_id), false)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'bookingId', b.id,
        'groupId', chosen.group_id,
        'memberCount', members.member_count,
        'members', members.members
      )
      ORDER BY b.created_at, b.id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.bookings b
  -- A student can belong to more than one dashboard in an offering. Prefer the
  -- dashboard for this period's section; fall back to an offering-wide one.
  JOIN LATERAL (
    SELECT pg.id AS group_row_id, pg.group_id
    FROM public.project_groups pg
    JOIN public.project_dashboards pd
      ON pd.university_id = pg.university_id
     AND pd.id = pg.dashboard_id
    JOIN public.project_group_members m
      ON m.university_id = pg.university_id
     AND m.group_id = pg.id
    WHERE pg.university_id = v_university_id
      AND pd.university_id = v_university_id
      AND pd.offering_id = v_offering_id
      AND pd.deleted_at IS NULL
      AND pg.deleted_at IS NULL
      AND pg.archived_at IS NULL
      AND m.profile_id = b.student_id
      AND (pd.section_id IS NULL OR pd.section_id = v_section_id)
    ORDER BY
      (pd.section_id = v_section_id) DESC,
      (pd.section_id IS NOT NULL) DESC,
      pg.created_at DESC,
      pg.id DESC
    LIMIT 1
  ) chosen ON TRUE
  JOIN LATERAL (
    SELECT
      count(*)::integer AS member_count,
      jsonb_agg(
        jsonb_build_object(
          'profileId', m.profile_id,
          'name', COALESCE(NULLIF(pr.display_name, ''), m.name),
          'rollNo', COALESCE(
            NULLIF(m.reg_no, ''),
            NULLIF(pr.roll_no, ''),
            split_part(COALESCE(pr.email, m.email), '@', 1),
            ''
          ),
          'email', COALESCE(NULLIF(pr.email, ''), NULLIF(m.email, ''), ''),
          'isBooker', m.profile_id = b.student_id
        )
        ORDER BY
          (m.profile_id = b.student_id) DESC,
          lower(COALESCE(NULLIF(pr.display_name, ''), m.name)),
          m.position,
          m.id
      ) AS members
    FROM public.project_group_members m
    LEFT JOIN public.profiles pr ON pr.id = m.profile_id
    WHERE m.university_id = v_university_id
      AND m.group_id = chosen.group_row_id
  ) members ON TRUE
  WHERE b.university_id = v_university_id
    AND b.period_id = p_period_id
    AND b.status = 'active';

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_export_groups(p_period_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.booking_export_groups(p_period_id) $$;

REVOKE ALL ON FUNCTION public.booking_export_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_export_groups(uuid) TO authenticated;

COMMIT;
