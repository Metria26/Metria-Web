-- ============================================================================
-- Migration: 20261108100000_a_booking_delete_bulk_switch
-- Lane: a  Module: academics/booking upgrade (staff deletes + audit, capacity
--                 guard, bulk slot generation, switch booking, consistent
--                 student ordering)
--
-- Builds on: 20261024100000_a_student_visibility_and_safe_deletes (delete RPCs
-- exist but wrote no audit rows, had no released-marks guard and no offering
-- delete), 20261016180000_a_evaluation_booking (book_slot/cancel_booking),
-- 20261015190000_a_marks_import (offering_marksheet), and
-- 20261015141145_a_core_academics (helpers/permissions).
--
-- Adds (all changes are replace-in-place or additive; no column is renamed or
-- dropped in this release, so the expand/contract rule is satisfied):
--   1. private.natural_sort_key(text) - IMMUTABLE case-insensitive numeric-
--      aware sort key used to order students by the part before '@'
--      (l250616 before l257689) everywhere rosters are produced in SQL.
--   2. Every delete RPC now writes one append-only public.audit_log row and
--      the destructive ones (assessment / section / offering) refuse to
--      destroy RELEASED marks (assessments visibility='students' carrying
--      scored marks) unless p_force=true. New RPC
--      private.delete_course_offering(p_offering_id uuid, p_force boolean
--      DEFAULT false) completes the staff deletion surface; and
--      private.delete_cascade_preview powers exact confirmation copy with
--      authoritative child counts.
--   3. private.update_slot_capacity - staff capacity edit that refuses to go
--      below the current number of active bookings (capacity_below_bookings).
--   4. private.create_slots_bulk - one atomic RPC that generates capacity-N
--      slots across a date range (or a per-day slot count) with an optional
--      gap, interpreting date+time inputs in Asia/Karachi (fixed UTC+05,
--      DST-free), validating the schedule against the period window, rejecting
--      overlaps (slot_overlap), capping at 500 created slots per request
--      (too_many_slots) and returning the created count.
--   5. private.switch_booking - atomic "move my booking to another free slot":
--      locks the period row (same lock order as book_slot, so concurrent
--      switchers/bookers serialize), checks the target capacity and the D11
--      cutoff against the CURRENT slot start, then cancels the old booking and
--      inserts the new one in the same transaction - the student can never end
--      up with zero or two active bookings, and a full target leaves the old
--      booking untouched.
--   6. private.period_booking_overview: staff bookings rows gain student_email
--      and booked_at and the staff list is ordered by slot start then
--      natural_sort_key(email). Students keep availability counts + own
--      booking only; emails never leave staff views.
--
-- HARD vs SOFT DELETE DECISION (per entity):
--   - announcements, sections, assessments, enrollments, course_offerings,
--     evaluation_periods, slots: HARD delete. None of these tables carries a
--     -deleted_at- column in the canonical docs schema, adding one now would
--     be dead schema for every existing reader, and the staff surface codified
--     by 20261024100000 already performs explicit cascade removal. The audit
--     trail is the recovery record.
--   - bookings: stay append-only business records (T-A006 rollback rule);
--     students cancel (status='cancelled'), never delete. The slot/period/
--     section/offering cascades below still REMOVE booking rows physically
--     because the parent key ceases to exist with RESTRICT FKs; the audit
--     payload records how many were released and the slot window, so the
--     trace survives.
--   - marks / mark_history: never silently destroyed. The destructive RPCs
--     raise marks_protected (42501-class) when released marks would be lost
--     unless the staff caller passes p_force=true from the typed confirmation
--     dialog; each path still writes its audit row.
--
-- Rollback: replace-in-place of RPC bodies and two payload extensions.
-- Restore the previous bodies by re-running the 20261024100000 SECTION 5
-- functions and the 20261016180000 period_booking_overview body (the
-- students array loses student_email/booked_at only). No table or column
-- changes were made, so a data restore is unnecessary.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ----------------------------------------------------------------------------
-- SECTION 1: natural sort key (registry delta 2026-11-08)
-- ----------------------------------------------------------------------------

-- Case-insensitive, numeric-aware ordering key: digit runs are zero-padded so
-- l250616 < l257689 and 2foo < 10foo compare correctly. Used by the roster
-- RPCs; the TS mirror (src/lib/student-sort.ts) produces the same order for
-- client-only lists.
CREATE OR REPLACE FUNCTION private.natural_sort_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT COALESCE(string_agg(
           CASE WHEN m.piece[1] ~ '^[0-9]+$' THEN lpad(m.piece[1], 12, '0') ELSE m.piece[1] END,
           '' ORDER BY m.ord
         ), '')
  FROM regexp_matches(lower(p_text), '([0-9]+|[^0-9]+)', 'g') WITH ORDINALITY AS m(piece, ord)
$$;

GRANT EXECUTE ON FUNCTION private.natural_sort_key(text) TO authenticated;

