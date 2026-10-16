-- pgTAP RLS + RPC tests (T-A005 announcements, student dashboard, TA analytics)
-- Extends the T-A003/T-A004 pattern: allowed / denied / cross-tenant, plus the
-- k>=5 suppression gate (D10/P14) and the dashboard payload contract.
-- Runs against the migrated + seeded local database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(21);

-- ---------------------------------------------------------------------------
-- Structural
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.announcements'::regclass),
  'announcements has RLS'
);
SELECT ok(to_regprocedure('private.student_dashboard()') IS NOT NULL,'student_dashboard installed');
SELECT ok(to_regprocedure('private.offering_analytics(uuid)') IS NOT NULL,'offering_analytics installed');
SELECT ok(to_regprocedure('public.student_dashboard()') IS NOT NULL,'public student_dashboard wrapper installed');
SELECT ok(to_regprocedure('public.offering_analytics(uuid)') IS NOT NULL,'public offering_analytics wrapper installed');
SELECT ok(NOT has_table_privilege('anon','public.announcements','SELECT'),'anonymous cannot select announcements');

-- ---------------------------------------------------------------------------
-- Fixtures (superuser; rolled back with the transaction).
-- One other university for cross-tenant checks; a TA, an enrolled student and
-- two extra cohorts so k>=5 has both sides of the threshold.
-- ---------------------------------------------------------------------------
INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999999', 'other-uni-a005', 'Other A005 University');

-- Other-tenant course/offering/section (cross-tenant attempts target these).
INSERT INTO public.courses (id, university_id, code, title)
VALUES ('99999999-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', 'OTH101', 'Other Course');
INSERT INTO public.terms (id, university_id, name, starts_on, ends_on)
VALUES ('99999999-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999', 'Other Term', '2026-01-01', '2026-06-30');
INSERT INTO public.course_offerings (id, university_id, course_id, term_id, offering_code)
VALUES ('99999999-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999',
        '99999999-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000002', 'OTH101-A');
INSERT INTO public.sections (id, university_id, offering_id, section_code)
VALUES ('99999999-0000-4000-8000-000000000004', '99999999-9999-4999-8999-999999999999',
        '99999999-0000-4000-8000-000000000003', 'X1');

-- FAST tenant: TA + primary student.
INSERT INTO public.profiles (id, university_id, auth_user_id, display_name, email)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'RLS A005 TA', 'rls.a005.ta@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.profiles (id, university_id, auth_user_id, display_name, email)
SELECT 'aaaaaaaa-0000-4000-8000-000000000002', id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'RLS A005 Student', 'rls.a005.student@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active' FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore' AND p.email IN ('rls.a005.ta@lhr.nu.edu.pk','rls.a005.student@lhr.nu.edu.pk');

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.a005.ta@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'ta'
WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.a005.student@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'student'
WHERE u.slug = 'fast-nuces-lahore';

-- FAST offering + two sections; TA staffs the offering.
INSERT INTO public.courses (id, university_id, code, title)
SELECT 'aaaaaaaa-0000-4000-8000-000000000010', id, 'A00501', 'A005 Course' FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.terms (id, university_id, name, starts_on, ends_on)
SELECT 'aaaaaaaa-0000-4000-8000-000000000011', id, 'A005 Term', '2026-01-01', '2026-06-30' FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.course_offerings (id, university_id, course_id, term_id, offering_code)
SELECT 'aaaaaaaa-0000-4000-8000-000000000012', id, 'aaaaaaaa-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000011', 'A00501-A'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.sections (id, university_id, offering_id, section_code)
SELECT 'aaaaaaaa-0000-4000-8000-000000000013', id, 'aaaaaaaa-0000-4000-8000-000000000012', 'A'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.sections (id, university_id, offering_id, section_code)
SELECT 'aaaaaaaa-0000-4000-8000-000000000014', id, 'aaaaaaaa-0000-4000-8000-000000000012', 'B'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.offering_staff (university_id, offering_id, profile_id, staff_role)
SELECT id, 'aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', 'ta'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

