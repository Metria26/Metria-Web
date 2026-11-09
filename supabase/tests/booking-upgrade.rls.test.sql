-- pgTAP tests for the academics + booking upgrade (registry delta 2026-11-08)
-- Covers the new invariants the e2e journey cannot race-check sequentially:
--   * create_slots_bulk: staff-allowed, student/unstaffed-tenant-denied, shape
--     validation, the 500-slot cap, overlap rejection is atomic (no partial
--     insert) and slots must sit inside the period window.
--   * switch_booking: success, full target leaves the old booking untouched,
--     cutoff (D11), no active booking, not-enrolled, same-slot no-op.
--   * update_slot_capacity: refuses cutting below active bookings.
--   * delete RPCs: permission gates (student, unstaffed TA, cross-tenant),
--     the marks_protected released-marks guard with/without p_force, cascade
--     deletes (offering/section), and one audit_log row per delete.
--   * natural_sort_key ordering parity + staff overview ordering.
-- Fixture pattern mirrors evaluation-booking.rls.test.sql: seeded offering
-- CS301-F26 (sections A/B), ta.dev staffed, student.dev enrolled in A.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(79);

-- ---------------------------------------------------------------------------
-- Structural checks
-- ---------------------------------------------------------------------------

SELECT ok(to_regprocedure('private.natural_sort_key(text)') IS NOT NULL,'natural_sort_key installed');
SELECT ok(to_regprocedure('private.create_slots_bulk(uuid,uuid,date,date,time,time,integer,integer,integer,text,integer)') IS NOT NULL,'bulk RPC installed');
SELECT ok(to_regprocedure('private.switch_booking(uuid,uuid)') IS NOT NULL,'switch RPC installed');
SELECT ok(to_regprocedure('private.update_slot_capacity(uuid,integer)') IS NOT NULL,'capacity RPC installed');
SELECT ok(to_regprocedure('private.delete_course_offering(uuid,boolean)') IS NOT NULL,'offering delete RPC installed');
SELECT ok(to_regprocedure('private.delete_cascade_preview(text,uuid)') IS NOT NULL,'preview RPC installed');
SELECT ok(NOT has_function_privilege('anon','public.create_slots_bulk(uuid,uuid,date,date,time,time,integer,integer,integer,text,integer)','EXECUTE'),'anonymous cannot execute create_slots_bulk');
SELECT ok(NOT has_function_privilege('anon','public.switch_booking(uuid,uuid)','EXECUTE'),'anonymous cannot execute switch_booking');
SELECT has_function_privilege('authenticated','public.switch_booking(uuid,uuid)','EXECUTE'),'authenticated can execute switch_booking';

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('88888888-8888-4999-8999-888888888998', 'other-uni-upgrade', 'Other Upgrade University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
VALUES ('88888888-8888-4999-8999-888888888998', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'Cross Upgrade Student', 'cross.upgrade@other.edu');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT u.id, v.auth_user_id::uuid, v.display_name, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'Upgrade Student One', 'up.s1@lhr.nu.edu.pk'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'Upgrade Student Two', 'up.s2@lhr.nu.edu.pk'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 'Upgrade Student Three', 'up.s3@lhr.nu.edu.pk'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0009', 'Upgrade Unstaffed TA', 'up.ta@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email)
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE (u.slug = 'fast-nuces-lahore' AND p.email IN ('up.s1@lhr.nu.edu.pk','up.s2@lhr.nu.edu.pk','up.s3@lhr.nu.edu.pk','up.ta@lhr.nu.edu.pk'))
   OR (u.slug = 'other-uni-upgrade' AND p.email = 'cross.upgrade@other.edu');

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.roles r ON r.university_id = u.id
JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore'
  AND (r.name = 'student' AND p.email IN ('up.s1@lhr.nu.edu.pk','up.s2@lhr.nu.edu.pk','up.s3@lhr.nu.edu.pk')
    OR r.name = 'ta' AND p.email = 'up.ta@lhr.nu.edu.pk');

