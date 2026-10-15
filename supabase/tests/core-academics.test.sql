-- pgTAP schema + RLS policy tests (core-academics, T-A003)
-- Source: docs/03-database/tests/core-academics.test.sql (markdown boilerplate stripped)
-- Extensions beyond the doc file (card acceptance: allowed / denied / cross-tenant):
--   - helper presence: has_permission, is_offering_staff, is_enrolled
--   - anon cannot SELECT courses
--   - as a TA (academic.manage_offering): own-tenant course INSERT allowed,
--     cross-tenant SELECT returns 0 rows, cross-tenant INSERT denied (42501)
--   - as a student (no manage permission): own-tenant course INSERT denied (42501)
-- Runs against the migrated + seeded local database (db reset applies the
-- core-academics fixtures this file builds on).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(29);

-- Structural (from docs test).
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.departments'::regclass),'departments has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.terms'::regclass),'terms has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.courses'::regclass),'courses has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.course_offerings'::regclass),'course_offerings has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sections'::regclass),'sections has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.enrollments'::regclass),'enrollments has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.offering_staff'::regclass),'offering_staff has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.grading_scales'::regclass),'grading_scales has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.assessments'::regclass),'assessments has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.marks'::regclass),'marks has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.mark_history'::regclass),'mark_history has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.import_batches'::regclass),'import_batches has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.import_rows'::regclass),'import_rows has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.announcements'::regclass),'announcements has RLS');
SELECT ok(to_regprocedure('private.current_university_ids()') IS NOT NULL,'tenant helper installed');
SELECT ok(NOT has_table_privilege('anon','public.profiles','SELECT'),'anonymous cannot select profiles');
SELECT ok(NOT has_table_privilege('anon','public.marks','SELECT'),'anonymous cannot select marks');

-- T-A003 helpers (F5-deferred pair + registry-delta has_permission).
SELECT ok(to_regprocedure('private.has_permission(uuid,text)') IS NOT NULL,'has_permission installed');
SELECT ok(to_regprocedure('private.is_offering_staff(uuid)') IS NOT NULL,'is_offering_staff installed');
SELECT ok(to_regprocedure('private.is_enrolled(uuid)') IS NOT NULL,'is_enrolled installed');
SELECT ok(NOT has_table_privilege('anon','public.courses','SELECT'),'anonymous cannot select courses');

-- ---------------------------------------------------------------------------
-- Policy fixtures (superuser; rolled back with the test transaction).
-- Cross-tenant university + synthetic TA/student profiles on the seeded FAST
-- tenant. auth_user_id values double as the JWT `sub` claims used below.
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999999', 'other-uni-test', 'Other Test University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'RLS TA', 'rls.ta@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.ta@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.ta@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'ta'
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'RLS Student', 'rls.student@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.student@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.student@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'student'
WHERE u.slug = 'fast-nuces-lahore';

-- Capture ids in session GUCs: after SET ROLE, universities is not readable
-- (platform-admin baseline policy) so subqueries would return NULL.
SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug = 'fast-nuces-lahore'), false);
SELECT set_config('test.ta1_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', false);
SELECT set_config('test.student1_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', false);

-- ---------------------------------------------------------------------------
-- As TA (claims sub = ta1 auth_user_id).
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta1_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok(
  private.has_permission(current_setting('test.fast_id')::uuid, 'academic.manage_offering'),
  'ta holds academic.manage_offering in own tenant'
);

SELECT lives_ok(
  $sql$INSERT INTO public.courses (university_id, code, title)
      VALUES (current_setting('test.fast_id')::uuid, 'RLS999', 'RLS TA Course')$sql$,
  'ta can create a course in own tenant'
);

SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE university_id = '99999999-9999-4999-8999-999999999999'),
  0,
  'ta cannot see other-tenant courses'
);

SELECT throws_ok(
  $sql$INSERT INTO public.courses (university_id, code, title)
      VALUES ('99999999-9999-4999-8999-999999999999', 'X9999', 'Cross Tenant')$sql$,
  '42501', NULL,
  'ta cannot create a course in another tenant'
);

SELECT ok(
  EXISTS(SELECT 1 FROM public.profiles WHERE email = 'student.dev@lhr.nu.edu.pk'),
  'ta can look up tenant profiles for enrollment'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As student (claims sub = student1 auth_user_id): no manage permission.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student1_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok(
  NOT private.has_permission(current_setting('test.fast_id')::uuid, 'academic.manage_offering'),
  'student does not hold academic.manage_offering'
);

SELECT throws_ok(
  $sql$INSERT INTO public.courses (university_id, code, title)
      VALUES (current_setting('test.fast_id')::uuid, 'STU999', 'Student Course')$sql$,
  '42501', NULL,
  'student cannot create a course'
);

SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE email = 'ta.dev@lhr.nu.edu.pk'),
  'student cannot list tenant profiles'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

SELECT * FROM finish();
ROLLBACK;
