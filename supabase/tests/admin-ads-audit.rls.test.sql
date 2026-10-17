-- pgTAP RLS tests for audit_log (AD3 admin ads console)
-- Extends the docs smoke file (docs/03-database/tests/monetization.test.sql)
-- with the AD3 invariants: audit_log structure (RLS enabled+forced, touch
-- trigger, indexes, policy), append-only privileges (authenticated keeps
-- SELECT/INSERT, loses UPDATE/DELETE; anon loses all), platform-admin-only
-- writes, and the member-denial path. Assertion style mirrors
-- monetization-ads.rls.test.sql: superuser stages fixtures, then SET ROLE
-- authenticated with JWT claim GUCs for the RLS checks. audit_log was pulled
-- forward from T-B008 per plan.md §6 AD3 (D-B4-a in the migration header).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ---------------------------------------------------------------------------
-- A. Structural checks
-- ---------------------------------------------------------------------------
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.audit_log'::regclass),'audit_log has RLS');
SELECT ok((SELECT relforcerowsecurity FROM pg_class WHERE oid='public.audit_log'::regclass),'audit_log forces RLS');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_log'::regclass AND tgname='audit_log_touch'),'audit_log touch trigger installed');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='audit_log_tenant_created_idx'),'tenant created_at index exists');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='audit_log_creator_idx'),'creator index exists');
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='audit_log_tenant_access' AND tablename='audit_log'),'audit_log_tenant_access policy exists');

-- ---------------------------------------------------------------------------
-- B. Privileges (append-only + default-deny)
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_table_privilege('anon','public.audit_log','SELECT'),'anonymous cannot select audit_log');
SELECT ok(NOT has_table_privilege('anon','public.audit_log','INSERT'),'anonymous cannot insert audit_log');
SELECT ok(has_table_privilege('authenticated','public.audit_log','SELECT'),'authenticated can select audit_log');
SELECT ok(has_table_privilege('authenticated','public.audit_log','INSERT'),'authenticated can insert audit_log');
SELECT ok(NOT has_table_privilege('authenticated','public.audit_log','UPDATE'),'audit_log append-only for authenticated (no UPDATE)');
SELECT ok(NOT has_table_privilege('authenticated','public.audit_log','DELETE'),'audit_log append-only for authenticated (no DELETE)');

-- ---------------------------------------------------------------------------
-- C. Superuser fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.universities (id, slug, name)
VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'other-uni-audit', 'Other Audit University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', v.auth_user_id::uuid, v.display_name, v.email
FROM (VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'Audit Member', 'audit.member@other.edu'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'Audit Platform Admin', 'audit.admin@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email);

INSERT INTO public.platform_admins (university_id, profile_id, granted_by)
SELECT 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', p.id, p.id
FROM public.profiles p
WHERE p.auth_user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'::uuid;

SELECT set_config('test.audit_uni', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', false);
SELECT set_config('test.audit_admin_profile', (SELECT id::text FROM public.profiles WHERE auth_user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'), false);

-- ---------------------------------------------------------------------------
-- D. Member (authenticated, no platform admin row) — denial path
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.audit_log), 0,'member sees no audit rows');
SELECT throws_ok(
  $sql$INSERT INTO public.audit_log (university_id, event_type, target_type, payload)
      VALUES (current_setting('test.audit_uni')::uuid, 'ad.config.changed', 'placement', '{}'::jsonb)$sql$,
  '42501', NULL, 'member insert into audit_log rejected'
);

-- ---------------------------------------------------------------------------
-- E. Platform admin — append-only write path
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT lives_ok(
  $sql$INSERT INTO public.audit_log (university_id, created_by, actor_id, event_type, target_type, payload)
      VALUES (current_setting('test.audit_uni')::uuid, current_setting('test.audit_admin_profile')::uuid,
              current_setting('test.audit_admin_profile')::uuid, 'ad.config.changed', 'placement',
              jsonb_build_object('to', true))$sql$,
  'platform admin can insert an audit row'
);
SELECT ok((SELECT count(*)::int FROM public.audit_log) >= 1,'platform admin sees the audit row');
SELECT throws_ok(
  $sql$UPDATE public.audit_log SET event_type='tampered'
      WHERE university_id = current_setting('test.audit_uni')::uuid$sql$,
  '42501', NULL, 'audit_log rejects UPDATE from authenticated (append-only)'
);
SELECT throws_ok(
  $sql$DELETE FROM public.audit_log
      WHERE university_id = current_setting('test.audit_uni')::uuid$sql$,
  '42501', NULL, 'audit_log rejects DELETE from authenticated (append-only)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