-- Students enroll in section A of the seeded offering.
INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT u.id, s.id, p.id, 'active', p.id
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
JOIN public.sections s ON s.university_id = u.id AND s.offering_id = o.id AND s.section_code = 'A'
JOIN public.profiles p ON p.university_id = u.id
 AND p.email IN ('up.s1@lhr.nu.edu.pk','up.s2@lhr.nu.edu.pk','up.s3@lhr.nu.edu.pk')
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug='fast-nuces-lahore'), false);
SELECT set_config('test.other_id', (SELECT id::text FROM public.universities WHERE slug='other-uni-upgrade'), false);
SELECT set_config('test.offering_id', (SELECT o.id::text FROM public.course_offerings o WHERE o.university_id = current_setting('test.fast_id')::uuid AND o.offering_code = 'CS301-F26'), false);
SELECT set_config('test.section_a', (SELECT s.id::text FROM public.sections s WHERE s.university_id = current_setting('test.fast_id')::uuid AND s.offering_id = current_setting('test.offering_id')::uuid AND s.section_code = 'A'), false);
SELECT set_config('test.ta_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'), false);
SELECT set_config('test.ta_dev_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', false);
SELECT set_config('test.student_dev_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', false);
SELECT set_config('test.s1_sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', false);
SELECT set_config('test.s2_sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', false);
SELECT set_config('test.s3_sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', false);
SELECT set_config('test.rls_ta_sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0009', false);
SELECT set_config('test.cross_sub', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', false);

-- ---------------------------------------------------------------------------

-- natural_sort_key: numeric-aware, case-insensitive ordering parity
SELECT is(private.natural_sort_key('l250616@lhr.nu.edu.pk'),  private.natural_sort_key('L250616@LHR.NU.EDU.PK'),'natural_sort_key is case-insensitive');
SELECT is(private.natural_sort_key('l250616') < private.natural_sort_key('l257689'), true,'l250616 orders before l257689');
SELECT is(private.natural_sort_key('2foo') < private.natural_sort_key('10foo'), true,'natural_sort_key is numeric-aware (2foo < 10foo)');

-- Platform admin and staffed TA enter the stage
-- Deterministic PKT calendar anchors (fixed UTC+05, no DST).
SELECT set_config('test.bulk_d1', ((current_date + 21)::text), false);
SELECT set_config('test.bulk_d2', ((current_date + 22)::text), false);
SELECT set_config('test.bulk_d5', ((current_date + 25)::text), false);
SELECT set_config('test.sw_d1', ((current_date + 10)::text), false);
SELECT set_config('test.sw_d2', ((current_date + 11)::text), false);
SELECT set_config('test.sw_cut', ((current_date + 1)::text), false);
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT lives_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, cutoff_hours, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_a')::uuid,
              'Upgrade bulk period',
              (current_setting('test.bulk_d1') || ' 05:00')::timestamp AT TIME ZONE 'Asia/Karachi',
              (current_setting('test.bulk_d2') || ' 23:00')::timestamp AT TIME ZONE 'Asia/Karachi',
              6, current_setting('test.ta_profile')::uuid)$sql$,
  'staffed ta creates the bulk period'
);

RESET ROLE;

-- A period owned by the other tenant for cross-tenant attempts.
INSERT INTO public.terms (university_id, name, starts_on, ends_on)
SELECT id, 'U term', current_date - 30, current_date + 90 FROM public.universities WHERE slug = 'other-uni-upgrade';

INSERT INTO public.courses (university_id, code, title)
SELECT id, 'UP-100', 'Cross course' FROM public.universities WHERE slug = 'other-uni-upgrade';

INSERT INTO public.course_offerings (university_id, course_id, term_id, offering_code)
SELECT u.id, c.id, t.id, 'UP100-UP'
FROM public.universities u
JOIN public.courses c ON c.university_id = u.id AND c.code = 'UP-100'
JOIN public.terms t ON t.university_id = u.id
WHERE u.slug = 'other-uni-upgrade';

INSERT INTO public.sections (university_id, offering_id, section_code)
SELECT u.id, o.id, 'X'
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'UP100-UP'
WHERE u.slug = 'other-uni-upgrade';

INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, cutoff_hours)
SELECT u.id, o.id, s.id, 'Cross tenant period',
       (current_setting('test.sw_d1') || ' 09:00')::timestamp AT TIME ZONE 'Asia/Karachi',
       (current_setting('test.sw_d2') || ' 20:00')::timestamp AT TIME ZONE 'Asia/Karachi',
       6
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'UP100-UP'
JOIN public.sections s ON s.university_id = u.id AND s.offering_id = o.id
WHERE u.slug = 'other-uni-upgrade';

SELECT set_config('test.p_bulk', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Upgrade bulk period'), false);
SELECT set_config('test.p_switch', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Upgrade switch period'), false);
SELECT set_config('test.p_cutoff', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Upgrade switch cutoff'), false);
SELECT set_config('test.p_cross', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.other_id')::uuid AND title = 'Cross tenant period'), false);
SELECT is(current_setting('test.p_cross') IS DISTINCT FROM '', true, 'cross-tenant period staged');

-- ---------------------------------------------------------------------------
-- Bulk generation
-- ---------------------------------------------------------------------------

SET ROLE authenticated;

SELECT is(
  public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
                           current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
                           time '10:00', time '12:00', 30, 0, 2, 'Bulk lab', NULL),
  8, 'bulk generation creates 4 slots x 2 days');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.slots WHERE period_id = current_setting('test.p_bulk')::uuid), 8, 'all 8 slots are stored');
SELECT is((SELECT count(*)::int FROM public.slots WHERE period_id = current_setting('test.p_bulk')::uuid AND capacity = 2 AND location = 'Bulk lab'), 8, 'all slots carry capacity and location');

SET ROLE authenticated;
-- Re-running a plan that overlaps stored slots is rejected as a whole.
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '10:30', time '12:00', 30, 0, 2, NULL, NULL)$sql$,
  'P0001', 'slot_overlap',
  'overlapping plan is rejected');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.slots WHERE period_id = current_setting('test.p_bulk')::uuid), 8, 'rejected plan inserted nothing (atomicity)');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '13:00', time '14:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'forbidden',
  'student cannot bulk-generate slots');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.rls_ta_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '13:00', time '14:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'forbidden',
  'unstaffed TA cannot bulk-generate slots');

SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.other_id')::uuid, current_setting('test.p_cross')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '09:00', time '10:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'forbidden',
  'unstaffed TA cannot target the other tenant');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.cross_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '13:00', time '14:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'forbidden',
  'cross-tenant caller without membership is refused');

-- Shape/cap/window rejections from the staffed TA.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d2')::date, current_setting('test.bulk_d1')::date,
    time '10:00', time '12:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'invalid_input',
  'inverted date range is invalid_input');

SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '10:00', time '09:00', 15, 0, 2, NULL, NULL)$sql$,
  'P0001', 'invalid_input',
  'daily end before start is invalid_input');

SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d2')::date,
    time '10:00', time '12:00', 15, 0, 2, NULL, 2)$sql$,
  'P0001', 'invalid_input',
  'giving both the end time and a slot count is invalid_input');

SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d1')::date, current_setting('test.bulk_d5')::date,
    time '10:00', NULL, 15, 0, 2, NULL, 110)$sql$,
  'P0001', 'too_many_slots',
  '550-slot plan is rejected (cap 500)');

-- The last slot must finish before the period ends.
SELECT throws_ok(
  $sql$SELECT public.create_slots_bulk(current_setting('test.fast_id')::uuid, current_setting('test.p_bulk')::uuid,
    current_setting('test.bulk_d2')::date, current_setting('test.bulk_d2')::date,
    time '22:00', time '23:30', 30, 0, 2, NULL, NULL)$sql$,
  'P0001', 'outside_period',
  'slots beyond the period end are rejected');

-- ---------------------------------------------------------------------------
-- switch_booking
-- ---------------------------------------------------------------------------

RESET ROLE;
INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, cutoff_hours, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_a')::uuid,
        'Upgrade switch period',
        (current_setting('test.sw_d1') || ' 09:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_d2') || ' 20:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        6, current_setting('test.ta_profile')::uuid);

INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, cutoff_hours, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_a')::uuid,
        'Upgrade switch cutoff',
        (current_setting('test.sw_cut') || ' 09:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_cut') || ' 15:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        168, current_setting('test.ta_profile')::uuid);

