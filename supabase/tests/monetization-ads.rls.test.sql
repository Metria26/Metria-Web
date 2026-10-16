-- pgTAP RLS + config RPC tests (monetization_ads, T-B002)
-- Extends the docs smoke file (docs/03-database/tests/monetization.test.sql) with
-- the T-B002 invariants: platform-admin-only baseline, R3 auth page type
-- constraint, kill switch shape/uniqueness, config version immutability, and the
-- resolver config RPCs (public.ad_config_snapshot / public.ad_kill_state).
-- Assertion style mirrors T-A004/A005/A006: superuser stages fixtures and
-- captures RPC payloads into GUCs, then SET ROLE authenticated/anon with JWT
-- claim GUCs for the RLS checks. Seeded fixtures: fast-nuces-lahore ads
-- registries (seed Section 11), ads.* flags (Section 6).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(82);

-- ---------------------------------------------------------------------------
-- A. Structural checks
-- ---------------------------------------------------------------------------

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
SELECT ok(to_regprocedure('private.build_ad_config(uuid)') IS NOT NULL,'build_ad_config installed');
SELECT ok(to_regprocedure('private.ad_config_snapshot(uuid)') IS NOT NULL,'ad_config_snapshot installed');
SELECT ok(to_regprocedure('private.ad_kill_state(uuid)') IS NOT NULL,'ad_kill_state installed');
SELECT ok(to_regprocedure('public.ad_config_snapshot(uuid)') IS NOT NULL,'public snapshot wrapper installed');
SELECT ok(to_regprocedure('public.ad_kill_state(uuid)') IS NOT NULL,'public kill state wrapper installed');

-- ---------------------------------------------------------------------------
-- B. Constraints and privileges (T-B002 deviations)
-- ---------------------------------------------------------------------------

SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.page_types'::regclass AND conname='page_types_auth_disabled_check'),'auth page type CHECK exists (D-B2-b, R3)');
SELECT throws_ok(
  $sql$INSERT INTO public.page_types (university_id, key, is_auth, enabled)
      VALUES ((SELECT id FROM public.universities WHERE slug='fast-nuces-lahore'), 'rls-auth-test', true, true)$sql$,
  '23514', NULL, 'enabled auth page type rejected'
);
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ad_kill_switches'::regclass AND conname='ad_kill_switches_shape_check'),'kill switch shape CHECK exists (D-B2-c)');
SELECT throws_ok(
  $sql$INSERT INTO public.ad_kill_switches (university_id, is_global, network_id, enabled)
      SELECT (SELECT id FROM public.universities WHERE slug='fast-nuces-lahore'), true,
             (SELECT id FROM public.ad_networks WHERE key='adsterra'), true$sql$,
  '23514', NULL, 'global kill switch with a network rejected'
);
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ad_kill_switches_global_uniq'),'one global kill row per university (partial unique)');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ad_kill_switches_network_uniq'),'one kill row per network (partial unique)');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ad_config_versions_tenant_version_uniq'),'config version numbers unique per university');
SELECT ok(NOT has_table_privilege('authenticated','public.ad_config_versions','UPDATE'),'config versions immutable for authenticated (D-B2-d)');
SELECT ok(NOT has_table_privilege('anon','public.ad_networks','SELECT'),'anonymous cannot select ad_networks');
SELECT ok(NOT has_table_privilege('anon','public.page_types','SELECT'),'anonymous cannot select page_types');
SELECT ok(NOT has_table_privilege('anon','public.ad_formats','SELECT'),'anonymous cannot select ad_formats');
SELECT ok(NOT has_table_privilege('anon','public.ad_placements','SELECT'),'anonymous cannot select ad_placements');
SELECT ok(NOT has_table_privilege('anon','public.ad_config_versions','SELECT'),'anonymous cannot select ad_config_versions');
SELECT ok(NOT has_table_privilege('anon','public.ad_kill_switches','SELECT'),'anonymous cannot select ad_kill_switches');
SELECT ok(NOT has_table_privilege('anon','public.consent_records','SELECT'),'anonymous cannot select consent_records');
SELECT ok(NOT has_table_privilege('anon','public.ad_impressions','SELECT'),'anonymous cannot select ad_impressions');
SELECT ok(NOT has_table_privilege('anon','public.payouts','SELECT'),'anonymous cannot select payouts');
SELECT ok(NOT has_function_privilege('anon','private.build_ad_config(uuid)','EXECUTE'),'anonymous cannot execute build_ad_config');
SELECT ok(has_function_privilege('anon','public.ad_config_snapshot(uuid)','EXECUTE'),'anonymous can execute the snapshot wrapper');
SELECT ok(has_function_privilege('anon','public.ad_kill_state(uuid)','EXECUTE'),'anonymous can execute the kill state wrapper');