-- One append-only audit row per successful destructive action. Called from the
-- SECURITY DEFINER delete RPCs (audit_log requires platform-admin RLS for
-- interactive writes; definer supply-side writes are the service path).
CREATE OR REPLACE FUNCTION private.write_delete_audit(
  p_university_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_target_type text,
  p_target_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (university_id, created_by, actor_id, event_type, target_type, target_id, payload)
  VALUES (p_university_id, p_actor_id, p_actor_id, p_event_type, p_target_type, p_target_id, p_payload);
END $$;

-- Shared permission gate for academic deletes: platform admin, or staff of the
-- offering holding academic.manage_offering.
CREATE OR REPLACE FUNCTION private.assert_offering_delete_permission(
  p_university_id uuid,
  p_offering_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(p_offering_id)
        AND private.has_permission(p_university_id, 'academic.manage_offering'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END $$;

-- Shared permission gate for booking deletes: platform admin, or staff of the
-- offering holding booking.manage_period.
CREATE OR REPLACE FUNCTION private.assert_period_manage_permission(
  p_university_id uuid,
  p_offering_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(p_offering_id)
        AND private.has_permission(p_university_id, 'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 2: re-entrant delete RPCs (audit rows + released-marks guard)
-- ----------------------------------------------------------------------------
-- Same public names as 20261024100000; the assessment and section variants
-- gain a p_force boolean (DEFAULT false) applied from the typed confirmation
-- dialog. Old one-argument signatures are dropped AFTER the new ones are
-- created to avoid overload ambiguity.

CREATE OR REPLACE FUNCTION private.delete_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_title text;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT a.university_id, s.offering_id, a.title INTO v_uni, v_offering_id, v_title
  FROM public.announcements a
  JOIN public.sections s ON s.id = a.section_id AND s.university_id = a.university_id
  WHERE a.id = p_announcement_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  -- Author of the row OR offering staff with academic.manage_offering.
  IF NOT private.is_platform_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.announcements a2
      WHERE a2.id = p_announcement_id AND a2.author_id = v_profile_id
    ) THEN
      PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);
    END IF;
  END IF;

  DELETE FROM public.announcements WHERE id = p_announcement_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'academics.announcement.deleted',
    'announcement', p_announcement_id,
    jsonb_build_object('title', v_title));
END $$;

CREATE OR REPLACE FUNCTION private.delete_enrollment(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_section_id uuid;
  v_student_email text;
  v_status text;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT e.university_id, s.offering_id, e.section_id, pr.email, e.status
    INTO v_uni, v_offering_id, v_section_id, v_student_email, v_status
  FROM public.enrollments e
  JOIN public.sections s ON s.id = e.section_id AND s.university_id = e.university_id
  LEFT JOIN public.profiles pr ON pr.id = e.profile_id
  WHERE e.id = p_enrollment_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);

  DELETE FROM public.enrollments WHERE id = p_enrollment_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'academics.enrollment.deleted',
    'enrollment', p_enrollment_id,
    jsonb_build_object('section_id', v_section_id, 'status', v_status, 'student_email', v_student_email));
END $$;

CREATE OR REPLACE FUNCTION private.delete_assessment(p_assessment_id uuid, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_title text;
  v_marks int;
  v_import_batches int;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT a.university_id, a.offering_id, a.title INTO v_uni, v_offering_id, v_title
  FROM public.assessments a WHERE a.id = p_assessment_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);

  SELECT count(*)::int, count(DISTINCT ib.id)::int
    INTO v_marks, v_import_batches
  FROM public.marks m
  LEFT JOIN public.import_batches ib
    ON ib.university_id = v_uni AND ib.assessment_id = p_assessment_id
  WHERE m.university_id = v_uni AND m.assessment_id = p_assessment_id;

  -- Released marks must never be silently destroyed: refuse unless staff
  -- explicitly confirmed (typed dialog passes p_force).
  IF NOT p_force THEN
    IF EXISTS (
      SELECT 1 FROM public.marks m
      JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
      WHERE m.university_id = v_uni AND m.assessment_id = p_assessment_id
        AND m.score IS NOT NULL AND a.visibility = 'students'
    ) THEN
      RAISE EXCEPTION 'marks_protected';
    END IF;
  END IF;

  DELETE FROM public.mark_history mh
  USING public.marks m
  WHERE m.assessment_id = p_assessment_id
    AND m.university_id = v_uni
    AND mh.mark_id = m.id
    AND mh.university_id = v_uni;

  DELETE FROM public.marks
  WHERE assessment_id = p_assessment_id AND university_id = v_uni;

  DELETE FROM public.import_rows ir
  USING public.import_batches ib
  WHERE ib.assessment_id = p_assessment_id
    AND ib.university_id = v_uni
    AND ir.batch_id = ib.id
    AND ir.university_id = v_uni;

  DELETE FROM public.import_batches
  WHERE assessment_id = p_assessment_id AND university_id = v_uni;

  DELETE FROM public.assessments
  WHERE id = p_assessment_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'academics.assessment.deleted',
    'assessment', p_assessment_id,
    jsonb_build_object('title', v_title, 'marks', v_marks, 'import_batches', v_import_batches, 'force', p_force));
END $$;