-- These periods are inserted here (after the first capture) — capture their ids now.
SELECT set_config('test.p_switch', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Upgrade switch period'), false);
SELECT set_config('test.p_cutoff', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Upgrade switch cutoff'), false);

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid,
        (current_setting('test.sw_d2') || ' 10:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_d2') || ' 10:30')::timestamp AT TIME ZONE 'Asia/Karachi', 1, 'Switch A', current_setting('test.ta_profile')::uuid);

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid,
        (current_setting('test.sw_d2') || ' 11:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_d2') || ' 11:30')::timestamp AT TIME ZONE 'Asia/Karachi', 1, 'Switch B', current_setting('test.ta_profile')::uuid);

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid,
        (current_setting('test.sw_d2') || ' 12:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_d2') || ' 12:30')::timestamp AT TIME ZONE 'Asia/Karachi', 1, 'Switch C', current_setting('test.ta_profile')::uuid);

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_cutoff')::uuid,
        (current_setting('test.sw_cut') || ' 10:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_cut') || ' 10:30')::timestamp AT TIME ZONE 'Asia/Karachi', 5, 'Cut K', current_setting('test.ta_profile')::uuid);

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_cutoff')::uuid,
        (current_setting('test.sw_cut') || ' 11:00')::timestamp AT TIME ZONE 'Asia/Karachi',
        (current_setting('test.sw_cut') || ' 11:30')::timestamp AT TIME ZONE 'Asia/Karachi', 5, 'Cut L', current_setting('test.ta_profile')::uuid);

SELECT set_config('test.sA', (SELECT id::text FROM public.slots WHERE period_id = current_setting('test.p_switch')::uuid AND location = 'Switch A'), false);
SELECT set_config('test.sB', (SELECT id::text FROM public.slots WHERE period_id = current_setting('test.p_switch')::uuid AND location = 'Switch B'), false);
SELECT set_config('test.sC', (SELECT id::text FROM public.slots WHERE period_id = current_setting('test.p_switch')::uuid AND location = 'Switch C'), false);
SELECT set_config('test.sK', (SELECT id::text FROM public.slots WHERE period_id = current_setting('test.p_cutoff')::uuid AND location = 'Cut K'), false);
SELECT set_config('test.sL', (SELECT id::text FROM public.slots WHERE period_id = current_setting('test.p_cutoff')::uuid AND location = 'Cut L'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid, current_setting('test.sA')::uuid)$sql$,
  's1 books slot A');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s2_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid, current_setting('test.sC')::uuid)$sql$,
  's2 books slot C (capacity 1)');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s3_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p_cutoff')::uuid, current_setting('test.sK')::uuid)$sql$,
  's3 books the cutoff-period slot K');

-- s1 switches A to B atomically.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_switch')::uuid, current_setting('test.sB')::uuid)$sql$,
  's1 switches from A to B');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.bookings WHERE slot_id = current_setting('test.sA')::uuid AND status = 'active'), 0, 'slot A released its booking');
SELECT is((SELECT count(*)::int FROM public.bookings WHERE slot_id = current_setting('test.sB')::uuid AND status = 'active'), 1, 'slot B holds exactly one new active booking');
SELECT is((SELECT count(*)::int FROM public.bookings b JOIN public.profiles p ON p.id = b.student_id
           WHERE b.period_id = current_setting('test.p_switch')::uuid AND b.status = 'active' AND p.email = 'up.s1@lhr.nu.edu.pk'), 1, 's1 still ends with exactly one active booking');

SET ROLE authenticated;
-- Switching to the slot you already hold is a plain success.
SELECT lives_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_switch')::uuid, current_setting('test.sB')::uuid)$sql$,
  'switching to the slot you already hold is a no-op');

-- Full target: s1 (holding B) aims at C which s2 holds (capacity 1).
SELECT throws_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_switch')::uuid, current_setting('test.sC')::uuid)$sql$,
  'P0001', 'slot_full',
  'switching into a full slot raises slot_full');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.bookings WHERE slot_id = current_setting('test.sB')::uuid AND status = 'active'), 1, 'full target leaves the old booking untouched');