-- ---------------------------------------------------------------------------
-- C. Superuser fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999996', 'other-uni-ads', 'Other Ads University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
VALUES ('99999999-9999-4999-8999-999999999996', 'dddddddd-dddd-4ddd-8ddd-dddddddd0003', 'Ads Cross Member', 'ads.cross@other.edu');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT u.id, v.auth_user_id::uuid, v.display_name, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'Ads Member', 'ads.member@lhr.nu.edu.pk'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddd0002', 'Ads Platform Admin', 'ads.admin@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email)
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE (u.slug = 'fast-nuces-lahore' AND p.email IN ('ads.member@lhr.nu.edu.pk','ads.admin@lhr.nu.edu.pk'))
   OR (u.slug = 'other-uni-ads' AND p.email = 'ads.cross@other.edu');

INSERT INTO public.platform_admins (university_id, profile_id, granted_by)
SELECT u.id, p.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ads.admin@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';

-- Cross-tenant network (must never appear in fast-nuces-lahore snapshots).
INSERT INTO public.ad_networks (university_id, key, name, enabled)
SELECT u.id, 'crosnet', 'Cross Net', false
FROM public.universities u
WHERE u.slug = 'other-uni-ads';

-- Placement on the auth page type (must never appear in snapshots, R3).
INSERT INTO public.ad_placements (university_id, page_type_id, network_id, format_id, slot_key, enabled, priority, isolation_mode)
SELECT u.id, pt.id, n.id, f.id, 'login-banner-test', true, 99, 'no_script_ads'
FROM public.universities u
JOIN public.page_types pt ON pt.university_id = u.id AND pt.key = 'login'
JOIN public.ad_networks n ON n.university_id = u.id AND n.key = 'adsterra'
JOIN public.ad_formats f ON f.university_id = u.id AND f.key = 'banner'
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug='fast-nuces-lahore'), false);
SELECT set_config('test.other_id', (SELECT id::text FROM public.universities WHERE slug='other-uni-ads'), false);
SELECT set_config('test.member_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email='ads.member@lhr.nu.edu.pk'), false);
SELECT set_config('test.snap_fast', public.ad_config_snapshot(current_setting('test.fast_id')::uuid)::text, false);
SELECT set_config('test.snap_other', public.ad_config_snapshot(current_setting('test.other_id')::uuid)::text, false);
SELECT set_config('test.kill_pre', public.ad_kill_state(current_setting('test.fast_id')::uuid)::text, false);

-- ---------------------------------------------------------------------------
-- D. Live snapshot assertions (no published version yet)
-- ---------------------------------------------------------------------------

SELECT is(current_setting('test.snap_fast')::jsonb->>'source', 'live', 'snapshot source is live before any publish');
SELECT is((current_setting('test.snap_fast')::jsonb->>'version')::int, 0, 'live snapshot version is 0');
SELECT ok(NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_fast')::jsonb->'page_types') e WHERE e->>'key' = 'login'
),'auth page type excluded from snapshot (R3)');
SELECT ok(NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_fast')::jsonb->'placements') e WHERE e->>'slot_key' = 'login-banner-test'
),'placement on an auth page type excluded from snapshot (R3)');
SELECT ok(EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_fast')::jsonb->'placements') e WHERE e->>'slot_key' = 'dashboard-top'
),'seeded dashboard placement present');
SELECT ok(EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_fast')::jsonb->'networks') e WHERE e->>'key' = 'adsterra'
),'seeded network present');
SELECT ok(NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_fast')::jsonb->'networks') e WHERE e->>'key' = 'crosnet'
),'other tenant network absent from snapshot');
SELECT ok(POSITION('created_by' IN current_setting('test.snap_fast')) = 0,'snapshot output is sanitized (no created_by)');
SELECT ok(EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_setting('test.snap_other')::jsonb->'networks') e WHERE e->>'key' = 'crosnet'
),'other tenant snapshot carries its own network');
SELECT is(jsonb_array_length(current_setting('test.snap_other')::jsonb->'placements'), 0,'other tenant has no placements');

-- ---------------------------------------------------------------------------
-- E. Kill switches (pre and post fixtures)
-- ---------------------------------------------------------------------------

SELECT is(current_setting('test.kill_pre')::jsonb->>'global', 'false','no global kill row yet');
SELECT is(jsonb_array_length(current_setting('test.kill_pre')::jsonb->'killed_networks'), 0,'no killed networks yet');
SELECT is(current_setting('test.kill_pre')::jsonb->'flags'->>'enabled', 'false','ads.enabled flag off');
SELECT is(current_setting('test.kill_pre')::jsonb->'flags'->>'public_enabled', 'false','ads.public.enabled flag off');
SELECT is(current_setting('test.kill_pre')::jsonb->'flags'->>'private_enabled', 'false','ads.private.enabled flag off');
SELECT is(current_setting('test.kill_pre')::jsonb->'flags'->>'global_kill', 'true','ads.global_kill flag on');

