-- pgTAP RLS + trigger + RPC tests (marks_import, T-A004)
-- Complements core-academics.test.sql (T-A003). Builds on the seeded FAST
-- fixtures: offering CS301-F26 (sections A/B), ta.dev staffed, student.dev
-- enrolled in A, private assessments Quiz 1/Midterm, FAST Percentage scale.
-- Added fixtures (rolled back with the transaction): a released
-- (visibility='students') assessment, one mark per student on it, a private
-- mark for privacy checks, and an enrolled RLS TA/student pair.
-- Assertion style mirrors T-A003: SET ROLE authenticated + JWT claim GUCs,
-- superuser captures ids into GUCs before switching roles.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ---------------------------------------------------------------------------
-- Superuser fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999999', 'other-uni-test', 'Other Test University');

-- rls TA: manage permission but NOT staffed on CS301-F26 (denied-staff cases).
INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'RLS TA', 'rls.ta@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active' FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.ta@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.ta@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'ta'
WHERE u.slug = 'fast-nuces-lahore';

-- rls student: enrolled in section A, used for student-facing assertions.
INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'RLS Student', 'rls.student@lhr.nu.edu.pk'
FROM public.universities WHERE slug = 'fast-nuces-lahore';
INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active' FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.student@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.student@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'student'
WHERE u.slug = 'fast-nuces-lahore';
INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT u.id, s.id, p.id, 'active', p.id
FROM public.universities u
JOIN public.sections s ON s.university_id = u.id AND s.section_code = 'A'
 AND s.offering_id = (SELECT o.id FROM public.course_offerings o JOIN public.universities u2 ON u2.id = o.university_id AND u2.slug = 'fast-nuces-lahore' WHERE o.offering_code = 'CS301-F26')
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'rls.student@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.university_id = u.id AND e.section_id = s.id AND e.profile_id = p.id);

-- Cross-tenant student (marksheet/confirm not_found paths).
INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
VALUES ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', 'Cross Student', 'cross.student@other.edu.pk');
INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT '99999999-9999-4999-8999-999999999999', id, 'active' FROM public.profiles WHERE email = 'cross.student@other.edu.pk';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug = 'fast-nuces-lahore'), false);
SELECT set_config('test.offering_id', (SELECT o.id::text FROM public.course_offerings o JOIN public.universities u ON u.id = o.university_id WHERE u.slug = 'fast-nuces-lahore' AND o.offering_code = 'CS301-F26'), false);
SELECT set_config('test.ta_staffed_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', false);
SELECT set_config('test.ta1_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', false);
SELECT set_config('test.student1_sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', false);
SELECT set_config('test.student_dev_sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', false);
SELECT set_config('test.cross_sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', false);
SELECT set_config('test.released_id', gen_random_uuid()::text, false);
SELECT set_config('test.batch1', gen_random_uuid()::text, false);
SELECT set_config('test.batch2', gen_random_uuid()::text, false);
SELECT set_config('test.batch3', gen_random_uuid()::text, false);

INSERT INTO public.assessments (id, university_id, offering_id, title, assessment_type, total, weight, visibility)
SELECT current_setting('test.released_id')::uuid, current_setting('test.fast_id')::uuid, current_setting('test.offering_id')::uuid,
       'Released Quiz', 'quiz', 10, 10, 'students'
WHERE NOT EXISTS (SELECT 1 FROM public.assessments WHERE university_id = current_setting('test.fast_id')::uuid AND title = 'Released Quiz');

SELECT set_config('test.quiz1_id', (SELECT a.id::text FROM public.assessments a WHERE a.university_id = current_setting('test.fast_id')::uuid AND a.title = 'Quiz 1'), false);

-- Superuser marks: auth.uid() is null here, so the history trigger writes
-- nothing (actor lookup fails closed) -- history is asserted via TA writes.
INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
VALUES
  (current_setting('test.fast_id')::uuid, current_setting('test.released_id')::uuid,
   (SELECT id FROM public.profiles WHERE email = 'student.dev@lhr.nu.edu.pk'), 9, 'graded'),
  (current_setting('test.fast_id')::uuid, current_setting('test.quiz1_id')::uuid,
   (SELECT id FROM public.profiles WHERE email = 'student.dev@lhr.nu.edu.pk'), 5, 'graded');