-- Overview ordering: first student row is ordered by slot time then email.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT is(
  (SELECT (SELECT jsonb_array_elements(overview->'students')->>'student_email' LIMIT 1)
   FROM public.period_booking_overview(current_setting('test.p_switch')::uuid) AS overview),
  'up.s1@lhr.nu.edu.pk',
  'overview students ordered by slot time then natural email');

-- No active booking: s3 (booked only in the cutoff period) switches in p_switch.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s3_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_switch')::uuid, current_setting('test.sA')::uuid)$sql$,
  'P0001', 'no_active_booking',
  'switch without an active booking raises no_active_booking');

-- Cutoff (D11 measured against the CURRENT slot): s3 in the 168h period.
SELECT throws_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_cutoff')::uuid, current_setting('test.sL')::uuid)$sql$,
  'P0001', 'cutoff_passed',
  'switch inside the cutoff raises cutoff_passed');

RESET ROLE;
-- Not enrolled: TA holds a bookign by hand, is refused (never enrolled in A).
INSERT INTO public.bookings (university_id, period_id, slot_id, student_id, status, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_cutoff')::uuid, current_setting('test.sL')::uuid,
        current_setting('test.ta_profile')::uuid, 'active', current_setting('test.ta_profile')::uuid);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.switch_booking(current_setting('test.p_cutoff')::uuid, current_setting('test.sK')::uuid)$sql$,
  'P0001', 'forbidden',
  'not-enrolled holder cannot switch');

-- update_slot_capacity: staff can raise, cannot cut below active bookings.
SELECT throws_ok(
  $sql$SELECT public.update_slot_capacity(current_setting('test.sC')::uuid, 0)$sql$,
  'P0001', 'invalid_input',
  'capacity 0 is invalid_input');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.update_slot_capacity(current_setting('test.sC')::uuid, 2)$sql$,
  'staff raises the capacity');

RESET ROLE;
SELECT set_config('test.s3_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'up.s3@lhr.nu.edu.pk'), false);
INSERT INTO public.bookings (university_id, period_id, slot_id, student_id, status, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.p_switch')::uuid, current_setting('test.sC')::uuid,
        current_setting('test.s3_profile')::uuid, 'active', current_setting('test.s3_profile')::uuid);

SET ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.update_slot_capacity(current_setting('test.sC')::uuid, 1)$sql$,
  'P0001', 'capacity_below_bookings',
  'cutting capacity below active bookings is refused');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.update_slot_capacity(current_setting('test.sA')::uuid, 5)$sql$,
  'P0001', 'forbidden',
  'student cannot edit capacity');

-- Staff previews exact cascade counts while section A has 4 members (3 seeded
-- upgrade students plus student.dev from the base fixture).
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT is(
  (SELECT (preview->>'enrollments')::int FROM public.delete_cascade_preview('section', current_setting('test.section_a')::uuid) AS preview),
  4,
  'section preview counts the enrollments');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_cascade_preview('section', current_setting('test.section_a')::uuid)$sql$,
  'P0001', 'forbidden',
  'student cannot preview cascade counts');

-- ---------------------------------------------------------------------------
-- Delete RPCs: permission gates, marks guard, cascade and audit rows
-- ---------------------------------------------------------------------------

RESET ROLE;
-- Assessment with RELEASED marks (visibility students + scored mark).
INSERT INTO public.assessments (university_id, offering_id, section_id, title, assessment_type, total, weight, visibility, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_a')::uuid,
        'Upgrade quiz', 'quiz', 10, 10, 'students', current_setting('test.ta_profile')::uuid);

INSERT INTO public.marks (university_id, assessment_id, student_id, score, status, created_by)
SELECT current_setting('test.fast_id')::uuid, a.id, p.id, 9, 'graded', current_setting('test.ta_profile')::uuid
FROM public.assessments a, public.profiles p
WHERE a.title = 'Upgrade quiz' AND p.email = 'up.s2@lhr.nu.edu.pk';