INSERT INTO public.ad_kill_switches (university_id, is_global, enabled)
SELECT u.id, true, true FROM public.universities u WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.ad_kill_switches (university_id, network_id, is_global, enabled)
SELECT u.id, n.id, false, true
FROM public.universities u
JOIN public.ad_networks n ON n.university_id = u.id AND n.key = 'adsterra'
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.kill_post', public.ad_kill_state(current_setting('test.fast_id')::uuid)::text, false);

SELECT is(current_setting('test.kill_post')::jsonb->>'global', 'true','global kill row surfaced');
SELECT ok(current_setting('test.kill_post')::jsonb->'killed_networks' ? 'adsterra','killed network surfaced');
SELECT ok(NOT current_setting('test.kill_post')::jsonb->'killed_networks' ? 'adminnet','unknown network not in killed list');

-- ---------------------------------------------------------------------------
-- F. Role checks: member, platform admin, anonymous
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.ad_networks), 0,'member sees no ad networks (platform-admin-only)');
SELECT is((SELECT count(*)::int FROM public.page_types), 0,'member sees no page types');
SELECT throws_ok(
  $sql$INSERT INTO public.ad_networks (university_id, key, name)
      VALUES (current_setting('test.fast_id')::uuid, 'member-test', 'Member Test')$sql$,
  '42501', NULL, 'member cannot insert ad networks'
);
SELECT is((SELECT count(*)::int FROM public.consent_records), 0,'member sees no consent records');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-dddd-4ddd-8ddd-dddddddd0002', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok((SELECT count(*)::int FROM public.ad_networks) >= 1,'platform admin sees ad networks');
SELECT ok((SELECT count(*)::int FROM public.page_types) >= 5,'platform admin sees page types');
SELECT lives_ok(
  $sql$INSERT INTO public.ad_networks (university_id, key, name)
      VALUES (current_setting('test.fast_id')::uuid, 'adminnet', 'Admin Net')$sql$,
  'platform admin inserts an ad network'
);
SELECT throws_ok(
  $sql$UPDATE public.ad_config_versions SET config = '{}'::jsonb
      WHERE university_id = current_setting('test.fast_id')::uuid$sql$,
  '42501', NULL, 'platform admin cannot update config versions (immutable)'
);
SELECT is((SELECT count(*)::int FROM public.consent_records), 0,'platform admin reads consent records');

RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{}', false);

SELECT is(public.ad_config_snapshot(current_setting('test.fast_id')::uuid)->>'source', 'live','anonymous can call the snapshot wrapper');
SELECT is(public.ad_kill_state(current_setting('test.fast_id')::uuid)->>'global', 'true','anonymous can call the kill state wrapper');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- G. Published config version wins over the live assembly
-- ---------------------------------------------------------------------------

INSERT INTO public.ad_config_versions (university_id, version, config, created_by)
SELECT current_setting('test.fast_id')::uuid, 1,
       '{"page_types":[],"formats":[],"networks":[],"placements":[],"marker":"v1"}'::jsonb,
       current_setting('test.member_profile')::uuid;

SELECT set_config('test.snap_v1', public.ad_config_snapshot(current_setting('test.fast_id')::uuid)::text, false);

INSERT INTO public.ad_config_versions (university_id, version, config, created_by)
SELECT current_setting('test.fast_id')::uuid, 2,
       '{"page_types":[],"formats":[],"networks":[],"placements":[],"marker":"v2"}'::jsonb,
       current_setting('test.member_profile')::uuid;

SELECT set_config('test.snap_v2', public.ad_config_snapshot(current_setting('test.fast_id')::uuid)::text, false);

SELECT is(current_setting('test.snap_v1')::jsonb->>'source', 'version','published version is the active source');
SELECT is((current_setting('test.snap_v1')::jsonb->>'version')::int, 1,'active version number surfaced');
SELECT is(current_setting('test.snap_v1')::jsonb->>'marker', 'v1','version payload returned verbatim');
SELECT is(current_setting('test.snap_v2')::jsonb->>'marker', 'v2','highest version wins');

SELECT throws_ok(
  $sql$SELECT public.ad_config_snapshot('00000000-0000-4000-8000-000000000000')$sql$,
  'P0001', 'not_found', 'unknown university snapshot raises not_found'
);
SELECT throws_ok(
  $sql$SELECT public.ad_kill_state('00000000-0000-4000-8000-000000000000')$sql$,
  'P0001', 'not_found', 'unknown university kill state raises not_found'
);

SELECT * FROM finish();
ROLLBACK;
