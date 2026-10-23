-- ============================================================================
-- Migration: 20261024100000_a_student_visibility_and_safe_deletes
-- Lane: a  Module: student visibility / TA scoping / safe deletes
--
-- Fixes:
--   1. l242530@lhr.nu.edu.pk is a TA; remove leftover test-student role,
--      enrollment, marks and bookings for that account.
--   2. Activate memberships for profiles that already have active enrollments,
--      so students in enrolled sections can see their evaluation periods.
--   3. TA announcement read isolation: a TA sees their own announcements, a
--      teacher's announcements, and announcements in sections explicitly
--      assigned to them. Another TA's section announcements stay hidden.
--   4. Students may read only released assessments for offerings/sections they
--      are enrolled in; staff still read everything for offerings they staff.
--   5. Security-definer delete RPCs that remove dependent rows before the
--      parent row (FKs are ON DELETE RESTRICT by design).
--
-- Rollback: revoke the public wrappers and private functions, then restore the
-- previous announcements/assessments policies from
-- 20261016120000_a_announcements_dashboard.sql and
-- 20261015141145_a_core_academics.sql. The account data cleanup is data, not
-- schema; take a backup before running.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: account cleanup for l242530@lhr.nu.edu.pk
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_ta_role_id uuid;
BEGIN
  SELECT p.id, p.university_id
    INTO v_profile_id, v_uni
  FROM public.profiles p
  WHERE lower(p.email) = 'l242530@lhr.nu.edu.pk'
  ORDER BY p.created_at
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE NOTICE 'l242530 profile not found; skipping account cleanup';
    RETURN;
  END IF;

  -- Active membership.
  UPDATE public.university_memberships
  SET status = 'active', updated_at = now()
  WHERE university_id = v_uni AND profile_id = v_profile_id;

  IF NOT FOUND THEN
    INSERT INTO public.university_memberships (university_id, profile_id, status, created_by)
    VALUES (v_uni, v_profile_id, 'active', v_profile_id);
  END IF;

  -- Remove the student role (friend-created test account).
  UPDATE public.role_assignments ra
  SET revoked_at = now(), updated_at = now()
  FROM public.roles r
  WHERE ra.role_id = r.id
    AND ra.university_id = r.university_id
    AND ra.university_id = v_uni
    AND ra.profile_id = v_profile_id
    AND lower(r.name) = 'student'
    AND ra.revoked_at IS NULL;

  -- Ensure the TA role exists and is assigned.
  SELECT r.id INTO v_ta_role_id
  FROM public.roles r
  WHERE r.university_id = v_uni AND lower(r.name) = 'ta'
  LIMIT 1;

  IF v_ta_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.university_id = v_uni
      AND ra.profile_id = v_profile_id
      AND ra.role_id = v_ta_role_id
      AND ra.revoked_at IS NULL
  ) THEN
    INSERT INTO public.role_assignments
      (university_id, profile_id, role_id, assigned_by)
    VALUES (v_uni, v_profile_id, v_ta_role_id, v_profile_id);
  END IF;

  -- Staff them on any offering explicitly named by their TA role assignment.
  INSERT INTO public.offering_staff
    (university_id, offering_id, profile_id, staff_role, created_by)
  SELECT DISTINCT ra.university_id, ra.offering_id, ra.profile_id, 'ta', ra.profile_id
  FROM public.role_assignments ra
  JOIN public.roles r
    ON r.id = ra.role_id AND r.university_id = ra.university_id
  WHERE ra.university_id = v_uni
    AND ra.profile_id = v_profile_id
    AND ra.offering_id IS NOT NULL
    AND lower(r.name) = 'ta'
    AND ra.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.offering_staff os
      WHERE os.university_id = ra.university_id
        AND os.offering_id = ra.offering_id
        AND os.profile_id = ra.profile_id
    );

  -- Remove test-student activity for this account.
  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.student_id = v_profile_id
    AND b.university_id = v_uni
    AND sr.university_id = v_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE student_id = v_profile_id AND university_id = v_uni;

  DELETE FROM public.waitlist_entries
  WHERE student_id = v_profile_id AND university_id = v_uni;

  DELETE FROM public.mark_history mh
  USING public.marks m
  WHERE m.student_id = v_profile_id
    AND m.university_id = v_uni
    AND mh.mark_id = m.id
    AND mh.university_id = v_uni;

  DELETE FROM public.marks
  WHERE student_id = v_profile_id AND university_id = v_uni;

  DELETE FROM public.enrollment_invites
  WHERE university_id = v_uni
    AND (lower(email) = 'l242530@lhr.nu.edu.pk'
      OR lower(coalesce(alt_email, '')) = 'l242530@lhr.nu.edu.pk');

  DELETE FROM public.enrollments
  WHERE profile_id = v_profile_id AND university_id = v_uni;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 2: students with real enrollments must have active memberships
