-- pgTAP tests for the T-B003 direct-sponsor read path (page_sponsor_slots)
-- Companion to monetization-ads.rls.test.sql (T-B002). Covers:
--   * structure + D-k grants (private stays internal, public wrapper for
--     anon + authenticated),
--   * read-time window filter (expired/future creatives excluded),
--   * inactive sponsor exclusion, http(s)-only link filtering (D-B3-a),
--   * auth page type exclusion (D-B3-b / R3),
--   * tenant isolation for the sanitized payload (no ids, no created_by),
--   * RLS baseline on the sponsor tables (member sees nothing, admin manages),
--   * the authenticated read that <AdSlot> depends on.
-- Fixtures are staged by the superuser and rolled back; seeded data: fast
-- tenant page types (seed Section 11) and ads.* flags (Section 6). No seeded
-- sponsor rows exist, so counts below are exact.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(33);

-- ---------------------------------------------------------------------------
-- A. Structure and grants
-- ---------------------------------------------------------------------------

SELECT ok(to_regprocedure('private.page_sponsor_slots(uuid,text)') IS NOT NULL,'private.page_sponsor_slots installed');
SELECT ok(to_regprocedure('public.page_sponsor_slots(uuid,text)') IS NOT NULL,'public page_sponsor_slots wrapper installed');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsors'::regclass),'sponsors has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsor_creatives'::regclass),'sponsor_creatives has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.sponsor_slots'::regclass),'sponsor_slots has RLS');
SELECT ok(has_function_privilege('anon','public.page_sponsor_slots(uuid,text)','EXECUTE'),'anonymous can execute the wrapper');
SELECT ok(has_function_privilege('authenticated','public.page_sponsor_slots(uuid,text)','EXECUTE'),'authenticated can execute the wrapper');
SELECT ok(NOT has_function_privilege('anon','private.page_sponsor_slots(uuid,text)','EXECUTE'),'anonymous cannot execute the private function');
SELECT ok(NOT has_function_privilege('authenticated','private.page_sponsor_slots(uuid,text)','EXECUTE'),'authenticated cannot execute the private function');
SELECT ok(NOT has_table_privilege('anon','public.sponsor_slots','SELECT'),'anonymous cannot select sponsor_slots');
SELECT ok(NOT has_table_privilege('anon','public.sponsor_creatives','SELECT'),'anonymous cannot select sponsor_creatives');

-- ---------------------------------------------------------------------------
-- B. Fixtures (superuser): two tenants, windowed/invalid creatives
-- ---------------------------------------------------------------------------

INSERT INTO public.universities (id, slug, name)
VALUES ('99999999-9999-4999-8999-999999999997', 'other-uni-sponsors', 'Other Sponsor University');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
VALUES ('99999999-9999-4999-8999-999999999997', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'Sponsor Cross Member', 'sponsor.cross@other.edu');

INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
SELECT u.id, v.auth_user_id::uuid, v.display_name, v.email
FROM public.universities u
CROSS JOIN (VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'Sponsor Member', 'sponsor.member@lhr.nu.edu.pk'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 'Sponsor Platform Admin', 'sponsor.admin@lhr.nu.edu.pk')
) AS v(auth_user_id, display_name, email)
WHERE u.slug = 'fast-nuces-lahore';

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id
WHERE (u.slug = 'fast-nuces-lahore' AND p.email IN ('sponsor.member@lhr.nu.edu.pk','sponsor.admin@lhr.nu.edu.pk'))
   OR (u.slug = 'other-uni-sponsors' AND p.email = 'sponsor.cross@other.edu');

INSERT INTO public.platform_admins (university_id, profile_id, granted_by)
SELECT u.id, p.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'sponsor.admin@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore';

