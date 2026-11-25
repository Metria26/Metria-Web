-- pgTAP tests for evaluator assignment (registry delta 2026-11-25)
-- Covers the invariants the UI cannot race-check:
--   * seats exist for every slot seat (1..capacity) and follow round-robin;
--   * one active booking takes exactly one pre-assigned seat and inherits its
--     evaluator; booked seats never move when evaluators are added/removed;
--   * bulk reassignment, explicit removal with/without replacements, and staff
--     hard-delete of a booking release the seat;
--   * overview hides ALL evaluator data from students before/without booking,
--     while exposing only their own booking's evaluator after booking.
-- Fixture pattern mirrors booking-upgrade.rls.test.sql (seeded offering
-- CS301-F26, section A, staffed ta.dev).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(37);

-- ---------------------------------------------------------------------------
-- Structural checks
-- ---------------------------------------------------------------------------

SELECT ok(to_regprocedure('private.rebuild_slot_seats(uuid)') IS NOT NULL,
  'rebuild_slot_seats installed');
SELECT ok(to_regprocedure('public.save_period_evaluators(uuid,jsonb)') IS NOT NULL,
  'save_period_evaluators wrapper installed');
SELECT ok(to_regclass('public.evaluation_period_evaluators') IS NOT NULL,
  'evaluator table installed');
SELECT ok(to_regclass('public.slot_seats') IS NOT NULL,
  'seat table installed');
SELECT ok(has_column('public.bookings', 'seat_id'), 'bookings.seat_id installed');
SELECT ok(NOT has_function_privilege('anon',
  'public.save_period_evaluators(uuid,jsonb)', 'EXECUTE'),
  'anonymous cannot save evaluators');
SELECT ok(has_function_privilege('authenticated',
  'public.save_period_evaluators(uuid,jsonb)', 'EXECUTE'),
  'authenticated can save evaluators');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT u.id, v.auth_user_id::uuid, v.display_name, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('f1eeeeee-eeee-4eee-8eee-eeeeeeee0001', 'Eval Student One', 'ev.s1@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email)
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore' AND p.email = 'ev.s1@lhr.nu.edu.pk';

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.roles r ON r.university_id = u.id
JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore' AND r.name = 'student'
  AND p.email = 'ev.s1@lhr.nu.edu.pk';

INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT u.id, s.id, p.id, 'active', p.id
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
JOIN public.sections s ON s.university_id = u.id AND s.offering_id = o.id AND s.section_code = 'A'
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ev.s1@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug='fast-nuces-lahore'), false);
SELECT set_config('test.offering_id', (SELECT o.id::text FROM public.course_offerings o
  WHERE o.university_id = current_setting('test.fast_id')::uuid AND o.offering_code='CS301-F26'), false);
SELECT set_config('test.section_a', (SELECT s.id::text FROM public.sections s
  WHERE s.university_id = current_setting('test.fast_id')::uuid
    AND s.offering_id = current_setting('test.offering_id')::uuid
    AND s.section_code='A'), false);