CREATE OR REPLACE FUNCTION private.delete_section_cascade(p_section_id uuid, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_code text;
  v_enrollments int; v_assessments int; v_marks int; v_announcements int;
  v_invites int; v_periods int; v_slots int; v_bookings int;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT s.university_id, s.offering_id, s.section_code INTO v_uni, v_offering_id, v_code
  FROM public.sections s WHERE s.id = p_section_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);

  -- Authoritative child counts BEFORE deletion (audit payload).
  SELECT (SELECT count(*) FROM public.enrollments e WHERE e.section_id = p_section_id AND e.university_id = v_uni),
         (SELECT count(*) FROM public.assessments a WHERE a.section_id = p_section_id AND a.university_id = v_uni),
         (SELECT count(*) FROM public.marks m
            JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
          WHERE a.section_id = p_section_id AND a.university_id = v_uni),
         (SELECT count(*) FROM public.announcements an WHERE an.section_id = p_section_id AND an.university_id = v_uni),
         (SELECT count(*) FROM public.enrollment_invites i WHERE i.section_id = p_section_id AND i.university_id = v_uni),
         (SELECT count(*) FROM public.evaluation_periods ep WHERE ep.section_id = p_section_id AND ep.university_id = v_uni),
         (SELECT count(*) FROM public.slots sl
            JOIN public.evaluation_periods ep ON ep.id = sl.period_id AND ep.university_id = sl.university_id
          WHERE ep.section_id = p_section_id AND ep.university_id = v_uni),
         (SELECT count(*) FROM public.bookings b
            JOIN public.evaluation_periods ep ON ep.id = b.period_id AND ep.university_id = b.university_id
          WHERE ep.section_id = p_section_id AND ep.university_id = v_uni)
    INTO v_enrollments, v_assessments, v_marks, v_announcements, v_invites, v_periods, v_slots, v_bookings;

  -- Released marks must never be silently destroyed.
  IF NOT p_force THEN
    IF EXISTS (
      SELECT 1 FROM public.marks m
      JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
      WHERE a.section_id = p_section_id AND a.university_id = v_uni
        AND m.score IS NOT NULL AND a.visibility = 'students'
    ) THEN
      RAISE EXCEPTION 'marks_protected';
    END IF;
  END IF;

  -- Swap requests, bookings, waitlists, slots and periods of this section.
  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.university_id = v_uni
    AND b.period_id IN (
      SELECT ep.id FROM public.evaluation_periods ep
      WHERE ep.section_id = p_section_id AND ep.university_id = v_uni
    )
    AND sr.university_id = v_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings b
  USING public.evaluation_periods ep
  WHERE b.period_id = ep.id
    AND b.university_id = v_uni
    AND ep.section_id = p_section_id
    AND ep.university_id = v_uni;

  DELETE FROM public.waitlist_entries w
  USING public.slots s, public.evaluation_periods ep
  WHERE s.period_id = ep.id
    AND ep.section_id = p_section_id
    AND s.university_id = v_uni
    AND ep.university_id = v_uni
    AND w.slot_id = s.id
    AND w.university_id = v_uni;

  DELETE FROM public.slots s
  USING public.evaluation_periods ep
  WHERE s.period_id = ep.id
    AND ep.section_id = p_section_id
    AND s.university_id = v_uni
    AND ep.university_id = v_uni;

  DELETE FROM public.evaluation_periods
  WHERE section_id = p_section_id AND university_id = v_uni;

  -- Marks, import rows and assessments of this section.
  DELETE FROM public.mark_history mh
  USING public.marks m, public.assessments a
  WHERE m.assessment_id = a.id
    AND a.section_id = p_section_id
    AND m.university_id = v_uni
    AND a.university_id = v_uni
    AND mh.mark_id = m.id
    AND mh.university_id = v_uni;

  DELETE FROM public.marks m
  USING public.assessments a
  WHERE m.assessment_id = a.id
    AND a.section_id = p_section_id
    AND m.university_id = v_uni
    AND a.university_id = v_uni;

  DELETE FROM public.import_rows ir
  USING public.import_batches ib, public.assessments a
  WHERE ib.assessment_id = a.id
    AND a.section_id = p_section_id
    AND ib.university_id = v_uni
    AND a.university_id = v_uni
    AND ir.batch_id = ib.id
    AND ir.university_id = v_uni;

  DELETE FROM public.import_batches ib
  USING public.assessments a
  WHERE ib.assessment_id = a.id
    AND a.section_id = p_section_id
    AND ib.university_id = v_uni
    AND a.university_id = v_uni;

  DELETE FROM public.assessments
  WHERE section_id = p_section_id AND university_id = v_uni;

  DELETE FROM public.announcements
  WHERE section_id = p_section_id AND university_id = v_uni;

  DELETE FROM public.enrollment_invites
  WHERE section_id = p_section_id AND university_id = v_uni;

  UPDATE public.role_assignments
  SET section_id = NULL, updated_at = now()
  WHERE section_id = p_section_id AND university_id = v_uni;

  DELETE FROM public.enrollments
  WHERE section_id = p_section_id AND university_id = v_uni;

  DELETE FROM public.sections
  WHERE id = p_section_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'academics.section.deleted',
    'section', p_section_id,
    jsonb_build_object('section_code', v_code, 'enrollments', v_enrollments, 'assessments', v_assessments,
                       'marks', v_marks, 'announcements', v_announcements, 'invites', v_invites,
                       'periods', v_periods, 'slots', v_slots, 'bookings', v_bookings, 'force', p_force));
END $$;

