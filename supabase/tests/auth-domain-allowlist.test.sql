-- Test: F3 auth domain allowlist + bootstrap-admin exemption (T-A002)
-- Runs against the migrated + seeded local database (db reset applies the
-- bootstrap_admin_email platform_settings row this file relies on).
BEGIN;

-- Denial events commit autonomously (dblink), so this test file must clear
-- them through the same autonomous path; an in-transaction DELETE would roll
-- back and break rerun determinism within the 10-minute rate window. Like the
-- migration, connect via the server's TCP address (loopback is trust-auth and
-- PG17 refuses that for non-superusers).
SELECT extensions.dblink_exec(
  format('host=%s port=%s dbname=%s user=postgres password=postgres',
         inet_server_addr(), coalesce(inet_server_port(), 5432), current_database()),
  'DELETE FROM private.auth_security_events');

SELECT plan(13);

-- Seed sanity: bootstrap admin email row exists (D20).
SELECT is(
  (SELECT s.value #>> '{}' FROM public.platform_settings s WHERE s.key = 'bootstrap_admin_email'),
  'metria.admin26@gmail.com',
  'bootstrap admin email seeded'
);

-- 1) Unknown domain is rejected at signup (server-side allowlist).
SELECT throws_ok(
  $sql$INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'mallory@gmail.com',
      '{"provider":"google","providers":["google"]}',
      '{"email_verified":true,"full_name":"Mallory"}')$sql$,
  'P0001', 'signup not allowed', 'unknown domain rejected');

-- 2) The denial is recorded (rate-limited security event).
SELECT is(
  (SELECT count(*)::int FROM private.auth_security_events
   WHERE email = 'mallory@gmail.com' AND event_code = 'domain_not_allowed'),
  1, 'denied signup recorded once');

-- 3) Allowed domain but unverified email is rejected.
SELECT throws_ok(
  $sql$INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'unverified@lhr.nu.edu.pk',
      '{"provider":"google","providers":["google"]}',
      '{"email_verified":false,"full_name":"Unverified"}')$sql$,
  'P0001', 'signup not allowed', 'unverified email rejected');

SELECT is(
  (SELECT count(*)::int FROM private.auth_security_events
   WHERE email = 'unverified@lhr.nu.edu.pk' AND event_code = 'email_unverified'),
  1, 'unverified denial recorded once');

-- 4) Verified student on an allowed domain: user + profile + pending membership.
INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'student@lhr.nu.edu.pk',
  '{"provider":"google","providers":["google"]}',
  '{"email_verified":true,"full_name":"Test Student"}');

SELECT ok(
  EXISTS(SELECT 1 FROM auth.users WHERE id = '22222222-2222-4222-8222-222222222222'),
  'allowed domain user created');

SELECT ok(
  EXISTS(SELECT 1 FROM public.profiles
         WHERE auth_user_id = '22222222-2222-4222-8222-222222222222'
           AND email = 'student@lhr.nu.edu.pk'
           AND display_name = 'Test Student'),
  'profile provisioned for allowed user');

SELECT is(
  (SELECT m.status FROM public.university_memberships m
   JOIN public.profiles p ON p.id = m.profile_id
   WHERE p.auth_user_id = '22222222-2222-4222-8222-222222222222'),
  'pending', 'regular membership starts pending');

SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.platform_admins
             WHERE profile_id = (SELECT id FROM public.profiles
                                 WHERE auth_user_id = '22222222-2222-4222-8222-222222222222')),
  'regular user is not a platform admin');

-- 5) Bootstrap admin: ANY domain, even unverified, is exempt (founder decision).
INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'metria.admin26@gmail.com',
  '{"provider":"google","providers":["google"]}',
  '{"email_verified":false,"full_name":"Platform Admin"}');

SELECT is(
  (SELECT m.status FROM public.university_memberships m
   JOIN public.profiles p ON p.id = m.profile_id
   WHERE p.auth_user_id = '44444444-4444-4444-8444-444444444444'),
  'active', 'bootstrap admin membership is active');

SELECT ok(
  EXISTS(SELECT 1 FROM public.platform_admins
         WHERE profile_id = (SELECT id FROM public.profiles
                             WHERE auth_user_id = '44444444-4444-4444-8444-444444444444')
           AND revoked_at IS NULL),
  'bootstrap admin granted platform admin');

SELECT is(
  (SELECT count(*)::int FROM private.auth_security_events
   WHERE email = 'metria.admin26@gmail.com'),
  0, 'bootstrap admin exemption leaves no denial events');

-- 6) Rate limiting: repeated denials for one email cap at 5 events / 10 min.
DO $$
BEGIN
  FOR i IN 1..6 LOOP
    BEGIN
      INSERT INTO auth.users (aud, role, email, raw_app_meta_data, raw_user_meta_data)
      VALUES ('authenticated', 'authenticated', 'spammer@gmail.com',
        '{"provider":"google","providers":["google"]}',
        '{"email_verified":true}');
    EXCEPTION WHEN raise_exception THEN
      NULL;
    END;
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM private.auth_security_events
   WHERE email = 'spammer@gmail.com'),
  5, 'denial events rate-limited to 5 per 10 minutes');

SELECT * FROM finish();
ROLLBACK;