-- Enroll the primary student in section A only.
INSERT INTO public.enrollments (university_id, section_id, profile_id, status)
SELECT id, 'aaaaaaaa-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000002', 'active'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

-- Cohorts: 5 students in section A (>= k) and 2 in section B (< k).
INSERT INTO public.profiles (id, university_id, auth_user_id, display_name, email)
SELECT ('dddddddd-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, u.id,
       ('dddddddd-dddd-4ddd-8ddd-' || lpad(n::text, 12, '0'))::uuid, 'Cohort ' || n, 'cohort' || n || '@lhr.nu.edu.pk'
FROM public.universities u, generate_series(1,5) AS n WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.profiles (id, university_id, auth_user_id, display_name, email)
SELECT ('dddddddd-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, u.id,
       ('dddddddd-dddd-4ddd-8ddd-' || lpad(n::text, 12, '0'))::uuid, 'Cohort ' || n, 'cohort' || n || '@lhr.nu.edu.pk'
FROM public.universities u, generate_series(6,7) AS n WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.enrollments (university_id, section_id, profile_id, status)
SELECT u.id, 'aaaaaaaa-0000-4000-8000-000000000013', p.id, 'active'
FROM public.universities u JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore' AND p.email LIKE 'cohort%@lhr.nu.edu.pk' AND p.email IN ('cohort1@lhr.nu.edu.pk','cohort2@lhr.nu.edu.pk','cohort3@lhr.nu.edu.pk','cohort4@lhr.nu.edu.pk','cohort5@lhr.nu.edu.pk');
INSERT INTO public.enrollments (university_id, section_id, profile_id, status)
SELECT u.id, 'aaaaaaaa-0000-4000-8000-000000000014', p.id, 'active'
FROM public.universities u JOIN public.profiles p ON p.university_id = u.id
WHERE u.slug = 'fast-nuces-lahore' AND p.email IN ('cohort6@lhr.nu.edu.pk','cohort7@lhr.nu.edu.pk');

-- Assessments: A has 5 marks (>= k), B has 3 (< k).
INSERT INTO public.assessments (id, university_id, offering_id, title, assessment_type, total, weight, visibility)
SELECT 'aaaaaaaa-0000-4000-8000-000000000020', id, 'aaaaaaaa-0000-4000-8000-000000000012', 'Quiz A', 'quiz', 100, 50, 'students'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.assessments (id, university_id, offering_id, title, assessment_type, total, weight, visibility)
SELECT 'aaaaaaaa-0000-4000-8000-000000000021', id, 'aaaaaaaa-0000-4000-8000-000000000012', 'Quiz B', 'quiz', 100, 50, 'students'
FROM public.universities WHERE slug = 'fast-nuces-lahore';

INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
SELECT u.id, 'aaaaaaaa-0000-4000-8000-000000000020',
       ('dddddddd-0000-4000-8000-00000000000' || n)::uuid,
       (30 + n * 10)::numeric, 'graded'
FROM public.universities u, generate_series(1,5) AS n WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
SELECT u.id, 'aaaaaaaa-0000-4000-8000-000000000021',
       ('dddddddd-0000-4000-8000-00000000000' || n)::uuid,
       (30 + n * 10)::numeric, 'graded'
FROM public.universities u, generate_series(1,3) AS n WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug = 'fast-nuces-lahore'), false);
SELECT set_config('test.ta_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', false);
SELECT set_config('test.student_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', false);
SELECT set_config('test.offering_id', 'aaaaaaaa-0000-4000-8000-000000000012', false);

-- ---------------------------------------------------------------------------
-- As TA: staff announcement write allowed; cross-tenant denied.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT lives_ok(
  $sql$INSERT INTO public.announcements (university_id, section_id, author_id, created_by, title, body_html)
      VALUES (current_setting('test.fast_id')::uuid, 'aaaaaaaa-0000-4000-8000-000000000013',
              'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
              'Midterm update', '<p>Bring calculators.</p>')$sql$,
  'staff can post an announcement to a staffed offering section'
);