CREATE OR REPLACE FUNCTION private.delete_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_period_id uuid;
  v_offering_id uuid;
  v_starts timestamptz;
  v_bookings int;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT s.university_id, s.period_id, ep.offering_id, s.starts_at
    INTO v_uni, v_period_id, v_offering_id, v_starts
  FROM public.slots s
  JOIN public.evaluation_periods ep
    ON ep.id = s.period_id AND ep.university_id = s.university_id
  WHERE s.id = p_slot_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_period_manage_permission(v_uni, v_offering_id);

  SELECT count(*)::int INTO v_bookings
  FROM public.bookings b WHERE b.slot_id = p_slot_id AND b.university_id = v_uni;

  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.slot_id = p_slot_id
    AND b.university_id = v_uni
    AND sr.university_id = v_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE slot_id = p_slot_id AND university_id = v_uni;

  DELETE FROM public.waitlist_entries
  WHERE slot_id = p_slot_id AND university_id = v_uni;

  DELETE FROM public.slots
  WHERE id = p_slot_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'booking.slot.deleted',
    'slot', p_slot_id,
    jsonb_build_object('period_id', v_period_id, 'starts_at', v_starts, 'bookings_released', v_bookings));
END $$;

CREATE OR REPLACE FUNCTION private.delete_evaluation_period(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_title text;
  v_slots int; v_bookings int;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT ep.university_id, ep.offering_id, ep.title INTO v_uni, v_offering_id, v_title
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_period_manage_permission(v_uni, v_offering_id);

  SELECT (SELECT count(*) FROM public.slots s WHERE s.period_id = p_period_id AND s.university_id = v_uni),
         (SELECT count(*) FROM public.bookings b WHERE b.period_id = p_period_id AND b.university_id = v_uni)
    INTO v_slots, v_bookings;

  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.period_id = p_period_id
    AND b.university_id = v_uni
    AND sr.university_id = v_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE period_id = p_period_id AND university_id = v_uni;

  DELETE FROM public.waitlist_entries w
  USING public.slots s
  WHERE s.period_id = p_period_id
    AND s.university_id = v_uni
    AND w.slot_id = s.id
    AND w.university_id = v_uni;

  DELETE FROM public.slots
  WHERE period_id = p_period_id AND university_id = v_uni;

  DELETE FROM public.evaluation_periods
  WHERE id = p_period_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'booking.period.deleted',
    'period', p_period_id,
    jsonb_build_object('title', v_title, 'slots_released', v_slots, 'bookings_released', v_bookings));
END $$;

