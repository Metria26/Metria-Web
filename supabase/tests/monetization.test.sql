> Purpose: pgTAP RLS and schema smoke tests
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: B
> Last verified against SYMBOL_REGISTRY version: v1

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_networks'::regclass),'ad_networks has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_formats'::regclass),'ad_formats has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.page_types'::regclass),'page_types has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_placements'::regclass),'ad_placements has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_config_versions'::regclass),'ad_config_versions has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_kill_switches'::regclass),'ad_kill_switches has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsors'::regclass),'sponsors has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsor_creatives'::regclass),'sponsor_creatives has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsor_slots'::regclass),'sponsor_slots has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.page_visits_raw'::regclass),'page_visits_raw has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.page_visits_daily'::regclass),'page_visits_daily has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.attribution_rules'::regclass),'attribution_rules has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.earnings_entries'::regclass),'earnings_entries has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.revenue_share_models'::regclass),'revenue_share_models has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.revenue_allocations'::regclass),'revenue_allocations has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payout_accounts'::regclass),'payout_accounts has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payouts'::regclass),'payouts has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payout_events'::regclass),'payout_events has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_impressions'::regclass),'ad_impressions has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.consent_records'::regclass),'consent_records has RLS');
SELECT ok(to_regprocedure('private.current_university_ids()') IS NOT NULL,'tenant helper installed');
SELECT ok(NOT has_table_privilege('anon','public.profiles','SELECT'),'anonymous cannot select profiles');
SELECT ok(NOT has_table_privilege('anon','public.marks','SELECT'),'anonymous cannot select marks');
SELECT * FROM finish();
ROLLBACK;

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