SELECT throws_ok(
  $sql$INSERT INTO public.announcements (university_id, section_id, author_id, title, body_html)
      VALUES ('99999999-9999-4999-8999-999999999999', '99999999-0000-4000-8000-000000000004',
              'aaaaaaaa-0000-4000-8000-000000000001', 'Cross tenant', '<p>x</p>')$sql$,
  '42501', NULL,
  'staff cannot post into another tenant'
);

SELECT throws_ok(
  $sql$INSERT INTO public.announcements (university_id, section_id, author_id, title, body_html)
      VALUES (current_setting('test.fast_id')::uuid, 'aaaaaaaa-0000-4000-8000-000000000014',
              'aaaaaaaa-0000-4000-8000-000000000002', 'Spoofed author', '<p>x</p>')$sql$,
  '42501', NULL,
  'staff cannot publish as a different author'
);

-- Analytics: 5-mark assessment not suppressed, 3-mark assessment suppressed,
-- 5-student section not suppressed, empty section suppressed.
SELECT is(
  (public.offering_analytics(current_setting('test.offering_id')::uuid) ->> 'k')::int,
  5,
  'analytics reports the k threshold'
);
SELECT isnt(
  (SELECT a ->> 'avg_percent' FROM jsonb_array_elements(public.offering_analytics(current_setting('test.offering_id')::uuid) -> 'assessments') a
   WHERE a ->> 'title' = 'Quiz A'),
  NULL,
  'assessment at k=5 reports a class average'
);
SELECT is(
  (SELECT a ->> 'suppressed' FROM jsonb_array_elements(public.offering_analytics(current_setting('test.offering_id')::uuid) -> 'assessments') a
   WHERE a ->> 'title' = 'Quiz B'),
  'true',
  'assessment below k=5 is suppressed'
);
SELECT is(
  (SELECT s ->> 'suppressed' FROM jsonb_array_elements(public.offering_analytics(current_setting('test.offering_id')::uuid) -> 'sections') s
   WHERE s ->> 'section_code' = 'A'),
  'false',
  'section with k>=5 students reports stats'
);
SELECT is(
  (SELECT s ->> 'suppressed' FROM jsonb_array_elements(public.offering_analytics(current_setting('test.offering_id')::uuid) -> 'sections') s
   WHERE s ->> 'section_code' = 'B'),
  'true',
  'section below k=5 is suppressed'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As enrolled student: read own section, dashboard payload, analytics denied.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.announcements WHERE section_id = 'aaaaaaaa-0000-4000-8000-000000000013'),
  1,
  'enrolled student reads their section announcement'
);

SELECT throws_ok(
  $sql$INSERT INTO public.announcements (university_id, section_id, author_id, title, body_html)
      VALUES (current_setting('test.fast_id')::uuid, 'aaaaaaaa-0000-4000-8000-000000000013',
              'aaaaaaaa-0000-4000-8000-000000000002', 'Student post', '<p>x</p>')$sql$,
  '42501', NULL,
  'student cannot post an announcement'
);

SELECT ok(
  public.student_dashboard() ? 'announcements' AND public.student_dashboard() ? 'latest_marks'
     AND public.student_dashboard() ? 'upcoming_assessments' AND public.student_dashboard() ? 'evaluation_slots',
  'student dashboard returns the registered payload keys'
);

SELECT is(
  jsonb_array_length(public.student_dashboard() -> 'announcements'),
  1,
  'student dashboard includes own-section announcements'
);

SELECT throws_ok(
  $sql$SELECT public.offering_analytics(current_setting('test.offering_id')::uuid)$sql$,
  '42501', NULL,
  'student cannot read offering analytics'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements WHERE section_id = 'aaaaaaaa-0000-4000-8000-000000000014'),
  0,
  'student cannot read a section they are not enrolled in'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- Cross-tenant analytics denied.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.offering_analytics('99999999-0000-4000-8000-000000000003'::uuid)$sql$,
  '42501', NULL,
  'analytics denied for another tenant''s offering'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

SELECT * FROM finish();
ROLLBACK;
