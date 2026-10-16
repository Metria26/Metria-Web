-- pgTAP RLS + capacity + RPC tests (evaluation_booking, T-A006)
-- Complements the docs smoke file (evaluation-booking.test.sql) with the T-A006
-- invariants: narrow policies, capacity, one-active-booking-per-period,
-- cancel cutoff (D11), staff visibility, and the dashboard evaluation_slots.
-- Builds on the seeded fixtures: offering CS301-F26 (sections A/B), ta.dev
-- staffed with booking.manage_period, student.dev enrolled in A, and the seeded
-- 'Midterm evaluation' period. True parallelism lives in e2e (P19); this file
-- verifies the sequential invariants the parallel test relies on.
-- Assertion style mirrors T-A004/A005: SET ROLE authenticated + JWT claim GUCs,
-- superuser captures ids into GUCs before switching roles. Superuser stages
-- capture offering/section/profile ids so INSERT tests do not depend on the
-- actor's visibility of parent rows (RLS checks are row-scoped).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(64);

-- ---------------------------------------------------------------------------
-- Structural checks
-- ---------------------------------------------------------------------------

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.evaluation_periods'::regclass),'evaluation_periods has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.slots'::regclass),'slots has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.bookings'::regclass),'bookings has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.waitlist_entries'::regclass),'waitlist_entries has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.swap_requests'::regclass),'swap_requests has RLS');
SELECT ok(to_regprocedure('private.current_university_ids()') IS NOT NULL,'tenant helper installed');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='bookings' AND indexname='bookings_active_period_student_uniq'),'partial unique index for active bookings exists');
SELECT ok((SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='bookings_active_period_student_uniq') ILIKE '%WHERE%active%','active-booking index is partial (D-A6-a)');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname='bookings_capacity' AND NOT tgisinternal),'capacity safety trigger exists');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_status_check'),'booking status CHECK exists (D-A6-b)');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_period_id_tenant_fk'),'bookings period tenant FK exists (D-A6-c)');
SELECT ok(NOT has_table_privilege('anon','public.evaluation_periods','SELECT'),'anonymous cannot select evaluation_periods');
SELECT ok(NOT has_table_privilege('anon','public.bookings','SELECT'),'anonymous cannot select bookings');
SELECT ok(NOT has_function_privilege('anon','public.book_slot(uuid,uuid,uuid)','EXECUTE'),'anonymous cannot execute book_slot');
SELECT ok(NOT has_function_privilege('anon','public.cancel_booking(uuid)','EXECUTE'),'anonymous cannot execute cancel_booking');

-- ---------------------------------------------------------------------------
-- Superuser fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999997', 'other-uni-booking', 'Other Booking University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
VALUES ('99999999-9999-4999-8999-999999999997', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', 'Cross Student', 'cross.student@other.edu');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT u.id, v.auth_user_id::uuid, v.display_name, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'RLS Booking Student 1', 'rls.booking1@lhr.nu.edu.pk'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'RLS Booking Student 2', 'rls.booking2@lhr.nu.edu.pk'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0003', 'RLS Booking Student 3', 'rls.booking3@lhr.nu.edu.pk'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0009', 'RLS Unstaffed TA', 'rls.booking.ta@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email)
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE (u.slug = 'fast-nuces-lahore' AND p.email IN ('rls.booking1@lhr.nu.edu.pk','rls.booking2@lhr.nu.edu.pk','rls.booking3@lhr.nu.edu.pk','rls.booking.ta@lhr.nu.edu.pk'))
   OR (u.slug = 'other-uni-booking' AND p.email = 'cross.student@other.edu');

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.roles r ON r.university_id = u.id
JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore'
  AND (r.name = 'student' AND p.email IN ('rls.booking1@lhr.nu.edu.pk','rls.booking2@lhr.nu.edu.pk','rls.booking3@lhr.nu.edu.pk')
    OR r.name = 'ta' AND p.email = 'rls.booking.ta@lhr.nu.edu.pk');

INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT u.id, s.id, p.id, 'active', p.id
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
JOIN public.sections s ON s.university_id = u.id AND s.offering_id = o.id AND s.section_code = 'A'
JOIN public.profiles p ON p.university_id = u.id
 AND p.email IN ('rls.booking1@lhr.nu.edu.pk','rls.booking2@lhr.nu.edu.pk','rls.booking3@lhr.nu.edu.pk')
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug='fast-nuces-lahore'), false);
SELECT set_config('test.offering_id', (SELECT o.id::text FROM public.course_offerings o WHERE o.university_id = current_setting('test.fast_id')::uuid AND o.offering_code = 'CS301-F26'), false);
SELECT set_config('test.section_id', (SELECT s.id::text FROM public.sections s WHERE s.university_id = current_setting('test.fast_id')::uuid AND s.offering_id = current_setting('test.offering_id')::uuid AND s.section_code = 'A'), false);
SELECT set_config('test.ta_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'), false);
SELECT set_config('test.s1_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'rls.booking1@lhr.nu.edu.pk'), false);
SELECT set_config('test.s2_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'rls.booking2@lhr.nu.edu.pk'), false);
SELECT set_config('test.rls_ta_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email = 'rls.booking.ta@lhr.nu.edu.pk'), false);
SELECT set_config('test.ta_dev_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', false);
SELECT set_config('test.student_dev_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', false);
SELECT set_config('test.s1_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', false);
SELECT set_config('test.s2_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', false);
SELECT set_config('test.s3_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0003', false);
SELECT set_config('test.rls_ta_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0009', false);
SELECT set_config('test.cross_sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', false);

-- ---------------------------------------------------------------------------
-- Staffed TA (ta.dev) creates periods and slots through RLS
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok(private.has_permission(current_setting('test.fast_id')::uuid, 'booking.manage_period'),'staffed ta holds booking.manage_period');

SELECT lives_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS period 1', now() + interval '7 days 11 hours', now() + interval '7 days 13 hours',
              current_setting('test.ta_profile')::uuid)$sql$,
  'staffed ta creates an evaluation period'
);

SELECT lives_ok(
  $sql$INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      SELECT current_setting('test.fast_id')::uuid, ep.id,
             now() + interval '7 days 11 hours', now() + interval '7 days 11 hours 15 minutes', 2, 'RLS lab 1',
             current_setting('test.ta_profile')::uuid
      FROM public.evaluation_periods ep
      WHERE ep.university_id = current_setting('test.fast_id')::uuid AND ep.title = 'RLS period 1'$sql$,
  'staffed ta creates slot 1 (capacity 2)'
);

SELECT lives_ok(
  $sql$INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      SELECT current_setting('test.fast_id')::uuid, ep.id,
             now() + interval '7 days 12 hours', now() + interval '7 days 12 hours 15 minutes', 1, 'RLS lab 2',
             current_setting('test.ta_profile')::uuid
      FROM public.evaluation_periods ep
      WHERE ep.university_id = current_setting('test.fast_id')::uuid AND ep.title = 'RLS period 1'$sql$,
  'staffed ta creates slot 2 (capacity 1)'
);

SELECT lives_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS period cutoffs', now() + interval '1 hour', now() + interval '2 hours',
              current_setting('test.ta_profile')::uuid)$sql$,
  'staffed ta creates a period inside the cutoff horizon'
);

SELECT lives_ok(
  $sql$INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      SELECT current_setting('test.fast_id')::uuid, ep.id,
             now() + interval '1 hour', now() + interval '1 hour 15 minutes', 1, 'RLS lab 4',
             current_setting('test.ta_profile')::uuid
      FROM public.evaluation_periods ep
      WHERE ep.university_id = current_setting('test.fast_id')::uuid AND ep.title = 'RLS period cutoffs'$sql$,
  'staffed ta creates the cutoff-horizon slot'
);

SELECT lives_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS period ended', now() - interval '2 hours', now() - interval '1 hour',
              current_setting('test.ta_profile')::uuid)$sql$,
  'staffed ta creates a past period'
);

SELECT lives_ok(
  $sql$INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      SELECT current_setting('test.fast_id')::uuid, ep.id,
             now() - interval '2 hours', now() - interval '1 hour', 1, 'RLS lab 3',
             current_setting('test.ta_profile')::uuid
      FROM public.evaluation_periods ep
      WHERE ep.university_id = current_setting('test.fast_id')::uuid AND ep.title = 'RLS period ended'$sql$,
  'staffed ta creates the past slot'
);

SELECT throws_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS spoof period', now() + interval '9 days', now() + interval '10 days',
              current_setting('test.s1_profile')::uuid)$sql$,
  '42501', NULL,
  'staff cannot spoof created_by on a period'
);

SELECT throws_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES ('99999999-9999-4999-8999-999999999997'::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS cross period', now() + interval '9 days', now() + interval '10 days',
              current_setting('test.ta_profile')::uuid)$sql$,
  '42501', NULL,
  'staff cannot create a period in another tenant'
);

SELECT throws_ok(
  $sql$INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      SELECT current_setting('test.fast_id')::uuid, ep.id,
             now() + interval '7 days 14 hours', now() + interval '7 days 14 hours 15 minutes', 1, 'RLS lab spoof',
             current_setting('test.s2_profile')::uuid
      FROM public.evaluation_periods ep
      WHERE ep.university_id = current_setting('test.fast_id')::uuid AND ep.title = 'RLS period 1'$sql$,
  '42501', NULL,
  'staff cannot spoof created_by on a slot'
);