SELECT set_config('test.fast_id', (SELECT id::text FROM public.universities WHERE slug='fast-nuces-lahore'), false);
SELECT set_config('test.other_id', (SELECT id::text FROM public.universities WHERE slug='other-uni-sponsors'), false);
SELECT set_config('test.member_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email='sponsor.member@lhr.nu.edu.pk'), false);
SELECT set_config('test.admin_profile', (SELECT p.id::text FROM public.profiles p WHERE p.email='sponsor.admin@lhr.nu.edu.pk'), false);

-- Fast tenant: active sponsor with two windowed creatives (priorities 10/5),
-- plus four creatives that must never surface (expired, future, inactive
-- sponsor, javascript: target) and one creative slot on the auth page type.
INSERT INTO public.sponsors (university_id, name, is_active, created_by)
SELECT current_setting('test.fast_id')::uuid, 'Fast Active Sponsor', true,
       current_setting('test.admin_profile')::uuid;

INSERT INTO public.sponsor_creatives (university_id, sponsor_id, image_url, target_url, starts_at, ends_at)
SELECT current_setting('test.fast_id')::uuid, s.id, v.image_url, v.target_url, v.starts_at, v.ends_at
FROM public.sponsors s
CROSS JOIN (VALUES
  ('/ads-active-a.svg',  'https://example.org/active-a',   now() - interval '1 day', now() + interval '1 day'),
  ('/ads-active-b.svg',  'https://example.org/active-b',   now() - interval '1 day', now() + interval '1 day'),
  ('/ads-expired.svg',   'https://example.org/expired',    now() - interval '2 days', now() - interval '1 hour'),
  ('/ads-future.svg',    'https://example.org/future',     now() + interval '1 day',  now() + interval '2 days'),
  ('/ads-xss.svg',       'javascript:alert(1)',            now() - interval '1 day',  now() + interval '1 day')
) AS v(image_url, target_url, starts_at, ends_at)
WHERE s.university_id = current_setting('test.fast_id')::uuid
  AND s.name = 'Fast Active Sponsor';

INSERT INTO public.sponsors (university_id, name, is_active, created_by)
SELECT current_setting('test.fast_id')::uuid, 'Fast Inactive Sponsor', false,
       current_setting('test.admin_profile')::uuid;

INSERT INTO public.sponsor_creatives (university_id, sponsor_id, image_url, target_url, starts_at, ends_at)
SELECT current_setting('test.fast_id')::uuid, s.id, '/ads-inactive.svg', 'https://example.org/inactive',
       now() - interval '1 day', now() + interval '1 day'
FROM public.sponsors s
WHERE s.university_id = current_setting('test.fast_id')::uuid
  AND s.name = 'Fast Inactive Sponsor';

INSERT INTO public.sponsors (university_id, name, is_active, created_by)
SELECT current_setting('test.other_id')::uuid, 'Other Tenant Sponsor', true, NULL;

INSERT INTO public.sponsor_creatives (university_id, sponsor_id, image_url, target_url, starts_at, ends_at)
SELECT current_setting('test.other_id')::uuid, s.id, '/ads-other.svg', 'https://example.org/other-tenant',
       now() - interval '1 day', now() + interval '1 day'
FROM public.sponsors s
WHERE s.university_id = current_setting('test.other_id')::uuid;

-- Other tenant owns its own (non-conflicting, global key uniqueness) page type.
INSERT INTO public.page_types (university_id, key, is_auth, enabled)
SELECT current_setting('test.other_id')::uuid, 'other_dash', false, true;

-- Slots: fast tenant targets dashboard (active + invalid creatives) and the
-- auth login page type; other tenant targets other_dash.
INSERT INTO public.sponsor_slots (university_id, page_type_id, creative_id, priority)
SELECT current_setting('test.fast_id')::uuid, pt.id, c.id, v.priority
FROM public.page_types pt
CROSS JOIN (VALUES
  ('https://example.org/active-a', 10),
  ('https://example.org/active-b', 5),
  ('https://example.org/expired', 0),
  ('https://example.org/future', 0),
  ('javascript:alert(1)', 0)
) AS v(target_url, priority)
JOIN public.sponsor_creatives c
  ON c.university_id = current_setting('test.fast_id')::uuid AND c.target_url = v.target_url
WHERE pt.university_id = current_setting('test.fast_id')::uuid AND pt.key = 'dashboard';

INSERT INTO public.sponsor_slots (university_id, page_type_id, creative_id, priority)
SELECT current_setting('test.fast_id')::uuid, pt.id, c.id, 0
FROM public.page_types pt
JOIN public.sponsor_creatives c
  ON c.university_id = current_setting('test.fast_id')::uuid
 AND c.target_url = 'https://example.org/inactive'
WHERE pt.university_id = current_setting('test.fast_id')::uuid AND pt.key = 'dashboard';

INSERT INTO public.sponsor_slots (university_id, page_type_id, creative_id, priority)
SELECT current_setting('test.fast_id')::uuid, pt.id, c.id, 0
FROM public.page_types pt
CROSS JOIN public.sponsor_creatives c
WHERE pt.university_id = current_setting('test.fast_id')::uuid AND pt.key = 'login'
  AND c.university_id = current_setting('test.fast_id')::uuid
  AND c.target_url = 'https://example.org/active-a';

INSERT INTO public.sponsor_slots (university_id, page_type_id, creative_id, priority)
SELECT current_setting('test.other_id')::uuid, pt.id, c.id, 0
FROM public.page_types pt
JOIN public.sponsor_creatives c
  ON c.university_id = current_setting('test.other_id')::uuid
WHERE pt.university_id = current_setting('test.other_id')::uuid AND pt.key = 'other_dash';

SELECT set_config('test.spon_dash', public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'dashboard')::text, false);
SELECT set_config('test.spon_login', public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'login')::text, false);
SELECT set_config('test.spon_bogus', public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'no_such_page')::text, false);
SELECT set_config('test.spon_other_dashboard', public.page_sponsor_slots(current_setting('test.other_id')::uuid, 'dashboard')::text, false);
SELECT set_config('test.spon_other_own', public.page_sponsor_slots(current_setting('test.other_id')::uuid, 'other_dash')::text, false);