-- Structural
SELECT plan(69);

SELECT ok(to_regprocedure('private.confirm_mark_import(uuid)') IS NOT NULL,'confirm_mark_import installed');
SELECT ok(to_regprocedure('private.offering_marksheet(uuid)') IS NOT NULL,'offering_marksheet installed');
SELECT ok(to_regprocedure('private.record_mark_history()') IS NOT NULL,'record_mark_history installed');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'marks_history' AND tgrelid = 'public.marks'::regclass),'marks_history trigger installed');
SELECT ok(to_regprocedure('public.confirm_mark_import(uuid)') IS NOT NULL,'public confirm wrapper installed (D-k)');
SELECT ok(to_regprocedure('public.offering_marksheet(uuid)') IS NOT NULL,'public marksheet wrapper installed (D-k)');
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_self_read'),'profiles self-read policy installed');
SELECT is(
  (SELECT count(*)::int FROM public.mark_history WHERE university_id = current_setting('test.fast_id')::uuid),
  0,
  'no history rows from superuser fixture writes'
);

-- ---------------------------------------------------------------------------
-- As staffed TA (ta.dev, seeded offering_staff on CS301-F26)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_staffed_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok(
  private.has_permission(current_setting('test.fast_id')::uuid, 'academic.manage_offering'),
  'staffed ta holds academic.manage_offering'
);

SELECT lives_ok(
  $sql$INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.released_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk'), 8, 'graded')$sql$,
  'staff can insert a mark (enrolled student)'
);

SELECT is(
  (SELECT count(*)::int FROM public.mark_history m
   JOIN public.marks mk ON mk.id = m.mark_id
   WHERE mk.assessment_id = current_setting('test.released_id')::uuid),
  1,
  'insert wrote exactly one history row'
);

SELECT ok(
  EXISTS(SELECT 1 FROM public.mark_history m
          JOIN public.marks mk ON mk.id = m.mark_id
          WHERE mk.assessment_id = current_setting('test.released_id')::uuid
            AND mk.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')
            AND m.old_score IS NULL AND m.new_score = 8 AND m.source = 'manual'),
  'history row records creation (null -> 8, source manual)'
);

SELECT lives_ok(
  $sql$UPDATE public.marks SET score = 7
      WHERE assessment_id = current_setting('test.released_id')::uuid
        AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')$sql$,
  'staff can update a mark'
);

SELECT is(
  (SELECT count(*)::int FROM public.mark_history m
   JOIN public.marks mk ON mk.id = m.mark_id
   WHERE mk.assessment_id = current_setting('test.released_id')::uuid),
  2,
  'update wrote a second history row'
);

SELECT ok(
  EXISTS(SELECT 1 FROM public.mark_history m
          JOIN public.marks mk ON mk.id = m.mark_id
          WHERE mk.assessment_id = current_setting('test.released_id')::uuid
            AND m.old_score = 8 AND m.new_score = 7),
  'history row records old -> new scores'
);

