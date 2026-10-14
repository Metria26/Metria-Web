> Purpose: pgTAP RLS and schema smoke tests
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: A
> Last verified against SYMBOL_REGISTRY version: v1

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.evaluation_periods'::regclass),'evaluation_periods has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.slots'::regclass),'slots has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.bookings'::regclass),'bookings has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.waitlist_entries'::regclass),'waitlist_entries has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.swap_requests'::regclass),'swap_requests has RLS');
SELECT ok(to_regprocedure('private.current_university_ids()') IS NOT NULL,'tenant helper installed');
SELECT ok(NOT has_table_privilege('anon','public.profiles','SELECT'),'anonymous cannot select profiles');
SELECT ok(NOT has_table_privilege('anon','public.marks','SELECT'),'anonymous cannot select marks');
SELECT * FROM finish();
ROLLBACK;

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