-- ----------------------------------------------------------------------------
INSERT INTO public.university_memberships (university_id, profile_id, status, created_by)
SELECT DISTINCT e.university_id, e.profile_id, 'active', e.profile_id
FROM public.enrollments e
WHERE e.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = e.university_id AND m.profile_id = e.profile_id
  );

UPDATE public.university_memberships m
SET status = 'active', updated_at = now()
WHERE m.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.university_id = m.university_id
      AND e.profile_id = m.profile_id
      AND e.status = 'active'
  );

-- Future enrollments must also activate the student's membership, otherwise a
-- bulk-imported student remains pending and never sees their booking periods.
CREATE OR REPLACE FUNCTION private.activate_membership_for_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.university_memberships
  SET status = 'active', updated_at = now()
  WHERE university_id = NEW.university_id AND profile_id = NEW.profile_id;

  IF NOT FOUND THEN
    INSERT INTO public.university_memberships (university_id, profile_id, status, created_by)
    VALUES (NEW.university_id, NEW.profile_id, 'active', NEW.created_by);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enrollments_activate_membership ON public.enrollments;
CREATE TRIGGER enrollments_activate_membership
AFTER INSERT OR UPDATE OF status ON public.enrollments
FOR EACH ROW
WHEN (NEW.status = 'active')
EXECUTE FUNCTION private.activate_membership_for_enrollment();

-- ----------------------------------------------------------------------------
-- SECTION 3: announcement visibility (TA section isolation)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS announcements_staff_read ON public.announcements;
CREATE POLICY announcements_staff_read ON public.announcements
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sections s
    JOIN public.offering_staff os
      ON os.university_id = s.university_id
     AND os.offering_id = s.offering_id
     AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
    WHERE s.university_id = announcements.university_id
      AND s.id = announcements.section_id
      AND (
        -- Teachers / coordinators keep offering-wide access.
        lower(os.staff_role) IN ('teacher', 'instructor', 'coordinator', 'owner', 'admin')
        -- A TA always sees their own announcements.
        OR announcements.author_id = (
          SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid())
        )
        -- Or a section explicitly assigned to this TA in role_assignments.
        OR EXISTS (
          SELECT 1
          FROM public.role_assignments ra
          JOIN public.roles r
            ON r.id = ra.role_id AND r.university_id = ra.university_id
          WHERE ra.university_id = announcements.university_id
            AND ra.profile_id = os.profile_id
            AND ra.section_id = announcements.section_id
            AND ra.revoked_at IS NULL
            AND lower(r.name) = 'ta'
        )
      )
  )
  OR private.is_enrolled(announcements.section_id)
);

-- ----------------------------------------------------------------------------
-- SECTION 4: released-assessments-only read policy for students
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS assessments_member_read ON public.assessments;
CREATE POLICY assessments_member_read ON public.assessments
FOR SELECT TO authenticated
USING (
  university_id IN (SELECT private.current_university_ids())
  AND (
    private.is_offering_staff(offering_id)
    OR (
      visibility = 'students'
      AND EXISTS (
        SELECT 1
        FROM public.sections s
        WHERE s.university_id = assessments.university_id
          AND s.offering_id = assessments.offering_id
          AND private.is_enrolled(s.id)
          AND (assessments.section_id IS NULL OR assessments.section_id = s.id)
      )
    )
  )
);