SELECT set_config('app.mark_source', 'csv', false);
SELECT lives_ok(
  $sql$UPDATE public.marks SET score = 6
      WHERE assessment_id = current_setting('test.released_id')::uuid
        AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')$sql$,
  'staff can update a mark again'
);
SELECT ok(
  EXISTS(SELECT 1 FROM public.mark_history m
          JOIN public.marks mk ON mk.id = m.mark_id
          WHERE mk.assessment_id = current_setting('test.released_id')::uuid
            AND m.old_score = 7 AND m.new_score = 6 AND m.source = 'csv'),
  'app.mark_source GUC labels history source csv'
);
SELECT is(
  (SELECT m.score::numeric FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  6::numeric,
  'mark score is 6 before import tests'
);

-- Import fixtures: batch1 (no-overwrite) + rows; uniqueness + status CHECK.
SELECT lives_ok(
  $sql$INSERT INTO public.import_batches (id, university_id, created_by, assessment_id, idempotency_key, state, expires_at)
      VALUES (current_setting('test.batch1')::uuid, current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.released_id')::uuid, 'pgtap-batch-1', 'preview', now() + interval '1 hour')$sql$,
  'staff can create an import batch (preview)'
);
SELECT lives_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, proposed_score, status)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.batch1')::uuid, 1, 'pgtap-h1', 'rls.student@lhr.nu.edu.pk', 7, 'ready')$sql$,
  'staff can insert a ready import row'
);
SELECT lives_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, status, error_code)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.batch1')::uuid, 2, 'pgtap-h2', 'bad-row', 'invalid', 'score_invalid')$sql$,
  'staff can insert an invalid import row (preview records it)'
);
SELECT throws_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, proposed_score, status)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.batch1')::uuid, 3, 'pgtap-h1', 'dup@lhr.nu.edu.pk', 7, 'ready')$sql$,
  '23505', NULL,
  'duplicate (batch_id, row_hash) is rejected'
);
SELECT throws_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, status)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.batch1')::uuid, 4, 'pgtap-h4', 'bad-status@lhr.nu.edu.pk', 'whatever')$sql$,
  '23514', NULL,
  'import_rows.status CHECK rejects unknown statuses'
);

-- confirm_mark_import: apply batch1 without overwrite -> skip existing.
SELECT is(
  (private.confirm_mark_import(current_setting('test.batch1')::uuid)->>'state')::text,
  'applied',
  'confirm marks the batch applied'
);
SELECT is(
  (private.confirm_mark_import(current_setting('test.batch1')::uuid)->'counts'->>'skipped')::int,
  1,
  'confirm without overwrite skips the existing mark'
);
SELECT is(
  (private.confirm_mark_import(current_setting('test.batch1')::uuid)->'counts'->>'invalid')::int,
  1,
  'confirm keeps invalid rows counted'
);
SELECT is(
  (SELECT m.score::numeric FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  6::numeric,
  'skipped import leaves the existing score untouched'
);
SELECT is(
  (SELECT count(*)::int FROM public.mark_history m
   JOIN public.marks mk ON mk.id = m.mark_id
   WHERE mk.assessment_id = current_setting('test.released_id')::uuid
     AND mk.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  3,
  'idempotent replay of an applied batch writes no extra history'
);

-- batch2: overwrite_existing=true -> applied and history logged as csv.
SELECT lives_ok(
  $sql$INSERT INTO public.import_batches (id, university_id, created_by, assessment_id, idempotency_key, state, expires_at, overwrite_existing)
      VALUES (current_setting('test.batch2')::uuid, current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.released_id')::uuid, 'pgtap-batch-2', 'preview', now() + interval '1 hour', true)$sql$,
  'staff can create an overwrite import batch'
);
SELECT lives_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, proposed_score, status)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.batch2')::uuid, 1, 'pgtap-h1', 'rls.student@lhr.nu.edu.pk', 9, 'ready')$sql$,
  'staff can insert a ready row into the overwrite batch'
);
SELECT is(
  (private.confirm_mark_import(current_setting('test.batch2')::uuid)->'counts'->>'applied')::int,
  1,
  'confirm with overwrite applies the ready row'
);
SELECT is(
  (SELECT m.score::numeric FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  9::numeric,
  'overwrite replaced the existing score'
);
SELECT ok(
  EXISTS(SELECT 1 FROM public.mark_history m
          JOIN public.marks mk ON mk.id = m.mark_id
          WHERE mk.assessment_id = current_setting('test.released_id')::uuid
            AND mk.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')
            AND m.old_score = 6 AND m.new_score = 9 AND m.source = 'csv'),
  'overwrite wrote history (6 -> 9, source csv)'
);

-- batch3: expired preview + non-existent batch paths (as staffed TA).
SELECT lives_ok(
  $sql$INSERT INTO public.import_batches (id, university_id, created_by, assessment_id, idempotency_key, state, expires_at)
      VALUES (current_setting('test.batch3')::uuid, current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk'),
              current_setting('test.released_id')::uuid, 'pgtap-batch-3', 'preview', now() - interval '1 minute')$sql$,
  'staff can create a batch that is already past expiry'
);
SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(current_setting('test.batch3')::uuid)$sql$,
  'P0001', 'batch_expired',
  'confirming an expired preview raises batch_expired'
);
SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(gen_random_uuid())$sql$,
  'P0001', 'not_found',
  'confirming an unknown batch raises not_found'
);

