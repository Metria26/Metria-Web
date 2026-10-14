> Purpose: pgTAP RLS and schema smoke tests
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: A
> Last verified against SYMBOL_REGISTRY version: v1

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
SELECT ok(NOT has_table_privilege('anon','public.marks','SELECT'),'anonymous cannot select marks');
SELECT * FROM finish();
ROLLBACK;

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