SELECT set_config('test.a_quiz', (SELECT id::text FROM public.assessments WHERE title = 'Upgrade quiz'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_assessment(current_setting('test.a_quiz')::uuid)$sql$,
  'P0001', 'marks_protected',
  'released marks block the assessment delete');

SELECT lives_ok(
  $sql$SELECT public.delete_assessment(current_setting('test.a_quiz')::uuid, true)$sql$,
  'force confirms the released-marks delete');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.assessments WHERE id = current_setting('test.a_quiz')::uuid), 0, 'assessment removed after forced delete');
SELECT is((SELECT count(*)::int FROM public.marks WHERE assessment_id = current_setting('test.a_quiz')::uuid), 0, 'its marks are gone');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'academics.assessment.deleted' AND target_id = current_setting('test.a_quiz')::uuid), 1, 'one audit row for the forced delete');

SET ROLE authenticated;
INSERT INTO public.assessments (university_id, offering_id, section_id, title, assessment_type, total, weight, visibility, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_a')::uuid,
        'Upgrade quiz 2', 'quiz', 10, 10, 'private', current_setting('test.ta_profile')::uuid);

RESET ROLE;
SELECT set_config('test.a_quiz2', (SELECT id::text FROM public.assessments WHERE title = 'Upgrade quiz 2'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_assessment(current_setting('test.a_quiz2')::uuid)$sql$,
  'P0001', 'forbidden',
  'student cannot delete an assessment');

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.rls_ta_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_assessment(current_setting('test.a_quiz2')::uuid)$sql$,
  'P0001', 'forbidden',
  'unstaffed TA cannot delete an assessment');

-- Enrollment delete + audit row.
RESET ROLE;
SELECT set_config('test.e_s3', (SELECT e.id::text FROM public.enrollments e JOIN public.profiles p ON p.id = e.profile_id WHERE p.email = 'up.s3@lhr.nu.edu.pk'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.delete_enrollment(current_setting('test.e_s3')::uuid)$sql$,
  'staff removes s3 from the section');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.enrollments WHERE id = current_setting('test.e_s3')::uuid), 0, 'enrollment removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'academics.enrollment.deleted' AND target_id = current_setting('test.e_s3')::uuid), 1, 'one audit row for the enrollment delete');

-- Announcement delete + audit row.
INSERT INTO public.announcements (university_id, section_id, author_id, title, body_html, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.section_a')::uuid, current_setting('test.ta_profile')::uuid,
        'Upgrade note', '<p>hello</p>', current_setting('test.ta_profile')::uuid);

SELECT set_config('test.an_up', (SELECT id::text FROM public.announcements WHERE title = 'Upgrade note'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.delete_announcement(current_setting('test.an_up')::uuid)$sql$,
  'staff deletes the announcement');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.announcements WHERE id = current_setting('test.an_up')::uuid), 0, 'announcement removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'academics.announcement.deleted' AND target_id = current_setting('test.an_up')::uuid), 1, 'one audit row for the announcement delete');

-- Section delete: cascade + audit; a fresh section Z carries children.
INSERT INTO public.sections (university_id, offering_id, section_code, capacity, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, 'Z', 5, current_setting('test.ta_profile')::uuid);

SELECT set_config('test.sZ', (SELECT id::text FROM public.sections WHERE section_code = 'Z'), false);

INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT current_setting('test.fast_id')::uuid, current_setting('test.sZ')::uuid, p.id, 'active', p.id
FROM public.profiles p WHERE p.email = 'up.s3@lhr.nu.edu.pk';

INSERT INTO public.announcements (university_id, section_id, author_id, title, body_html, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.sZ')::uuid, current_setting('test.ta_profile')::uuid,
        'Z note', '<p>z</p>', current_setting('test.ta_profile')::uuid);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.delete_section_cascade(current_setting('test.sZ')::uuid)$sql$,
  'staff deletes section Z with its cascade');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.sections WHERE id = current_setting('test.sZ')::uuid), 0, 'section Z removed');
