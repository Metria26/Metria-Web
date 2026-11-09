-- ============================================================================
-- Migration: 20261110000000_a_booking_fixes
-- Fixes:
--   1. TA UI: private.period_booking_overview filters for 'active' bookings only.
--   2. Booking Limit: private.book_slot limits student to 2 active bookings per period.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.book_slot(p_university_id uuid, p_period_id uuid, p_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_section_id uuid;
  v_slot_ends timestamptz;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id
      AND m.profile_id = v_profile_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Serialize every booking attempt on the period row (P19)
  SELECT ep.section_id INTO v_section_id
  FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Booking limit: max 2 active bookings
  IF (
    SELECT count(*) FROM public.bookings b
    WHERE b.university_id = p_university_id
      AND b.period_id = p_period_id
      AND b.student_id = v_profile_id
      AND b.status = 'active'
  ) >= 2 THEN
    RAISE EXCEPTION 'too_many_bookings';
  END IF;

  IF NOT private.is_enrolled(v_section_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT s.ends_at INTO v_slot_ends
  FROM public.slots s
  WHERE s.university_id = p_university_id
    AND s.id = p_slot_id
    AND s.period_id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_slot_ends <= now() THEN
    RAISE EXCEPTION 'slot_ended';
  END IF;

  IF (
    SELECT count(*) FROM public.bookings b
    WHERE b.university_id = p_university_id
      AND b.slot_id = p_slot_id
      AND b.status = 'active'
  ) >= (
    SELECT s.capacity FROM public.slots s
    WHERE s.university_id = p_university_id AND s.id = p_slot_id
  ) THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  BEGIN
    INSERT INTO public.bookings (university_id, period_id, slot_id, student_id, created_by)
    VALUES (p_university_id, p_period_id, p_slot_id, v_profile_id, v_profile_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.period_booking_overview(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_is_staff boolean := false;
  v_can_manage boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT ep.* INTO v_period
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_is_staff := private.is_offering_staff(v_period.offering_id);
  v_can_manage := private.is_platform_admin()
    OR (v_is_staff AND private.has_permission(v_period.university_id, 'booking.manage_period'));

  IF NOT (v_can_manage OR v_is_staff OR private.is_enrolled(v_period.section_id)) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'period', (
      SELECT jsonb_build_object(
        'id', ep.id,
        'title', ep.title,
        'offering_id', ep.offering_id,
        'section_id', ep.section_id,
        'starts_at', ep.starts_at,
        'ends_at', ep.ends_at,
        'cutoff_hours', ep.cutoff_hours,
        'offering_code', o.offering_code,
        'course_code', c.code,
        'section_code', s.section_code
      )
      FROM public.evaluation_periods ep
      JOIN public.sections s
        ON s.university_id = ep.university_id AND s.id = ep.section_id
      JOIN public.course_offerings o
        ON o.university_id = ep.university_id AND o.id = ep.offering_id
      JOIN public.courses c
        ON c.university_id = o.university_id AND c.id = o.course_id
      WHERE ep.id = v_period.id
    ),
    'can_manage', v_can_manage,
    'slots', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'starts_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'id', sl.id,
          'starts_at', sl.starts_at,
          'ends_at', sl.ends_at,
          'capacity', sl.capacity,
          'location', sl.location,
          'booked', (
            SELECT count(*) FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.status = 'active'
          ),
          'my_booking_id', (
            SELECT b.id FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.student_id = v_profile_id
              AND b.status = 'active'
            LIMIT 1
          )
        ) AS row_json
        FROM public.slots sl
        WHERE sl.university_id = v_period.university_id
          AND sl.period_id = v_period.id
      ) slot_rows
    ), '[]'::jsonb),
    'students', CASE WHEN v_is_staff THEN COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'slot_starts_at' ASC, row_json->>'student_name' ASC)
      FROM (
        SELECT jsonb_build_object(
          'slot_id', b.slot_id,
          'slot_starts_at', sl.starts_at,
          'student_name', pr.display_name,
          'status', b.status
        ) AS row_json
        FROM public.bookings b
        JOIN public.slots sl
          ON sl.university_id = b.university_id AND sl.id = b.slot_id
        JOIN public.profiles pr
          ON pr.id = b.student_id
        WHERE b.university_id = v_period.university_id
          AND b.period_id = v_period.id
          AND b.status = 'active'
      ) booking_rows
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;
