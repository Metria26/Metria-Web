-- pgTAP RLS + RPC tests for the Projects & Group Management module
-- (owner request 2026-11-11). Requires supabase/migrations/*_projects_groups.sql
-- (and all earlier migrations) to be applied first. Assertion style mirrors
-- admin-ads-audit.rls.test.sql: superuser stages fixtures, then SET ROLE
-- authenticated with JWT claim GUCs for the RLS/RPC checks.
--
-- NOTE: project notifications were removed from the module (owner request
-- 2026-11-11) — no notification tables or assertions exist here.
--
-- Invariants covered:
--   A. Structure: RLS enabled AND forced on all 11 project tables,
--      dashboards read policy.
--   B. Privileges: anon fully revoked on dashboards; activity logs append-only
--      for authenticated.
--   C/D. Student: draft dashboards invisible, published visible; no dashboard
--      writes; own-group members visible, other groups not; private TA notes
--      and non-student-visible activity invisible; submit_project leader-only.
--   E. Staff: draft visible; Group ID preview skips ledger conflicts and never
--      consumes; staff group creation is refused (students create groups);
--      revision gating (edit_not_allowed on resubmit without
--      allow_edit_after_submission); approve review flips group status;
--      students see the public review.
--   E2. Student: creates a group from section roster profile ids; the
--      sequential Group ID skips ledger rows and advances the counter.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(33);

-- ---------------------------------------------------------------------------
-- A. Structural checks
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM pg_class
   WHERE relname IN ('project_dashboards','project_dashboard_fields','project_group_id_ledger',
                     'project_groups','project_group_members','project_member_requests',
                     'project_submissions','project_submission_responses','project_links',
                     'project_reviews','project_activity_logs')
     AND relrowsecurity),
  11::bigint,
  'every project table has RLS enabled');
SELECT is(
  (SELECT count(*) FROM pg_class
   WHERE relname IN ('project_dashboards','project_dashboard_fields','project_group_id_ledger',
                     'project_groups','project_group_members','project_member_requests',
                     'project_submissions','project_submission_responses','project_links',
                     'project_reviews','project_activity_logs')
     AND relforcerowsecurity),
  11::bigint,
  'every project table forces RLS');
SELECT is(
  (SELECT count(*) FROM pg_policies WHERE policyname = 'project_dashboards_read'),
  1::bigint,
  'project_dashboards_read policy exists');

-- ---------------------------------------------------------------------------
-- B. Privileges (default-deny + append-only)
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_table_privilege('anon','public.project_dashboards','SELECT'),'anonymous cannot select dashboards');
SELECT ok(has_table_privilege('authenticated','public.project_activity_logs','SELECT'),'authenticated can select activity logs');
SELECT ok(NOT has_table_privilege('authenticated','public.project_activity_logs','UPDATE'),'activity logs are append-only (no UPDATE)');
SELECT ok(NOT has_table_privilege('authenticated','public.project_activity_logs','DELETE'),'activity logs are append-only (no DELETE)');

-- ---------------------------------------------------------------------------
-- C. Fixtures (superuser)
-- ---------------------------------------------------------------------------
INSERT INTO public.universities (id, slug, name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'projects-test-uni', 'Projects Test University');

INSERT INTO public.terms (id, university_id, name, starts_on, ends_on)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', DATE '2026-08-01', DATE '2026-12-20');
INSERT INTO public.courses (id, university_id, code, title)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CS301', 'Software Engineering');
INSERT INTO public.course_offerings (id, university_id, course_id, term_id, offering_code)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'CS301-F26');
INSERT INTO public.sections (id, university_id, offering_id, section_code)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003', 'A');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email, roll_no)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v.auth_user_id::uuid, v.display_name, v.email, v.roll_no
FROM (VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccc0001', 'Tayyaba Aslam', 'tayyaba.aslam@lhr.nu.edu.pk', '21L-5001'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccc0002', 'Ali Ahmed', 'l241001@lhr.nu.edu.pk', '24L-1001'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccc0003', 'Hassan Khan', 'l241002@lhr.nu.edu.pk', '24L-1002'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccc0004', 'Sara Malik', 'l241003@lhr.nu.edu.pk', '24L-1003'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccc0005', 'New Kid', 'l249100@lhr.nu.edu.pk', '24L-9100')
) AS v(auth_user_id, display_name, email, roll_no);

INSERT INTO public.offering_staff (university_id, offering_id, profile_id, staff_role)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003',
        (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid), 'ta');

INSERT INTO public.enrollments (university_id, section_id, profile_id, status)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004', p.id, 'active'
FROM public.profiles p
WHERE p.auth_user_id IN ('cccccccc-cccc-4ccc-8ccc-cccccccc0002'::uuid,
                         'cccccccc-cccc-4ccc-8ccc-cccccccc0003'::uuid,
                         'cccccccc-cccc-4ccc-8ccc-cccccccc0004'::uuid,
                         'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid);

-- Draft dashboard with TA prefix + pre-existing ledger rows (01 issued once,
-- 03 reserved by a deleted group) so sequential generation must skip both.
INSERT INTO public.project_dashboards (id, university_id, offering_id, section_id, title, status, group_id_prefix, min_members, max_members)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004',
        'FYP Sprint 1 (draft)', 'draft', 'COAL_P1', 1, 5);
INSERT INTO public.project_group_id_ledger (university_id, dashboard_id, group_id, released_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'COAL_P1_01', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'COAL_P1_03', now());

-- Published dashboard with the four default fields (title required).
INSERT INTO public.project_dashboards (id, university_id, offering_id, section_id, title, status, group_id_prefix, min_members, max_members, allow_individual)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004',
        'FYP Sprint 1', 'published', 'PRJ', 1, 5, true);
INSERT INTO public.project_dashboard_fields (university_id, dashboard_id, position, label, description, field_type, required, placeholder, options, is_system, kind)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 0, 'Project Title', '', 'short_text', true, '', '{}', true, 'project_title'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 1, 'Project Idea / Description', '', 'long_text', true, '', '{}', true, 'project_idea'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 2, 'Problem Statement', '', 'long_text', false, '', '{}', true, 'problem_statement'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 3, 'Proposed Solution', '', 'long_text', false, '', '{}', true, 'proposed_solution');

-- Two groups on the published dashboard (ledger rows first: FK).
INSERT INTO public.project_group_id_ledger (university_id, dashboard_id, group_id)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'PRJ_01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'PRJ_02');
INSERT INTO public.project_groups (id, university_id, dashboard_id, group_id, project_title)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'PRJ_01', 'Retro Encabulator'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'PRJ_02', 'Other Project');

-- Members: group_id is a uuid FK to project_groups.id (explicit casts).
INSERT INTO public.project_group_members (university_id, group_id, profile_id, name, reg_no, email, member_role, position)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', m.group_id::uuid, p.id, p.display_name, p.roll_no, p.email, m.role, m.position
FROM (VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'cccccccc-cccc-4ccc-8ccc-cccccccc0002'::uuid, 'leader', 0),
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'cccccccc-cccc-4ccc-8ccc-cccccccc0003'::uuid, 'member', 1),
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0002', 'cccccccc-cccc-4ccc-8ccc-cccccccc0004'::uuid, 'leader', 0)
) AS m(group_id, auth_user_id, role, position)
JOIN public.profiles p ON p.auth_user_id = m.auth_user_id;
UPDATE public.project_groups SET leader_member_id = (SELECT id FROM public.project_group_members WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid AND position = 0) WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid;
UPDATE public.project_groups SET leader_member_id = (SELECT id FROM public.project_group_members WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0002'::uuid AND position = 0) WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0002'::uuid;

-- One public + one private review on PRJ_01.
INSERT INTO public.project_reviews (university_id, dashboard_id, group_id, review_type, review_status, general_comments, visibility, reviewer_id, reviewer_name)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'general', 'unchanged', 'Keep going.', 'public',
   (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid), 'Tayyaba Aslam'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'general', 'unchanged', 'Private: watch the baseline section.', 'private',
   (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid), 'Tayyaba Aslam');

-- Activity: student-visible, TA-only, and dashboard-level.
INSERT INTO public.project_activity_logs (university_id, dashboard_id, group_id, actor_id, actor_role, actor_name, action, entity_type, student_visible)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001',
   (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0002'::uuid), 'student', 'Ali Ahmed', 'project.group.created', 'group', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001',
   (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid), 'ta', 'Tayyaba Aslam', 'project.review.created', 'review', false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', NULL,
   (SELECT id FROM public.profiles WHERE auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid), 'ta', 'Tayyaba Aslam', 'project.deadline.changed', 'dashboard', true);

SELECT set_config('test.proj_title_field',
  (SELECT id::text FROM public.project_dashboard_fields
   WHERE dashboard_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002' AND kind = 'project_title'),
  false);
SELECT set_config('test.proj_idea_field',
  (SELECT id::text FROM public.project_dashboard_fields
   WHERE dashboard_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002' AND kind = 'project_idea'),
  false);

-- ---------------------------------------------------------------------------
-- D. Student role (Ali Ahmed, leader of PRJ_01)
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0002', 'role', 'authenticated')::text, false);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.project_dashboards WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid), 0::bigint, 'student cannot see draft dashboards');
SELECT is((SELECT count(*) FROM public.project_dashboards WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002'::uuid), 1::bigint, 'student sees published dashboards');
SELECT throws_ok(
  'INSERT INTO public.project_dashboards (university_id, offering_id, title) VALUES (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''::uuid, ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003''::uuid, ''hack'')',
  '42501', NULL, 'student cannot create dashboards');
SELECT is((SELECT count(*) FROM public.project_group_members WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 2::bigint, 'student sees own group members');
SELECT is((SELECT count(*) FROM public.project_group_members WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0002'::uuid), 0::bigint, 'student cannot see other groups members');
SELECT is((SELECT count(*) FROM public.project_reviews WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 1::bigint, 'student sees only public reviews');
SELECT is((SELECT count(*) FROM public.project_activity_logs WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 1::bigint, 'student sees only student-visible activity of own group');
SELECT throws_ok(
  'UPDATE public.project_activity_logs SET action = ''tampered'' WHERE action = ''x''',
  '42501', NULL, 'activity logs are append-only for clients');
SELECT throws_ok(
  $$SELECT public.submit_project('dddddddd-dddd-4ddd-8ddd-dddddddd0002'::uuid, '{}'::jsonb, '[]'::jsonb)$$,
  NULL, 'not_leader', 'non-member cannot submit another group');

-- Leader submits with the required fields (title + idea).
SELECT lives_ok(
  $$SELECT public.submit_project(
       'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid,
       jsonb_build_object(current_setting('test.proj_title_field'), 'Retro Encabulator MK II',
                          current_setting('test.proj_idea_field'), 'A machine that works by retroencabulation.'),
       '[]'::jsonb)$$,
  'leader can submit the project');
SELECT is((SELECT status FROM public.project_groups WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 'submitted', 'group status moves to submitted');
SELECT is((SELECT count(*) FROM public.project_submissions WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 1::bigint, 'submission version 1 recorded');
SELECT throws_ok(
  $$SELECT public.submit_project(
       'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid,
       jsonb_build_object(current_setting('test.proj_title_field'), 'Again'),
       '[]'::jsonb)$$,
  NULL, 'edit_not_allowed', 'resubmission blocked without allow_edit_after_submission');

-- ---------------------------------------------------------------------------
-- E. Staff role (Tayyaba Aslam, TA)
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', 'role', 'authenticated')::text, false);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.project_dashboards WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid), 1::bigint, 'staff sees draft dashboards');
SELECT is(public.next_project_group_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid), 'COAL_P1_02', 'Group ID preview skips ledger conflicts (01 taken, 03 reserved)');
SELECT throws_ok(
  $$SELECT public.create_project_group(
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid,
       NULL,
       'Ledger Test Project',
       '[{"name":"New Kid","regNo":"24L-9100"}]'::jsonb)$$,
  NULL, 'forbidden', 'staff can no longer create groups (students own group formation)');
SELECT is((SELECT group_id_seq FROM public.project_dashboards WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid), 0::integer, 'refused staff creation consumes no Group ID');
SELECT is(public.next_project_group_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'::uuid), 'COAL_P1_02', 'preview unchanged after a refused creation');

-- ---------------------------------------------------------------------------
-- E2. Student role (New Kid) creates a group from the section roster
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0005', 'role', 'authenticated')::text, false);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.create_project_group(
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002'::uuid,
       NULL,
       'Ledger Test Project',
       (SELECT jsonb_build_array(jsonb_build_object(
          'profile_id', p.id, 'name', p.display_name, 'reg_no', p.roll_no))
        FROM public.profiles p
        WHERE p.auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid))$$,
  'student creates a group from section roster profile ids');
SELECT is((SELECT count(*) FROM public.project_groups WHERE group_id = 'PRJ_03'::text), 1::bigint, 'auto-issued Group ID is PRJ_03 (skips ledger rows)');
SELECT is((SELECT group_id_seq FROM public.project_dashboards WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002'::uuid), 3::integer, 'counter advanced to the consumed number');

-- Back to the TA for the remaining staff checks.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', 'role', 'authenticated')::text, false);
SET LOCAL ROLE authenticated;
SELECT is(public.next_project_group_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002'::uuid), 'PRJ_04', 'next preview follows the consumed sequence');
SELECT throws_ok(
  $$SELECT public.create_project_dashboard(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003'::uuid,
       NULL, '', '', '', NULL, NULL, false, false, false, false, false, false, 1, 5, '')$$,
  NULL, 'invalid_input', 'empty title rejected');

-- TA approves PRJ_01; the approval flips the status.
SELECT lives_ok(
  $$SELECT public.create_project_review(
       'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid, 'approve', 'Solid sprint.',
       'Approved for demo', '', '', '', 'public', NULL)$$,
  'TA can approve the project');
SELECT is((SELECT status FROM public.project_groups WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 'approved', 'approval flips group status to approved');

-- Students see the new public approval (back to student role).
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-cccc-4ccc-8ccc-cccccccc0002', 'role', 'authenticated')::text, false);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.project_reviews WHERE group_id = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid), 2::bigint, 'student sees the approval review (public only)');

SELECT * FROM finish();
ROLLBACK;