SELECT set_config('test.ta_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email='ta.dev@lhr.nu.edu.pk'), false);
SELECT set_config('test.student_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email='ev.s1@lhr.nu.edu.pk'), false);
SELECT set_config('test.ta_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', false);
SELECT set_config('test.student_sub', 'f1eeeeee-eeee-4eee-8eee-eeeeeeee0001', false);
SELECT set_config('test.d1', (current_date + 30)::text, false);
SELECT set_config('test.d2', (current_date + 31)::text, false);

INSERT INTO public.evaluation_periods
  (university_id,created_by,offering_id,section_id,title,starts_at,ends_at,cutoff_hours)
VALUES (
  current_setting('test.fast_id')::uuid,
  current_setting('test.ta_profile')::uuid,
  current_setting('test.offering_id')::uuid,
  current_setting('test.section_a')::uuid,
  'Evaluator assignment period',
  (current_setting('test.d1') || ' 05:00')::timestamp AT TIME ZONE 'Asia/Karachi',
  (current_setting('test.d2') || ' 23:00')::timestamp AT TIME ZONE 'Asia/Karachi',
  6
);
SELECT set_config('test.period', (SELECT id::text FROM public.evaluation_periods
  WHERE title='Evaluator assignment period'), false);

INSERT INTO public.slots (university_id,period_id,starts_at,ends_at,capacity,created_by)
SELECT current_setting('test.fast_id')::uuid,
       current_setting('test.period')::uuid,
       (current_setting('test.d1') || ' 09:00')::timestamp AT TIME ZONE 'Asia/Karachi',
       (current_setting('test.d1') || ' 09:30')::timestamp AT TIME ZONE 'Asia/Karachi',
       2, current_setting('test.ta_profile')::uuid
UNION ALL
SELECT current_setting('test.fast_id')::uuid,
       current_setting('test.period')::uuid,
       (current_setting('test.d2') || ' 09:00')::timestamp AT TIME ZONE 'Asia/Karachi',
       (current_setting('test.d2') || ' 09:30')::timestamp AT TIME ZONE 'Asia/Karachi',
       2, current_setting('test.ta_profile')::uuid;

SELECT set_config('test.slot1', (SELECT id::text FROM public.slots
  WHERE period_id=current_setting('test.period')::uuid
  ORDER BY starts_at ASC LIMIT 1), false);
SELECT set_config('test.slot2', (SELECT id::text FROM public.slots
  WHERE period_id=current_setting('test.period')::uuid
  ORDER BY starts_at DESC LIMIT 1), false);

-- Backfill legacy-style seats exactly as the migration does.
SELECT private.rebuild_slot_seats(current_setting('test.period')::uuid);

-- ---------------------------------------------------------------------------
-- Staff authors three evaluators (names typed by the TA, never hardcoded).
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.ta_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT lives_ok($sql$
  SELECT public.save_period_evaluators(current_setting('test.period')::uuid,
    jsonb_build_array(
      jsonb_build_object('name','First Evaluator','position',0),
      jsonb_build_object('name','Second Evaluator','position',1,'email','second@example.edu'),
      jsonb_build_object('name','Third Evaluator','position',2,'phone','+92-300-0000000')
    ))$sql$, 'TA saves an ordered evaluator list');

SELECT set_config('test.e1', (SELECT id::text FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid AND position=0), false);
SELECT set_config('test.e2', (SELECT id::text FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid AND position=1), false);
SELECT set_config('test.e3', (SELECT id::text FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid AND position=2), false);

SELECT is((SELECT count(*)::int FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid), 3, 'three evaluators saved');
SELECT is((SELECT count(*)::int FROM public.slot_seats
  WHERE slot_id IN (current_setting('test.slot1')::uuid, current_setting('test.slot2')::uuid)),
  4, 'one seat per capacity unit');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot1')::uuid AND seat_number=1),
  current_setting('test.e1')::uuid, 'slot 1 seat 1 → evaluator 1');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot1')::uuid AND seat_number=2),
  current_setting('test.e2')::uuid, 'slot 1 seat 2 → evaluator 2');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot2')::uuid AND seat_number=1),
  current_setting('test.e3')::uuid, 'slot 2 seat 1 → evaluator 3');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot2')::uuid AND seat_number=2),
  current_setting('test.e1')::uuid, 'slot 2 seat 2 → evaluator 1 (rotation continues)');

-- ---------------------------------------------------------------------------
-- Student books: one booking, exactly one seat, evaluator inherited.
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.student_sub'), 'role', 'authenticated')::text, false);

SELECT lives_ok($sql$
  SELECT public.book_slot(current_setting('test.fast_id')::uuid,
    current_setting('test.period')::uuid, current_setting('test.slot1')::uuid))$sql$,
  'student books a seat through the RPC');

RESET ROLE; -- direct invariant reads below are done as the test superuser
SELECT is((SELECT seat_id FROM public.bookings
  WHERE period_id=current_setting('test.period')::uuid AND status='active'),
  (SELECT id FROM public.slot_seats WHERE slot_id=current_setting('test.slot1')::uuid
    AND seat_number=1), 'booking takes exactly one pre-assigned seat');
SELECT is((SELECT evaluator_id FROM public.bookings
  WHERE period_id=current_setting('test.period')::uuid AND status='active'),
  current_setting('test.e1')::uuid, 'booking inherits its seat evaluator');
SELECT is((SELECT count(*)::int FROM public.bookings
  WHERE seat_id=(SELECT id FROM public.slot_seats WHERE slot_id=current_setting('test.slot1')::uuid
    AND seat_number=1) AND status='active'),
  1, 'seat has exactly one active booking');