SELECT is((SELECT count(*)::int FROM public.enrollments WHERE section_id = current_setting('test.sZ')::uuid), 0, 'section Z roster removed');
SELECT is((SELECT count(*)::int FROM public.announcements WHERE section_id = current_setting('test.sZ')::uuid), 0, 'section Z announcements removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'academics.section.deleted' AND target_id = current_setting('test.sZ')::uuid), 1, 'one audit row for the section delete');

-- Cross-tenant delete attempts stay dead.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.cross_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_section_cascade(current_setting('test.section_a')::uuid)$sql$,
  'P0001', 'forbidden',
  'cross-tenant caller cannot delete the section');

-- Offering delete: build CS404-UP on the seeded course/term, then delete it.
RESET ROLE;
INSERT INTO public.course_offerings (university_id, course_id, term_id, offering_code)
SELECT o.university_id, o.course_id, o.term_id, 'CS404-UP'
FROM public.course_offerings o
WHERE o.university_id = current_setting('test.fast_id')::uuid AND o.offering_code = 'CS301-F26';

SELECT set_config('test.off_up', (SELECT id::text FROM public.course_offerings WHERE offering_code = 'CS404-UP'), false);

INSERT INTO public.sections (university_id, offering_id, section_code, capacity, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.off_up')::uuid, 'CS', 5, current_setting('test.ta_profile')::uuid);

SELECT set_config('test.sCS', (SELECT id::text FROM public.sections WHERE offering_id = current_setting('test.off_up')::uuid), false);

INSERT INTO public.assessments (university_id, offering_id, section_id, title, assessment_type, total, weight, visibility, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.off_up')::uuid, current_setting('test.sCS')::uuid,
        'CS final', 'exam', 50, 50, 'students', current_setting('test.ta_profile')::uuid);

INSERT INTO public.offering_staff (university_id, offering_id, profile_id, staff_role, created_by)
VALUES (current_setting('test.fast_id')::uuid, current_setting('test.off_up')::uuid, current_setting('test.ta_profile')::uuid, 'ta', current_setting('test.ta_profile')::uuid);

INSERT INTO public.marks (university_id, assessment_id, student_id, score, status, created_by)
SELECT current_setting('test.fast_id')::uuid, a.id, p.id, 45, 'graded', a.created_by
FROM public.assessments a, public.profiles p
WHERE a.title = 'CS final' AND p.email = 'up.s1@lhr.nu.edu.pk';

SELECT set_config('test.a_cs', (SELECT id::text FROM public.assessments WHERE title = 'CS final'), false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok(
  $sql$SELECT public.delete_course_offering(current_setting('test.off_up')::uuid)$sql$,
  'P0001', 'marks_protected',
  'released marks block the offering delete');

SELECT lives_ok(
  $sql$SELECT public.delete_course_offering(current_setting('test.off_up')::uuid, true)$sql$,
  'force deletes the offering');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.course_offerings WHERE id = current_setting('test.off_up')::uuid), 0, 'offering removed');
SELECT is((SELECT count(*)::int FROM public.sections WHERE id = current_setting('test.sCS')::uuid), 0, 'offering section removed');
SELECT is((SELECT count(*)::int FROM public.assessments WHERE id = current_setting('test.a_cs')::uuid), 0, 'offering assessment removed');
SELECT is((SELECT count(*)::int FROM public.offering_staff WHERE offering_id = current_setting('test.off_up')::uuid), 0, 'offering staff removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'academics.offering.deleted' AND target_id = current_setting('test.off_up')::uuid), 1, 'one audit row for the offering delete');

-- Slot delete: removes the slot and writes its audit row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.delete_slot(current_setting('test.sA')::uuid)$sql$,
  'staff deletes slot A');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.slots WHERE id = current_setting('test.sA')::uuid), 0, 'slot removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'booking.slot.deleted' AND target_id = current_setting('test.sA')::uuid), 1, 'one audit row for the slot delete');

-- Period delete removes slots + bookings and writes an audit row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SELECT lives_ok(
  $sql$SELECT public.delete_evaluation_period(current_setting('test.p_bulk')::uuid)$sql$,
  'staff deletes the bulk period');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.slots WHERE period_id = current_setting('test.p_bulk')::uuid), 0, 'period cascade removed its slots');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE event_type = 'booking.period.deleted' AND target_id = current_setting('test.p_bulk')::uuid), 1, 'one audit row for the period delete');

SELECT * FROM finish();
ROLLBACK;