-- Offerings: the only delete RPC that had no implementation at all. Sections
-- cascade through delete_section_cascade logic below (inlined pieces would be
-- duplicated; reuse via direct per-section calls keeps one cascade path).
CREATE OR REPLACE FUNCTION private.delete_course_offering(p_offering_id uuid, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_code text;
  v_sections int; v_enrollments int; v_assessments int; v_marks int;
  v_periods int; v_slots int; v_bookings int;
  v_section record;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT co.university_id, co.offering_code INTO v_uni, v_code
  FROM public.course_offerings co WHERE co.id = p_offering_id;
  IF v_code IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_offering_delete_permission(v_uni, p_offering_id);

  SELECT (SELECT count(*) FROM public.sections s WHERE s.offering_id = p_offering_id AND s.university_id = v_uni),
         (SELECT count(*) FROM public.enrollments e
            JOIN public.sections s ON s.id = e.section_id AND s.university_id = e.university_id
          WHERE s.offering_id = p_offering_id AND e.university_id = v_uni),
         (SELECT count(*) FROM public.assessments a WHERE a.offering_id = p_offering_id AND a.university_id = v_uni),
         (SELECT count(*) FROM public.marks m
            JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
          WHERE a.offering_id = p_offering_id AND m.university_id = v_uni),
         (SELECT count(*) FROM public.evaluation_periods ep WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni),
         (SELECT count(*) FROM public.slots sl
            JOIN public.evaluation_periods ep ON ep.id = sl.period_id AND ep.university_id = sl.university_id
          WHERE ep.offering_id = p_offering_id AND sl.university_id = v_uni),
         (SELECT count(*) FROM public.bookings b WHERE b.period_id IN (
            SELECT ep.id FROM public.evaluation_periods ep
            WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni))
    INTO v_sections, v_enrollments, v_assessments, v_marks, v_periods, v_slots, v_bookings;

  IF NOT p_force THEN
    IF EXISTS (
      SELECT 1 FROM public.marks m
      JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
      WHERE a.offering_id = p_offering_id AND m.university_id = v_uni
        AND m.score IS NOT NULL AND a.visibility = 'students'
    ) THEN
      RAISE EXCEPTION 'marks_protected';
    END IF;
  END IF;

  -- Sections first (each removal cascades its roster, announcements,
  -- assessments/marks, periods/slots/bookings and invites).
  FOR v_section IN
    SELECT id FROM public.sections
    WHERE offering_id = p_offering_id AND university_id = v_uni
  LOOP
    PERFORM private.delete_section_cascade(v_section.id, true);
  END LOOP;

  -- Offering-wide assessments (section_id IS NULL) carry their own marks.
  DELETE FROM public.mark_history mh
  USING public.marks m, public.assessments a
  WHERE a.offering_id = p_offering_id AND a.section_id IS NULL
    AND a.university_id = v_uni
    AND m.assessment_id = a.id AND m.university_id = v_uni
    AND mh.mark_id = m.id AND mh.university_id = v_uni;

  DELETE FROM public.marks m
  USING public.assessments a
  WHERE a.offering_id = p_offering_id AND a.section_id IS NULL
    AND a.university_id = v_uni
    AND m.assessment_id = a.id AND m.university_id = v_uni;

  DELETE FROM public.import_rows ir
  USING public.import_batches ib, public.assessments a
  WHERE a.offering_id = p_offering_id AND a.section_id IS NULL
    AND a.university_id = v_uni
    AND ib.assessment_id = a.id AND ib.university_id = v_uni
    AND ir.batch_id = ib.id AND ir.university_id = v_uni;

  DELETE FROM public.import_batches ib
  USING public.assessments a
  WHERE a.offering_id = p_offering_id AND a.section_id IS NULL
    AND a.university_id = v_uni
    AND ib.assessment_id = a.id AND ib.university_id = v_uni;

  DELETE FROM public.assessments
  WHERE offering_id = p_offering_id AND section_id IS NULL AND university_id = v_uni;

  -- Any periods of this offering are section-tied in practice; clear strays
  -- defensively so the FK always lets the offering row go.
  DELETE FROM public.swap_requests sr
  USING public.bookings b
  WHERE b.period_id IN (
      SELECT ep.id FROM public.evaluation_periods ep
      WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni)
    AND sr.university_id = v_uni
    AND (sr.from_booking_id = b.id OR sr.to_booking_id = b.id);

  DELETE FROM public.bookings
  WHERE period_id IN (
    SELECT ep.id FROM public.evaluation_periods ep
    WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni
  ) AND university_id = v_uni;

  DELETE FROM public.waitlist_entries w
  USING public.slots s
  WHERE s.period_id IN (
      SELECT ep.id FROM public.evaluation_periods ep
      WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni)
    AND w.slot_id = s.id AND w.university_id = v_uni;

  DELETE FROM public.slots
  WHERE period_id IN (
    SELECT ep.id FROM public.evaluation_periods ep
    WHERE ep.offering_id = p_offering_id AND ep.university_id = v_uni
  ) AND university_id = v_uni;

  DELETE FROM public.evaluation_periods
  WHERE offering_id = p_offering_id AND university_id = v_uni;

  DELETE FROM public.offering_staff
  WHERE offering_id = p_offering_id AND university_id = v_uni;

  UPDATE public.role_assignments
  SET offering_id = NULL, updated_at = now()
  WHERE offering_id = p_offering_id AND university_id = v_uni;

  DELETE FROM public.course_offerings
  WHERE id = p_offering_id AND university_id = v_uni;

  PERFORM private.write_delete_audit(v_uni, v_profile_id, 'academics.offering.deleted',
    'offering', p_offering_id,
    jsonb_build_object('offering_code', v_code, 'sections', v_sections, 'enrollments', v_enrollments,
                       'assessments', v_assessments, 'marks', v_marks, 'periods', v_periods,
                       'slots', v_slots, 'bookings', v_bookings, 'force', p_force));
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 3: delete-cascade preview (exact confirmation copy, registry delta)
-- ----------------------------------------------------------------------------

-- Authoritative child counts for the delete-confirmation dialogs ("Deleting
-- section A also removes N enrollments and M bookings"). One bounded JSONB per
-- kind; permission mirror of the matching delete RPC so a non-manager gets
-- 'forbidden' instead of data.
CREATE OR REPLACE FUNCTION private.delete_cascade_preview(p_kind text, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  CASE p_kind
    WHEN 'section' THEN
      SELECT s.university_id, s.offering_id INTO v_uni, v_offering_id
      FROM public.sections s WHERE s.id = p_target_id;
    WHEN 'offering' THEN
      SELECT co.university_id, co.id INTO v_uni, v_offering_id
      FROM public.course_offerings co WHERE co.id = p_target_id;
    WHEN 'assessment' THEN
      SELECT a.university_id, a.offering_id INTO v_uni, v_offering_id
      FROM public.assessments a WHERE a.id = p_target_id;
    WHEN 'period' THEN
      SELECT ep.university_id, ep.offering_id INTO v_uni, v_offering_id
      FROM public.evaluation_periods ep WHERE ep.id = p_target_id;
    WHEN 'slot' THEN
      SELECT s.university_id, ep.offering_id INTO v_uni, v_offering_id
      FROM public.slots s
      JOIN public.evaluation_periods ep ON ep.id = s.period_id AND ep.university_id = s.university_id
      WHERE s.id = p_target_id;
    ELSE
      RAISE EXCEPTION 'invalid_input';
  END CASE;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF p_kind IN ('section', 'assessment') THEN
    PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);
  ELSIF p_kind IN ('offering') THEN
    PERFORM private.assert_offering_delete_permission(v_uni, v_offering_id);
  ELSE  -- period / slot are booking items
    PERFORM private.assert_period_manage_permission(v_uni, v_offering_id);
  END IF;

  CASE p_kind
    WHEN 'section' THEN
      RETURN jsonb_build_object(
        'enrollments', (SELECT count(*) FROM public.enrollments e WHERE e.section_id = p_target_id AND e.university_id = v_uni),
        'assessments', (SELECT count(*) FROM public.assessments a WHERE a.section_id = p_target_id AND a.university_id = v_uni),
        'released_marks', (SELECT count(*) FROM public.marks m
            JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
          WHERE a.section_id = p_target_id AND a.university_id = v_uni AND m.score IS NOT NULL AND a.visibility = 'students'),
        'announcements', (SELECT count(*) FROM public.announcements an WHERE an.section_id = p_target_id AND an.university_id = v_uni),
        'invites', (SELECT count(*) FROM public.enrollment_invites i WHERE i.section_id = p_target_id AND i.university_id = v_uni),
        'periods', (SELECT count(*) FROM public.evaluation_periods ep WHERE ep.section_id = p_target_id AND ep.university_id = v_uni),
        'slots', (SELECT count(*) FROM public.slots sl
            JOIN public.evaluation_periods ep ON ep.id = sl.period_id AND ep.university_id = sl.university_id
          WHERE ep.section_id = p_target_id AND ep.university_id = v_uni),
        'bookings', (SELECT count(*) FROM public.bookings b
            JOIN public.evaluation_periods ep ON ep.id = b.period_id AND ep.university_id = b.university_id
          WHERE ep.section_id = p_target_id AND ep.university_id = v_uni));
    WHEN 'offering' THEN
      RETURN jsonb_build_object(
        'sections', (SELECT count(*) FROM public.sections s WHERE s.offering_id = p_target_id AND s.university_id = v_uni),
        'enrollments', (SELECT count(*) FROM public.enrollments e
            JOIN public.sections s ON s.id = e.section_id AND s.university_id = e.university_id
          WHERE s.offering_id = p_target_id AND e.university_id = v_uni),
        'assessments', (SELECT count(*) FROM public.assessments a WHERE a.offering_id = p_target_id AND a.university_id = v_uni),
        'released_marks', (SELECT count(*) FROM public.marks m
            JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
          WHERE a.offering_id = p_target_id AND m.university_id = v_uni AND m.score IS NOT NULL AND a.visibility = 'students'),
        'periods', (SELECT count(*) FROM public.evaluation_periods ep WHERE ep.offering_id = p_target_id AND ep.university_id = v_uni),
        'slots', (SELECT count(*) FROM public.slots sl
            JOIN public.evaluation_periods ep ON ep.id = sl.period_id AND ep.university_id = sl.university_id
          WHERE ep.offering_id = p_target_id AND sl.university_id = v_uni),
        'bookings', (SELECT count(*) FROM public.bookings b WHERE b.period_id IN (
            SELECT ep.id FROM public.evaluation_periods ep
            WHERE ep.offering_id = p_target_id AND ep.university_id = v_uni)));
    WHEN 'assessment' THEN
      RETURN jsonb_build_object(
        'marks', (SELECT count(*) FROM public.marks m WHERE m.assessment_id = p_target_id AND m.university_id = v_uni),
        'released_marks', (SELECT count(*) FROM public.marks m
            JOIN public.assessments a ON a.id = m.assessment_id AND a.university_id = m.university_id
          WHERE m.assessment_id = p_target_id AND m.university_id = v_uni AND m.score IS NOT NULL AND a.visibility = 'students'),
        'import_batches', (SELECT count(*) FROM public.import_batches ib WHERE ib.assessment_id = p_target_id AND ib.university_id = v_uni));
    WHEN 'period' THEN
      RETURN jsonb_build_object(
        'slots', (SELECT count(*) FROM public.slots s WHERE s.period_id = p_target_id AND s.university_id = v_uni),
        'bookings', (SELECT count(*) FROM public.bookings b WHERE b.period_id = p_target_id AND b.university_id = v_uni));
    WHEN 'slot' THEN
      RETURN jsonb_build_object(
        'bookings', (SELECT count(*) FROM public.bookings b WHERE b.slot_id = p_target_id AND b.university_id = v_uni));
    ELSE
      RAISE EXCEPTION 'invalid_input';
  END CASE;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 4: capacity edit (registry delta 2026-11-08)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.update_slot_capacity(p_slot_id uuid, p_capacity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_offering_id uuid;
  v_active int;
BEGIN
  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT s.university_id, ep.offering_id INTO v_uni, v_offering_id
  FROM public.slots s
  JOIN public.evaluation_periods ep ON ep.id = s.period_id AND ep.university_id = s.university_id
  WHERE s.id = p_slot_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM private.assert_period_manage_permission(v_uni, v_offering_id);

  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT count(*)::int INTO v_active
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id AND b.university_id = v_uni AND b.status = 'active';

  IF p_capacity < v_active THEN
    RAISE EXCEPTION 'capacity_below_bookings';
  END IF;

  UPDATE public.slots SET capacity = p_capacity, updated_at = now()
  WHERE id = p_slot_id AND university_id = v_uni;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 5: bulk slot generation (registry delta 2026-11-08)
-- ----------------------------------------------------------------------------

-- One atomic RPC: interprets date+time inputs in Asia/Karachi (fixed UTC+05,
-- DST-free), validates the whole schedule, rejects overlaps with existing
-- slots of the same period and creates every slot in a single INSERT that
-- commits or fails together. The period-row lock matches book_slot's locking
-- order, so two concurrent staff generators (or a generator + student) cannot
-- race past the overlap/capacity checks.
CREATE OR REPLACE FUNCTION private.create_slots_bulk(
  p_university_id uuid,
  p_period_id uuid,
  p_from_date date,
  p_to_date date,
  p_daily_start time,
  p_daily_end time,
  p_slot_minutes integer,
  p_gap_minutes integer,
  p_capacity integer,
  p_location text,
  p_slots_per_day integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_offering_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_days int;
  v_per_day int;
  v_total int;
  v_overlaps int;
  v_out_of_window int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id
      AND m.profile_id = v_profile_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Serialize with book_slot and switch_booking on the same row.
  SELECT ep.offering_id, ep.starts_at, ep.ends_at
    INTO v_offering_id, v_period_start, v_period_end
  FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(p_university_id, 'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Shape validation.
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date
     OR p_daily_start IS NULL OR p_slot_minutes IS NULL
     OR p_slot_minutes < 1 OR p_slot_minutes > 480
     OR p_gap_minutes IS NULL OR p_gap_minutes < 0 OR p_gap_minutes > 240
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 500
     OR (p_slots_per_day IS NULL AND p_daily_end IS NULL)
     OR (p_slots_per_day IS NOT NULL AND (p_slots_per_day < 1 OR p_slots_per_day > 200)) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  -- end-time mode must end after start; the two modes are mutually exclusive.
  IF p_daily_end IS NOT NULL THEN
    IF p_daily_end <= p_daily_start THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF p_slots_per_day IS NOT NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  END IF;

  -- Exact per-day count from the window (last slot must finish inside it).
  IF p_slots_per_day IS NOT NULL THEN
    v_per_day := p_slots_per_day;
  ELSE
    v_per_day := floor(
      (extract(epoch FROM (p_daily_end - p_daily_start)) - p_slot_minutes::int * 60)
      / (p_slot_minutes::int * 60 + p_gap_minutes::int * 60)
    )::int + 1;
    IF v_per_day < 1 THEN
      RAISE EXCEPTION 'invalid_input';
    END IF;
  END IF;

  SELECT count(DISTINCT d)::int INTO v_days
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d;
  v_total := v_days * v_per_day;
  IF v_total < 1 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_total > 500 THEN RAISE EXCEPTION 'too_many_slots'; END IF;

  -- Overlap rejection against the slots the period already has (strict
  -- endpoints: touching boundaries are allowed, they are never concurrent).
  SELECT count(*)::int INTO v_overlaps
  FROM public.slots s
  WHERE s.university_id = p_university_id AND s.period_id = p_period_id
    AND EXISTS (
      SELECT 1
      FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
           generate_series(0, v_per_day - 1) AS i
      WHERE s.starts_at < (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi' + make_interval(secs => p_slot_minutes::int * 60)
        AND ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi') < s.ends_at
    );
  IF v_overlaps > 0 THEN
    RAISE EXCEPTION 'slot_overlap';
  END IF;

  -- Every generated slot body must sit inside the period window.
  SELECT count(*)::int INTO v_out_of_window
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
       generate_series(0, v_per_day - 1) AS i
  WHERE ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi') < v_period_start
     OR ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60) + p_slot_minutes::int * 60)) AT TIME ZONE 'Asia/Karachi') > v_period_end;
  IF v_out_of_window > 0 THEN
    RAISE EXCEPTION 'outside_period';
  END IF;

  -- Single INSERT: every slot commits together or not at all.
  INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
  SELECT p_university_id, p_period_id,
         (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi',
         (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60) + p_slot_minutes::int * 60)) AT TIME ZONE 'Asia/Karachi',
         p_capacity,
         NULLIF(trim(p_location), ''),
         v_profile_id
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
       generate_series(0, v_per_day - 1) AS i;

  RETURN v_total;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 6: switch booking (registry delta 2026-11-08)
-- ----------------------------------------------------------------------------

-- Atomic move of the caller's active booking in the period to a free target
-- slot. Lock order is period row THEN booking row everywhere (book_slot,
-- switch_booking), so switchers cannot deadlock with each other.
CREATE OR REPLACE FUNCTION private.switch_booking(p_period_id uuid, p_target_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_target public.slots%ROWTYPE;
  v_current public.slots%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = v_period.university_id
      AND m.profile_id = v_profile_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Period row lock first (matches book_slot's lock order), then our booking.
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.university_id = v_period.university_id
    AND b.period_id = p_period_id
    AND b.student_id = v_profile_id
    AND b.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_booking'; END IF;

  IF NOT private.is_enrolled(v_period.section_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT s.* INTO v_current
  FROM public.slots s
  WHERE s.university_id = v_period.university_id AND s.id = v_booking.slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_current.ends_at <= now() THEN RAISE EXCEPTION 'slot_ended'; END IF;

  -- D11: switching closes cutoff_hours before the CURRENT slot starts
  -- (TA-configurable per period; default 6h).
  IF now() >= v_current.starts_at - make_interval(hours => v_period.cutoff_hours) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  SELECT s.* INTO v_target
  FROM public.slots s
  WHERE s.university_id = v_period.university_id
    AND s.id = p_target_slot_id
    AND s.period_id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF v_target.id = v_current.id THEN
    RETURN v_booking.id;  -- switching to the slot you already hold: no-op
  END IF;
  IF v_target.ends_at <= now() THEN RAISE EXCEPTION 'slot_ended'; END IF;

  -- The period row lock + our own locked booking keep this count stable:
  -- every other switcher/booker must pass the same period lock first.
  IF (
    SELECT count(*) FROM public.bookings b
    WHERE b.university_id = v_period.university_id
      AND b.slot_id = v_target.id
      AND b.status = 'active'
  ) >= v_target.capacity THEN
    RAISE EXCEPTION 'slot_full';  -- rollback: the old booking stays active
  END IF;

  UPDATE public.bookings SET status = 'cancelled', updated_at = now()
  WHERE id = v_booking.id AND status = 'active';

  BEGIN
    INSERT INTO public.bookings (university_id, period_id, slot_id, student_id, created_by)
    VALUES (v_period.university_id, p_period_id, v_target.id, v_profile_id, v_profile_id)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  RETURN v_new_id;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 7: period_booking_overview — staff rows gain email + booked_at,
-- ordered by slot start then natural email (replace-in-place)
-- ----------------------------------------------------------------------------

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
      SELECT jsonb_agg(
        row_json
        ORDER BY row_json->>'slot_starts_at' ASC,
                 private.natural_sort_key(row_json->>'student_email') ASC
      )
      FROM (
        SELECT jsonb_build_object(
          'slot_id', b.slot_id,
          'slot_starts_at', sl.starts_at,
          'student_name', pr.display_name,
          'student_email', pr.email,
          'booked_at', b.created_at,
          'status', b.status
        ) AS row_json
        FROM public.bookings b
        JOIN public.slots sl
          ON sl.university_id = b.university_id AND sl.id = b.slot_id
        JOIN public.profiles pr
          ON pr.id = b.student_id
        WHERE b.university_id = v_period.university_id
          AND b.period_id = v_period.id
      ) booking_rows
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 8: public wrappers + grants (D-k)
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS private.delete_assessment(uuid);
DROP FUNCTION IF EXISTS private.delete_section_cascade(uuid);
DROP FUNCTION IF EXISTS public.delete_assessment(uuid);
DROP FUNCTION IF EXISTS public.delete_section_cascade(uuid);

CREATE OR REPLACE FUNCTION public.create_slots_bulk(
  p_university_id uuid,
  p_period_id uuid,
  p_from_date date,
  p_to_date date,
  p_daily_start time,
  p_daily_end time,
  p_slot_minutes integer,
  p_gap_minutes integer,
  p_capacity integer,
  p_location text,
  p_slots_per_day integer DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT private.create_slots_bulk(p_university_id, p_period_id, p_from_date, p_to_date,
    p_daily_start, p_daily_end, p_slot_minutes, p_gap_minutes, p_capacity, p_location, p_slots_per_day)
$$;

CREATE OR REPLACE FUNCTION public.switch_booking(p_period_id uuid, p_target_slot_id uuid)
RETURNS uuid
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT private.switch_booking(p_period_id, p_target_slot_id)
$$;

CREATE OR REPLACE FUNCTION public.update_slot_capacity(p_slot_id uuid, p_capacity integer)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$ SELECT private.update_slot_capacity(p_slot_id, p_capacity) $$;

CREATE OR REPLACE FUNCTION public.delete_cascade_preview(p_kind text, p_target_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $$ SELECT private.delete_cascade_preview(p_kind, p_target_id) $$;

CREATE OR REPLACE FUNCTION public.delete_course_offering(p_offering_id uuid, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$ SELECT private.delete_course_offering(p_offering_id, p_force) $$;

CREATE OR REPLACE FUNCTION public.delete_announcement(p_announcement_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_announcement(p_announcement_id) $$;

CREATE OR REPLACE FUNCTION public.delete_enrollment(p_enrollment_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_enrollment(p_enrollment_id) $$;

CREATE OR REPLACE FUNCTION public.delete_assessment(p_assessment_id uuid, p_force boolean DEFAULT false)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_assessment(p_assessment_id, p_force) $$;

CREATE OR REPLACE FUNCTION public.delete_slot(p_slot_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_slot(p_slot_id) $$;

CREATE OR REPLACE FUNCTION public.delete_evaluation_period(p_period_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_evaluation_period(p_period_id) $$;

CREATE OR REPLACE FUNCTION public.delete_section_cascade(p_section_id uuid, p_force boolean DEFAULT false)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_section_cascade(p_section_id, p_force) $$;

GRANT EXECUTE ON FUNCTION private.switch_booking(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_slots_bulk(uuid, uuid, date, date, time, time, integer, integer, integer, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_slot_capacity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_cascade_preview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_course_offering(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_assessment(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_evaluation_period(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_section_cascade(uuid, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.switch_booking(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_slots_bulk(uuid, uuid, date, date, time, time, integer, integer, integer, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_slot_capacity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cascade_preview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_course_offering(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_assessment(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_evaluation_period(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_section_cascade(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.switch_booking(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.create_slots_bulk(uuid, uuid, date, date, time, time, integer, integer, integer, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.update_slot_capacity(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_cascade_preview(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_course_offering(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_announcement(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_enrollment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_assessment(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_slot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_evaluation_period(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_section_cascade(uuid, boolean) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.switch_booking(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_slots_bulk(uuid, uuid, date, date, time, time, integer, integer, integer, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_slot_capacity(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cascade_preview(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_course_offering(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_announcement(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_enrollment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_assessment(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_slot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_evaluation_period(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_section_cascade(uuid, boolean) FROM PUBLIC, anon;

-- ============================================================================