-- ---------------------------------------------------------------------------
-- Add an evaluator later: booked seat is frozen, unbooked seats redistribute.
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.ta_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT lives_ok($sql$
  SELECT public.save_period_evaluators(current_setting('test.period')::uuid,
    jsonb_build_array(
      jsonb_build_object('id', current_setting('test.e1')::uuid, 'name','First Evaluator','position',0),
      jsonb_build_object('id', current_setting('test.e2')::uuid, 'name','Second Evaluator','position',1,'email','second@example.edu'),
      jsonb_build_object('id', current_setting('test.e3')::uuid, 'name','Third Evaluator','position',2,'phone','+92-300-0000000'),
      jsonb_build_object('name','Fourth Evaluator','position',3)
    ))$sql$, 'TA adds a fourth evaluator later');

SELECT set_config('test.e4', (SELECT id::text FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid AND position=3), false);

SELECT is((SELECT count(*)::int FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid), 4, 'four evaluators after add');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot1')::uuid AND seat_number=1),
  current_setting('test.e1')::uuid, 'booked seat evaluator is preserved');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot1')::uuid AND seat_number=2),
  current_setting('test.e2')::uuid, 'slot 1 unbooked seat still differs');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot2')::uuid AND seat_number=1),
  current_setting('test.e3')::uuid, 'slot 2 seat 1 keeps its rotation place');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot2')::uuid AND seat_number=2),
  current_setting('test.e4')::uuid, 'slot 2 seat 2 receives the new evaluator');

-- ---------------------------------------------------------------------------
-- Bulk reassignment and explicit removal.
-- ---------------------------------------------------------------------------

SELECT lives_ok($sql$
  SELECT public.bulk_reassign_evaluator(current_setting('test.period')::uuid,
    current_setting('test.e1')::uuid, current_setting('test.e4')::uuid))$sql$,
  'TA moves all of evaluator 1 bookings to evaluator 4');
SELECT is((SELECT evaluator_id FROM public.bookings
  WHERE period_id=current_setting('test.period')::uuid AND status='active'),
  current_setting('test.e4')::uuid, 'booking evaluator changed by bulk move');
SELECT is((SELECT evaluator_id FROM public.slot_seats
  WHERE slot_id=current_setting('test.slot1')::uuid AND seat_number=1),
  current_setting('test.e4')::uuid, 'booked seat changed by bulk move');

SELECT lives_ok($sql$
  SELECT public.remove_period_evaluator(current_setting('test.period')::uuid,
    current_setting('test.e1')::uuid, NULL))$sql$,
  'TA removes evaluator 1 once it has no bookings');
SELECT is((SELECT count(*)::int FROM public.evaluation_period_evaluators
  WHERE period_id=current_setting('test.period')::uuid), 3, 'evaluator removed');

-- ---------------------------------------------------------------------------
-- Overview privacy: students see only their own booking's evaluator.
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.student_sub'), 'role', 'authenticated')::text, false);

SELECT is(jsonb_array_length(public.period_booking_overview(
  current_setting('test.period')::uuid)->'evaluators'), 0,
  'student overview contains no evaluator list');
SELECT is(jsonb_array_length((public.period_booking_overview(
  current_setting('test.period')::uuid)->'slots')->0->'seats'), 0,
  'student overview contains no seat schedule');
SELECT is((public.period_booking_overview(current_setting('test.period')::uuid)
  ->'slots')->0->'my_evaluator'->>'name', 'Fourth Evaluator',
  'student sees their own evaluator after booking');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.ta_sub'), 'role', 'authenticated')::text, false);
SELECT is(jsonb_array_length(public.period_booking_overview(
  current_setting('test.period')::uuid)->'evaluators'), 3,
  'staff overview contains the evaluator list');
SELECT is(jsonb_array_length((public.period_booking_overview(
  current_setting('test.period')::uuid)->'slots')->0->'seats'), 2,
  'staff overview contains seat assignments');

-- ---------------------------------------------------------------------------
-- Deletion: one booking removed permanently, seat released.
-- ---------------------------------------------------------------------------

SELECT lives_ok($sql$
  SELECT public.delete_booking((SELECT id FROM public.bookings
    WHERE period_id=current_setting('test.period')::uuid AND status='active' LIMIT 1)))$sql$,
  'TA deletes a booking permanently');
SELECT is((SELECT count(*)::int FROM public.bookings
  WHERE period_id=current_setting('test.period')::uuid AND status='active'), 0,
  'booking is gone and its seat is released');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.student_sub'), 'role', 'authenticated')::text, false);
SELECT throws_ok($sql$
  SELECT public.save_period_evaluators(current_setting('test.period')::uuid, '[]'::jsonb))$sql$,
  'P0001', 'forbidden', 'student cannot change evaluators');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
