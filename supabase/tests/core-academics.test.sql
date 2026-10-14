> Purpose: pgTAP RLS and schema smoke tests
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: A
> Last verified against SYMBOL_REGISTRY version: v1

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);
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
SELECT * FROM finish();
ROLLBACK;

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