-- ---------------------------------------------------------------------------
-- C. Payload assertions (window filter, sanitization, auth and tenant rules)
-- ---------------------------------------------------------------------------

SELECT is(jsonb_array_length(current_setting('test.spon_dash')::jsonb->'creatives'), 2,
  'exactly the two active windowed creatives surface for dashboard (expired/future/inactive/xss excluded)');
SELECT is((current_setting('test.spon_dash')::jsonb->'creatives'->0->>'priority')::int, 10,
  'creatives ordered by sponsor slot priority desc');
SELECT ok(POSITION('example.org/expired' IN current_setting('test.spon_dash')) = 0,
  'expired creative excluded at read time');
SELECT ok(POSITION('example.org/future' IN current_setting('test.spon_dash')) = 0,
  'not-yet-started creative excluded at read time');
SELECT ok(POSITION('example.org/inactive' IN current_setting('test.spon_dash')) = 0,
  'inactive sponsor creative excluded at read time');
SELECT ok(POSITION('javascript:' IN current_setting('test.spon_dash')) = 0,
  'non-http(s) target_url filtered (D-B3-a)');
SELECT is(jsonb_array_length(current_setting('test.spon_login')::jsonb->'creatives'), 0,
  'auth page type returns no creatives even when a slot targets it (D-B3-b, R3)');
SELECT is(jsonb_array_length(current_setting('test.spon_bogus')::jsonb->'creatives'), 0,
  'unknown page type key returns an empty list');
SELECT ok(POSITION('created_by' IN current_setting('test.spon_dash')) = 0,
  'payload is sanitized (no created_by)');
SELECT ok(POSITION('sponsor_id' IN current_setting('test.spon_dash')) = 0,
  'payload is sanitized (no sponsor_id)');
SELECT is(jsonb_array_length(current_setting('test.spon_other_dashboard')::jsonb->'creatives'), 0,
  'other tenant read for fast''s page key returns nothing (tenant isolation)');
SELECT is(jsonb_array_length(current_setting('test.spon_other_own')::jsonb->'creatives'), 1,
  'other tenant reads its own creative through its own page type');
SELECT throws_ok(
  $sql$SELECT public.page_sponsor_slots('00000000-0000-4000-8000-000000000000', 'dashboard')$sql$,
  'P0001', 'not_found', 'unknown university raises not_found (registry contract)'
);

-- ---------------------------------------------------------------------------
-- D. Role checks: member, platform admin, anonymous
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.sponsor_slots), 0,'member sees no sponsor slots (platform-admin-only)');
SELECT is((SELECT count(*)::int FROM public.sponsor_creatives), 0,'member sees no sponsor creatives');
SELECT throws_ok(
  $sql$INSERT INTO public.sponsors (university_id, name)
      VALUES (current_setting('test.fast_id')::uuid, 'Member Sponsor')$sql$,
  '42501', NULL, 'member cannot insert sponsors'
);
SELECT is(
  jsonb_array_length(public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'dashboard')->'creatives'), 2,
  'member reads the sanitized sponsor list through the public wrapper (AdSlot read path)'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 'role', 'authenticated')::text, false);
SET ROLE authenticated;

SELECT ok((SELECT count(*)::int FROM public.sponsors) >= 1,'platform admin sees sponsors');
SELECT ok((SELECT count(*)::int FROM public.sponsor_creatives) >= 1,'platform admin sees sponsor creatives');
SELECT lives_ok(
  $sql$INSERT INTO public.sponsors (university_id, name, created_by)
      VALUES (current_setting('test.fast_id')::uuid, 'Admin Sponsor Insert', current_setting('test.admin_profile')::uuid)$sql$,
  'platform admin inserts a sponsor'
);

RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{}', false);

SELECT is(jsonb_typeof(public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'dashboard')->'creatives'), 'array',
  'anonymous can execute the wrapper (public ad content by design)');
SELECT is(
  jsonb_array_length(public.page_sponsor_slots(current_setting('test.fast_id')::uuid, 'dashboard')->'creatives'), 2,
  'anonymous reads the same sanitized sponsor list'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