-- ---------------------------------------------------------------------------
-- Capture ids, then student allow/deny
-- ---------------------------------------------------------------------------

RESET ROLE;
SELECT set_config('test.p1', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'RLS period 1'), false);
SELECT set_config('test.s1', (SELECT sl.id::text FROM public.slots sl WHERE sl.period_id = current_setting('test.p1')::uuid AND sl.location = 'RLS lab 1'), false);
SELECT set_config('test.s2', (SELECT sl.id::text FROM public.slots sl WHERE sl.period_id = current_setting('test.p1')::uuid AND sl.location = 'RLS lab 2'), false);
SELECT set_config('test.p4', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'RLS period cutoffs'), false);
SELECT set_config('test.s4', (SELECT sl.id::text FROM public.slots sl WHERE sl.period_id = current_setting('test.p4')::uuid AND sl.location = 'RLS lab 4'), false);
SELECT set_config('test.p3', (SELECT id::text FROM public.evaluation_periods WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'RLS period ended'), false);
SELECT set_config('test.s3', (SELECT sl.id::text FROM public.slots sl WHERE sl.period_id = current_setting('test.p3')::uuid AND sl.location = 'RLS lab 3'), false);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.evaluation_periods WHERE id = current_setting('test.p1')::uuid),
  1,
  'enrolled student sees the period of their section'
);

SELECT throws_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS student period', now() + interval '9 days', now() + interval '10 days',
              current_setting('test.s1_profile')::uuid)$sql$,
  '42501', NULL,
  'enrolled student cannot create periods'
);

-- ---------------------------------------------------------------------------
-- student.dev books first (seeded, enrolled)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student_dev_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'enrolled student books a slot'
);

RESET ROLE;
SELECT set_config('test.b1', (SELECT b.id::text FROM public.bookings b WHERE b.slot_id = current_setting('test.s1')::uuid AND b.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk')), false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s2')::uuid)$sql$,
  'P0001', 'already_booked',
  'second booking in the same period is already_booked'
);

SELECT is(
  (SELECT count(*)::int FROM public.bookings),
  1,
  'student sees exactly their own booking'
);

-- ---------------------------------------------------------------------------
-- Capacity: fill slot 1, then slot 2; overflow is slot_full
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'second student fills slot 1'
);

RESET ROLE;
SELECT set_config('test.b2', (SELECT b.id::text FROM public.bookings b WHERE b.slot_id = current_setting('test.s1')::uuid AND b.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.booking1@lhr.nu.edu.pk')), false);
SET ROLE authenticated;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s2_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'P0001', 'slot_full',
  'booking the last seat of a full slot is slot_full'
);

SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s2')::uuid)$sql$,
  'student books the remaining single-capacity slot'
);

RESET ROLE;
SELECT set_config('test.b3', (SELECT b.id::text FROM public.bookings b WHERE b.slot_id = current_setting('test.s2')::uuid AND b.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.booking2@lhr.nu.edu.pk')), false);
SET ROLE authenticated;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s3_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s2')::uuid)$sql$,
  'P0001', 'slot_full',
  'third student gets slot_full on the single-capacity slot'
);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p3')::uuid, current_setting('test.s3')::uuid)$sql$,
  'P0001', 'slot_ended',
  'booking a slot that already ended is slot_ended'
);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s4')::uuid)$sql$,
  'P0001', 'not_found',
  'slot from another period is not_found'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant and non-enrolled callers
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.cross_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'P0001', 'forbidden',
  'cross-tenant student cannot book'
);

SELECT is(
  (SELECT count(*)::int FROM public.evaluation_periods WHERE id = current_setting('test.p1')::uuid),
  0,
  'cross-tenant student sees no periods'
);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'P0001', 'forbidden',
  'staff (not enrolled) cannot book'
);

-- ---------------------------------------------------------------------------
-- Unstaffed permission holder: manage denied, bookings invisible
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.rls_ta_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, created_by)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid, current_setting('test.section_id')::uuid,
              'RLS unstaffed period', now() + interval '9 days', now() + interval '10 days',
              current_setting('test.rls_ta_profile')::uuid)$sql$,
  '42501', NULL,
  'permission holder not staffed on the offering cannot create periods'
);

SELECT is(
  (SELECT count(*)::int FROM public.bookings),
  0,
  'unstaffed ta sees no bookings'
);

-- ---------------------------------------------------------------------------
-- Cancel: cutoff honored, owner-only, cancel frees the period for rebooking
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok(
  $sql$SELECT public.cancel_booking(current_setting('test.b2')::uuid)$sql$,
  'student cancels their booking inside the cutoff window'
);

SELECT is(
  (SELECT status FROM public.bookings WHERE id = current_setting('test.b2')::uuid),
  'cancelled',
  'cancelled booking keeps its row and status'
);

SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'cancelled period can be rebooked (partial unique, D-A6-a)'
);

-- RLS hides peer rows from this student, so the invariant is checked as the
-- superuser (the trigger/capacity path is separately exercised above).
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE slot_id = current_setting('test.s1')::uuid AND status = 'active'),
  2,
  'slot 1 holds exactly capacity active bookings after rebooking (superuser invariant)'
);

SELECT set_config('test.b2b', (SELECT b.id::text FROM public.bookings b WHERE b.slot_id = current_setting('test.s1')::uuid AND b.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.booking1@lhr.nu.edu.pk') AND b.status = 'active'), false);
SET ROLE authenticated;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student_dev_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok(
  $sql$SELECT public.cancel_booking(current_setting('test.b1')::uuid)$sql$,
  'owning student cancels student.dev booking'
);

SELECT throws_ok(
  $sql$SELECT public.cancel_booking(current_setting('test.b1')::uuid)$sql$,
  'P0001', 'not_active',
  'cancelling an already-cancelled booking is not_active'
);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p4')::uuid, current_setting('test.s4')::uuid)$sql$,
  'student books inside the cutoff horizon (booking is still allowed)'
);

RESET ROLE;
SELECT set_config('test.b4', (SELECT b.id::text FROM public.bookings b WHERE b.slot_id = current_setting('test.s4')::uuid AND b.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.booking1@lhr.nu.edu.pk')), false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT public.cancel_booking(current_setting('test.b4')::uuid)$sql$,
  'P0001', 'cutoff_passed',
  'cancel inside cutoff_hours before the slot start is cutoff_passed'
);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.cross_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.cancel_booking(current_setting('test.b2b')::uuid)$sql$,
  'P0001', 'forbidden',
  'another student cannot cancel someone else''s booking'
);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);

SELECT throws_ok(
  $sql$SELECT public.cancel_booking(gen_random_uuid())$sql$,
  'P0001', 'not_found',
  'cancelling an unknown booking is not_found'
);

-- ---------------------------------------------------------------------------
-- Staff visibility and student overview
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_dev_sub'), 'role', 'authenticated')::text, false);

SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE period_id = current_setting('test.p1')::uuid),
  4,
  'offering staff sees all bookings of the period'
);

SELECT is(
  (public.period_booking_overview(current_setting('test.p1')::uuid))->>'can_manage',
  'true',
  'staff overview flags can_manage'
);

SELECT is(
  jsonb_array_length((public.period_booking_overview(current_setting('test.p1')::uuid))->'students'),
  4,
  'staff overview lists booked students'
);

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.s1_sub'), 'role', 'authenticated')::text, false);

SELECT is(
  (public.period_booking_overview(current_setting('test.p1')::uuid))->>'can_manage',
  'false',
  'student overview does not flag can_manage'
);

SELECT is(
  jsonb_array_length((public.period_booking_overview(current_setting('test.p1')::uuid))->'students'),
  0,
  'student overview exposes no peer bookings'
);

SELECT is(
  (SELECT sl->>'booked' FROM jsonb_array_elements((public.period_booking_overview(current_setting('test.p1')::uuid))->'slots') sl
   WHERE sl->>'id' = current_setting('test.s1')),
  '1',
  'student overview carries the availability count'
);

SELECT is(
  (SELECT sl->>'my_booking_id' FROM jsonb_array_elements((public.period_booking_overview(current_setting('test.p1')::uuid))->'slots') sl
   WHERE sl->>'id' = current_setting('test.s1')),
  current_setting('test.b2b'),
  'student overview carries their own booking id'
);

SELECT ok(
  jsonb_array_length((public.student_dashboard())->'evaluation_slots') >= 3,
  'dashboard evaluation_slots is populated'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM jsonb_array_elements((public.student_dashboard())->'evaluation_slots') sl
    WHERE sl->>'slot_id' = current_setting('test.s4')
      AND sl->>'my_booking_id' = current_setting('test.b4')
  ),
  'dashboard evaluation_slots carries my upcoming booking'
);

SELECT is(
  (SELECT count(*)::int FROM public.waitlist_entries),
  0,
  'waitlist table stays dark (no member rows)'
);

SELECT is(
  (SELECT count(*)::int FROM public.swap_requests),
  0,
  'swap table stays dark (no member rows)'
);

-- ---------------------------------------------------------------------------
-- Unauthenticated claims cannot book
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);

SELECT throws_ok(
  $sql$SELECT public.book_slot(current_setting('test.fast_id')::uuid, current_setting('test.p1')::uuid, current_setting('test.s1')::uuid)$sql$,
  'P0001', 'unauthenticated',
  'claims without sub cannot book'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

SELECT * FROM finish();
ROLLBACK;