-- mark_history is append-only: authenticated UPDATE is privilege-denied.
SELECT throws_ok(
  $sql$UPDATE public.mark_history SET reason = 'tampered'$sql$,
  '42501', NULL,
  'authenticated cannot UPDATE mark_history'
);

-- GUC suppress path (T-A008 objection RPC contract): no history row.
SELECT set_config('app.mark_history_suppress', '1', false);
SELECT lives_ok(
  $sql$UPDATE public.marks SET score = 10
      WHERE assessment_id = current_setting('test.released_id')::uuid
        AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk')$sql$,
  'staff can update a mark with history suppressed'
);
SELECT is(
  (SELECT m.score::numeric FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk')),
  10::numeric,
  'suppressed update still changed the mark'
);
SELECT is(
  (SELECT count(*)::int FROM public.mark_history m
   JOIN public.marks mk ON mk.id = m.mark_id
   WHERE mk.assessment_id = current_setting('test.released_id')::uuid
     AND mk.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk')),
  0,
  'suppressed update wrote no history'
);
SELECT set_config('app.mark_history_suppress', '0', false);
SELECT set_config('app.mark_source', 'manual', false);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As student (rls.student, enrolled in section A)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student1_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok(
  (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk') IS NOT NULL,
  'student resolves own profile (self-read)'
);
SELECT ok(
  (SELECT m.score FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')) IS NOT NULL,
  'student reads own released mark'
);
SELECT is(
  (SELECT count(*)::int FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk')),
  0,
  'student cannot read another student''s released mark'
);
SELECT is(
  (SELECT count(*)::int FROM public.marks m WHERE m.assessment_id = current_setting('test.quiz1_id')::uuid),
  0,
  'student cannot read marks of a private assessment'
);
SELECT throws_ok(
  $sql$INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.released_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk'), 5, 'graded')$sql$,
  '42501', NULL,
  'student cannot insert marks'
);
-- No UPDATE policy for students: RLS filters the row out (0 rows affected),
-- which is the expected denial semantics for UPDATE/DELETE.
UPDATE public.marks SET score = 10
WHERE assessment_id = current_setting('test.released_id')::uuid
  AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk');
SELECT is(
  (SELECT m.score::numeric FROM public.marks m
   WHERE m.assessment_id = current_setting('test.released_id')::uuid
     AND m.student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  9::numeric,
  'student UPDATE attempt changed nothing (no policy rows)'
);
DELETE FROM public.marks
WHERE assessment_id = current_setting('test.released_id')::uuid
  AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk');
SELECT ok(
  EXISTS(SELECT 1 FROM public.marks
         WHERE assessment_id = current_setting('test.released_id')::uuid
           AND student_id = (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk')),
  'student DELETE attempt removed nothing (no policy rows)'
);
SELECT throws_ok(
  $sql$INSERT INTO public.import_batches (university_id, created_by, assessment_id, idempotency_key, state, expires_at)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk'),
              current_setting('test.released_id')::uuid, 'pgtap-stu-batch', 'preview', now())$sql$,
  '42501', NULL,
  'student cannot create import batches'
);
SELECT throws_ok(
  $sql$INSERT INTO public.import_rows (university_id, created_by, batch_id, row_number, row_hash, email, proposed_score, status)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk'),
              current_setting('test.batch1')::uuid, 9, 'pgtap-h9', 'x@lhr.nu.edu.pk', 1, 'ready')$sql$,
  '42501', NULL,
  'student cannot insert import rows'
);

-- offering_marksheet (own row only; threshold=5 not met by a 2-student cohort)
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->>'thresholdMet')::boolean,
  false,
  'marksheet suppresses stats below the cohort threshold'
);
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->>'cohortSize')::int,
  2,
  'marksheet counts the active cohort'
);
SELECT is(
  jsonb_array_length(private.offering_marksheet(current_setting('test.offering_id')::uuid)->'assessments'),
  1,
  'marksheet lists only assessments released to students'
);
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->>'ownTotal')::numeric,
  9::numeric,
  'ownTotal uses the weighted formula on the own score only (9/10 * 10 = 9)'
);
SELECT ok(
  private.offering_marksheet(current_setting('test.offering_id')::uuid)->'stats' = 'null'::jsonb
  OR private.offering_marksheet(current_setting('test.offering_id')::uuid)->'stats' IS NULL,
  'stats are null when the threshold is not met'
);
SELECT is(
  private.offering_marksheet(current_setting('test.offering_id')::uuid)->'gradingScale'->>'name',
  'FAST Percentage',
  'marksheet returns the tenant percentage scale'
);
SELECT ok(
  private.offering_marksheet(current_setting('test.offering_id')::uuid)->'ownRank' = 'null'::jsonb
  OR private.offering_marksheet(current_setting('test.offering_id')::uuid)->'ownRank' IS NULL,
  'ownRank is null when the threshold is not met'
);
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->'ownScores'
    ->current_setting('test.released_id')::text->>'score')::numeric,
  9::numeric,
  'ownScores contains the caller released mark'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As non-staff TA (manage permission, no offering_staff row)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta1_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$INSERT INTO public.marks (university_id, assessment_id, student_id, score, status)
      VALUES (current_setting('test.fast_id')::uuid, current_setting('test.released_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.student@lhr.nu.edu.pk'), 5, 'graded')$sql$,
  '42501', NULL,
  'non-staff TA cannot insert marks'
);
SELECT is(
  (SELECT count(*)::int FROM public.marks WHERE assessment_id = current_setting('test.released_id')::uuid),
  0,
  'non-staff TA cannot read offering marks'
);
SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(current_setting('test.batch3')::uuid)$sql$,
  'P0001', 'forbidden',
  'non-staff TA cannot confirm an import batch'
);
SELECT throws_ok(
  $sql$INSERT INTO public.import_batches (university_id, created_by, assessment_id, idempotency_key, state, expires_at)
      VALUES (current_setting('test.fast_id')::uuid,
              (SELECT p.id FROM public.profiles p WHERE p.email = 'rls.ta@lhr.nu.edu.pk'),
              current_setting('test.released_id')::uuid, 'pgtap-nonstaff', 'preview', now())$sql$,
  '42501', NULL,
  'non-staff TA cannot create import batches'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As student.dev (second student: confirm forbidden + marksheet parity)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.student_dev_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(current_setting('test.batch3')::uuid)$sql$,
  'P0001', 'forbidden',
  'student cannot confirm an import batch'
);
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->>'ownTotal')::numeric,
  10::numeric,
  'student.dev ownTotal reflects the suppressed update (10/10*10 = 10)'
);
SELECT is(
  (private.offering_marksheet(current_setting('test.offering_id')::uuid)->'ownScores'->>
    current_setting('test.quiz1_id')::text),
  NULL,
  'marksheet omits private-assessment scores entirely'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As cross-tenant student
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.cross_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT private.offering_marksheet(current_setting('test.offering_id')::uuid)$sql$,
  'P0001', 'not_found',
  'cross-tenant caller gets not_found for a foreign offering'
);
SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(current_setting('test.batch1')::uuid)$sql$,
  'P0001', 'not_found',
  'cross-tenant caller gets not_found for a foreign batch'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As authenticated with empty claims (unauthenticated contract codes)
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT private.offering_marksheet(current_setting('test.offering_id')::uuid)$sql$,
  'P0001', 'unauthenticated',
  'marksheet raises unauthenticated without a subject'
);
SELECT throws_ok(
  $sql$SELECT private.confirm_mark_import(current_setting('test.batch1')::uuid)$sql$,
  'P0001', 'unauthenticated',
  'confirm raises unauthenticated without a subject'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- As staffed TA again: marksheet is enrollment-gated, not staff-gated
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ta_staffed_sub'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT throws_ok(
  $sql$SELECT private.offering_marksheet(current_setting('test.offering_id')::uuid)$sql$,
  'P0001', 'forbidden',
  'staffed but unenrolled TA gets forbidden from the marksheet'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

SELECT * FROM finish();
ROLLBACK;
