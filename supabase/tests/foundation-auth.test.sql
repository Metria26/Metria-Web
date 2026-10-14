-- pgTAP RLS and schema smoke tests (foundation-auth)
-- Source: docs/03-database/tests/foundation-auth.test.sql (markdown boilerplate stripped)
-- Deviation: anon-privilege check on public.marks is existence-safe because the
-- marks table arrives with the core-academics migration (T-A004), after this
-- foundation test. Assertion intent is unchanged.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.universities'::regclass),'universities has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.university_domains'::regclass),'university_domains has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass),'profiles has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.university_memberships'::regclass),'university_memberships has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.roles'::regclass),'roles has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.permissions'::regclass),'permissions has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.role_permissions'::regclass),'role_permissions has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.role_assignments'::regclass),'role_assignments has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.role_assignment_history'::regclass),'role_assignment_history has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.platform_admins'::regclass),'platform_admins has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.invites'::regclass),'invites has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.platform_settings'::regclass),'platform_settings has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.feature_flags'::regclass),'feature_flags has RLS');
SELECT ok(to_regprocedure('private.current_university_ids()') IS NOT NULL,'tenant helper installed');
SELECT ok(NOT has_table_privilege('anon','public.profiles','SELECT'),'anonymous cannot select profiles');
SELECT ok(CASE WHEN to_regclass('public.marks') IS NULL THEN true ELSE NOT has_table_privilege('anon','public.marks','SELECT') END,'anonymous cannot select marks');
SELECT * FROM finish();
ROLLBACK;