-- ----------------------------------------------------------------------------
-- SECTION 5: safe delete RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.delete_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id, p.university_id INTO v_profile_id, v_row_uni
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT a.university_id, s.offering_id INTO v_row_uni, v_offering_id
  FROM public.announcements a
  JOIN public.sections s ON s.id = a.section_id AND s.university_id = a.university_id
  WHERE a.id = p_announcement_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'academic.manage_offering'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.announcements WHERE id = p_announcement_id AND university_id = v_row_uni;
END $$;

CREATE OR REPLACE FUNCTION private.delete_enrollment(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id, p.university_id INTO v_profile_id, v_row_uni
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT e.university_id, s.offering_id INTO v_row_uni, v_offering_id
  FROM public.enrollments e
  JOIN public.sections s ON s.id = e.section_id AND s.university_id = e.university_id
  WHERE e.id = p_enrollment_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'academic.manage_offering'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.enrollments WHERE id = p_enrollment_id AND university_id = v_row_uni;
END $$;

CREATE OR REPLACE FUNCTION private.delete_assessment(p_assessment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT a.university_id, a.offering_id INTO v_row_uni, v_offering_id
  FROM public.assessments a WHERE a.id = p_assessment_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'academic.manage_offering'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mark_history mh
  USING public.marks m
  WHERE m.assessment_id = p_assessment_id
    AND m.university_id = v_row_uni
    AND mh.mark_id = m.id
    AND mh.university_id = v_row_uni;

  DELETE FROM public.marks
  WHERE assessment_id = p_assessment_id AND university_id = v_row_uni;

  DELETE FROM public.import_rows ir
  USING public.import_batches ib
  WHERE ib.assessment_id = p_assessment_id
    AND ib.university_id = v_row_uni
    AND ir.batch_id = ib.id
    AND ir.university_id = v_row_uni;

  DELETE FROM public.import_batches
  WHERE assessment_id = p_assessment_id AND university_id = v_row_uni;

  DELETE FROM public.assessments
  WHERE id = p_assessment_id AND university_id = v_row_uni;
END $$;

CREATE OR REPLACE FUNCTION private.delete_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_period_id uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT s.university_id, s.period_id, ep.offering_id
    INTO v_row_uni, v_period_id, v_offering_id
  FROM public.slots s
  JOIN public.evaluation_periods ep
    ON ep.id = s.period_id AND ep.university_id = s.university_id
  WHERE s.id = p_slot_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.slot_id = p_slot_id
    AND b.university_id = v_row_uni
    AND sr.university_id = v_row_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE slot_id = p_slot_id AND university_id = v_row_uni;

  DELETE FROM public.waitlist_entries
  WHERE slot_id = p_slot_id AND university_id = v_row_uni;

  DELETE FROM public.slots
  WHERE id = p_slot_id AND university_id = v_row_uni;
END $$;

CREATE OR REPLACE FUNCTION private.delete_evaluation_period(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT ep.university_id, ep.offering_id INTO v_row_uni, v_offering_id
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.period_id = p_period_id
    AND b.university_id = v_row_uni
    AND sr.university_id = v_row_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE period_id = p_period_id AND university_id = v_row_uni;

  DELETE FROM public.waitlist_entries w
  USING public.slots s
  WHERE s.period_id = p_period_id
    AND s.university_id = v_row_uni
    AND w.slot_id = s.id
    AND w.university_id = v_row_uni;

  DELETE FROM public.slots
  WHERE period_id = p_period_id AND university_id = v_row_uni;

  DELETE FROM public.evaluation_periods
  WHERE id = p_period_id AND university_id = v_row_uni;
END $$;

CREATE OR REPLACE FUNCTION private.delete_section_cascade(p_section_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_row_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT s.university_id, s.offering_id INTO v_row_uni, v_offering_id
  FROM public.sections s WHERE s.id = p_section_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(v_row_uni, 'academic.manage_offering'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Swap requests, bookings, waitlists, slots and periods of this section.
  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.university_id = v_row_uni
    AND b.period_id IN (
      SELECT ep.id FROM public.evaluation_periods ep
      WHERE ep.section_id = p_section_id AND ep.university_id = v_row_uni
    )
    AND sr.university_id = v_row_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings b
  USING public.evaluation_periods ep
  WHERE b.period_id = ep.id
    AND b.university_id = v_row_uni
    AND ep.section_id = p_section_id
    AND ep.university_id = v_row_uni;

  DELETE FROM public.waitlist_entries w
  USING public.slots s, public.evaluation_periods ep
  WHERE s.period_id = ep.id
    AND ep.section_id = p_section_id
    AND s.university_id = v_row_uni
    AND ep.university_id = v_row_uni
    AND w.slot_id = s.id
    AND w.university_id = v_row_uni;

  DELETE FROM public.slots s
  USING public.evaluation_periods ep
  WHERE s.period_id = ep.id
    AND ep.section_id = p_section_id
    AND s.university_id = v_row_uni
    AND ep.university_id = v_row_uni;

  DELETE FROM public.evaluation_periods
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  -- Marks, import rows and assessments of this section.
  DELETE FROM public.mark_history mh
  USING public.marks m, public.assessments a
  WHERE m.assessment_id = a.id
    AND a.section_id = p_section_id
    AND m.university_id = v_row_uni
    AND a.university_id = v_row_uni
    AND mh.mark_id = m.id
    AND mh.university_id = v_row_uni;

  DELETE FROM public.marks m
  USING public.assessments a
  WHERE m.assessment_id = a.id
    AND a.section_id = p_section_id
    AND m.university_id = v_row_uni
    AND a.university_id = v_row_uni;

  DELETE FROM public.import_rows ir
  USING public.import_batches ib, public.assessments a
  WHERE ib.assessment_id = a.id
    AND a.section_id = p_section_id
    AND ib.university_id = v_row_uni
    AND a.university_id = v_row_uni
    AND ir.batch_id = ib.id
    AND ir.university_id = v_row_uni;

  DELETE FROM public.import_batches ib
  USING public.assessments a
  WHERE ib.assessment_id = a.id
    AND a.section_id = p_section_id
    AND ib.university_id = v_row_uni
    AND a.university_id = v_row_uni;

  DELETE FROM public.assessments
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  DELETE FROM public.announcements
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  DELETE FROM public.enrollment_invites
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  UPDATE public.role_assignments
  SET section_id = NULL, updated_at = now()
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  DELETE FROM public.enrollments
  WHERE section_id = p_section_id AND university_id = v_row_uni;

  DELETE FROM public.sections
  WHERE id = p_section_id AND university_id = v_row_uni;
END $$;

-- Public wrappers (PostgREST routes only public schema).
CREATE OR REPLACE FUNCTION public.delete_announcement(p_announcement_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_announcement(p_announcement_id) $$;

CREATE OR REPLACE FUNCTION public.delete_enrollment(p_enrollment_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_enrollment(p_enrollment_id) $$;

CREATE OR REPLACE FUNCTION public.delete_assessment(p_assessment_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_assessment(p_assessment_id) $$;

CREATE OR REPLACE FUNCTION public.delete_slot(p_slot_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_slot(p_slot_id) $$;

CREATE OR REPLACE FUNCTION public.delete_evaluation_period(p_period_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_evaluation_period(p_period_id) $$;

CREATE OR REPLACE FUNCTION public.delete_section_cascade(p_section_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS
$$ SELECT private.delete_section_cascade(p_section_id) $$;

GRANT EXECUTE ON FUNCTION private.delete_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_assessment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_evaluation_period(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_section_cascade(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.delete_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_assessment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_evaluation_period(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_section_cascade(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.delete_announcement(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_enrollment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_assessment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_slot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_evaluation_period(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_section_cascade(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.delete_announcement(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_enrollment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_assessment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_slot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_evaluation_period(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_section_cascade(uuid) FROM PUBLIC, anon;
