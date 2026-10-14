-- Migration: auth domain allowlist + bootstrap-admin exemption + profile sync (lane: shared)
-- Card: docs/08-delivery/lane-a/tasks/t-a002-auth-and-tenant-membership.md (plan.md F3)
-- Registry: docs/SYMBOL_REGISTRY.md v1 — REGISTRY DELTA at the bottom of this file.
-- Decisions: D20 (one-time bootstrap, docs/DECISIONS.md). Founder decision 2026-10-14:
--   the single bootstrap platform-admin email is EXEMPT from the university-domain
--   allowlist (that one account may use any email domain); every other account must
--   use an active university_domains domain with a verified email.

-- ============================================================================
-- SECTION 1: internal auth security-events store (private schema, not API-exposed)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS private;

-- dblink provides the autonomous-connection needed so rate-limited denial
-- events COMMIT even though the signup that triggered them is rolled back by
-- the RAISE that follows (same-transaction inserts would be lost).
-- LOCAL DEV ONLY seed: the local stack's well-known password is stored in
-- private.runtime_config so the autonomous connection can authenticate over
-- TCP. On cloud, operators must UPDATE that row with the real project postgres
-- password (ops SQL, never committed); if unset/wrong, denials are still
-- ENFORCED by the trigger — only the audit row is skipped (record_auth_denial
-- swallows connection errors).
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS private.runtime_config(
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO private.runtime_config (key, value)
VALUES ('metria.dblink_password', 'postgres')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.auth_security_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  event_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS auth_security_events_email_created_idx
  ON private.auth_security_events(email, created_at DESC);
GRANT USAGE, CREATE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT SELECT ON private.runtime_config TO service_role;
GRANT SELECT, INSERT, DELETE ON private.auth_security_events TO service_role;
REVOKE ALL ON private.auth_security_events FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 2: trigger functions, owned by service_role (BYPASSRLS) so profile
-- provisioning succeeds despite FORCE ROW LEVEL SECURITY on public tables.
-- All functions: SECURITY DEFINER, search_path = '' (P12).
-- ============================================================================
SET LOCAL ROLE service_role;

CREATE OR REPLACE FUNCTION private.bootstrap_admin_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT lower(s.value #>> '{}')
  FROM public.platform_settings s
  WHERE s.key = 'bootstrap_admin_email'
  LIMIT 1
$$;

-- Rate-limited (max 5 events per email per 10 minutes) internal audit record.
-- The INSERT goes through dblink (autonomous connection) so it survives the
-- transaction rollback caused by the RAISE in assert_signup_email_allowed.
CREATE OR REPLACE FUNCTION private.record_auth_denial(p_email text, p_event_code text, p_details jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (
    SELECT count(*) FROM private.auth_security_events e
    WHERE e.email = lower(p_email) AND e.created_at > now() - interval '10 minutes'
  ) < 5 THEN
    BEGIN
      -- Connect back via the server's own TCP address (NOT 127.0.0.1: local
      -- pg_hba treats loopback/socket as trust, which PG17 refuses for
      -- non-superusers even with a password in the conn string; the eth0/bridge
      -- address hits the scram rule and password auth succeeds). NULL
      -- inet_server_addr() (socket-only sessions) yields a bad conn string ->
      -- error swallowed -> enforcement unaffected.
      PERFORM extensions.dblink_exec(
        format('host=%s port=%s dbname=%s user=postgres password=%s',
               inet_server_addr(), coalesce(inet_server_port(), 5432), current_database(),
               (SELECT rc.value FROM private.runtime_config rc WHERE rc.key = 'metria.dblink_password')),
        format('INSERT INTO private.auth_security_events (email, event_code, details) VALUES (%L, %L, %L::jsonb)',
               lower(p_email), p_event_code, coalesce(p_details, '{}'::jsonb)::text)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Enforcement must never depend on audit persistence (e.g. cloud before
      -- metria.dblink_password is configured): swallow and let the caller RAISE.
      NULL;
    END;
  END IF;
END
$$;

-- BEFORE INSERT on auth.users: server-side allowlist (UI checks are cosmetic only).
CREATE OR REPLACE FUNCTION private.assert_signup_email_allowed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := lower(coalesce(new.email, new.raw_user_meta_data ->> 'email'));
  v_admin text := private.bootstrap_admin_email();
  v_verified boolean := coalesce((new.raw_user_meta_data ->> 'email_verified')::boolean, false);
  v_domain text;
BEGIN
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    PERFORM private.record_auth_denial(coalesce(v_email, ''), 'email_missing', '{}'::jsonb);
    RAISE EXCEPTION 'signup not allowed';
  END IF;

  -- Founder decision: the bootstrap platform-admin email is exempt from the
  -- domain allowlist and the verified-email requirement (any domain).
  IF v_admin IS NOT NULL AND v_email = v_admin THEN
    RETURN new;
  END IF;

  IF NOT v_verified THEN
    PERFORM private.record_auth_denial(v_email, 'email_unverified', '{}'::jsonb);
    RAISE EXCEPTION 'signup not allowed';
  END IF;

  v_domain := split_part(v_email, '@', 2);
  IF NOT EXISTS (
    SELECT 1 FROM public.university_domains d
    WHERE d.domain = v_domain AND d.is_allowed = true
  ) THEN
    PERFORM private.record_auth_denial(v_email, 'domain_not_allowed', jsonb_build_object('domain', v_domain));
    RAISE EXCEPTION 'signup not allowed';
  END IF;

  RETURN new;
END
$$;

-- AFTER INSERT on auth.users: provision profile + membership (+ platform admin).
CREATE OR REPLACE FUNCTION private.sync_auth_user_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := lower(coalesce(new.email, new.raw_user_meta_data ->> 'email'));
  v_admin text := private.bootstrap_admin_email();
  v_is_admin boolean := v_admin IS NOT NULL AND v_email = v_admin;
  v_university_id uuid;
  v_profile_id uuid;
  v_name text;
BEGIN
  IF v_is_admin THEN
    SELECT s.university_id INTO v_university_id
    FROM public.platform_settings s
    WHERE s.key = 'bootstrap_admin_email'
    LIMIT 1;
  ELSE
    SELECT d.university_id INTO v_university_id
    FROM public.university_domains d
    WHERE d.domain = split_part(v_email, '@', 2) AND d.is_allowed = true
    ORDER BY d.created_at
    LIMIT 1;
  END IF;

  IF v_university_id IS NULL THEN
    -- assert_signup_email_allowed should have blocked this; fail closed.
    RAISE EXCEPTION 'signup not allowed';
  END IF;

  v_name := nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), '');

  INSERT INTO public.profiles (university_id, auth_user_id, display_name, email)
  VALUES (v_university_id, new.id, coalesce(v_name, split_part(v_email, '@', 1)), v_email)
  ON CONFLICT (auth_user_id) DO UPDATE SET email = excluded.email
  RETURNING id INTO v_profile_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = v_university_id AND m.profile_id = v_profile_id
  ) THEN
    INSERT INTO public.university_memberships (university_id, profile_id, status)
    VALUES (v_university_id, v_profile_id, CASE WHEN v_is_admin THEN 'active' ELSE 'pending' END);
  END IF;

  IF v_is_admin THEN
    INSERT INTO public.platform_admins (university_id, profile_id, granted_by)
    VALUES (v_university_id, v_profile_id, NULL)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN new;
END
$$;

RESET ROLE;

-- ============================================================================
-- SECTION 3: triggers on auth.users (created as postgres; functions execute
-- as their service_role owner).
-- ============================================================================
DROP TRIGGER IF EXISTS assert_signup_email_allowed ON auth.users;
CREATE TRIGGER assert_signup_email_allowed
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.assert_signup_email_allowed();

DROP TRIGGER IF EXISTS sync_auth_user_profile ON auth.users;
CREATE TRIGGER sync_auth_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.sync_auth_user_profile();

-- ============================================================================
-- REGISTRY DELTA (docs/SYMBOL_REGISTRY.md v1, registry delta protocol)
-- ============================================================================
-- Private schema additions (internal; not PostgREST-exposed):
--   tables: private.auth_security_events
--   functions: private.bootstrap_admin_email(), private.record_auth_denial(text,text,jsonb),
--              private.assert_signup_email_allowed(), private.sync_auth_user_profile()
-- platform_settings key contract: 'bootstrap_admin_email' -> jsonb string (D20 bootstrap).

-- ============================================================================
-- ROLLBACK NOTE (expand/contract, plan.md / DECISIONS rollback rule)
-- ============================================================================
-- Forward-only. To disable the allowlist without dropping history: DROP TRIGGER
-- assert_signup_email_allowed / sync_auth_user_profile on auth.users in a new
-- corrective migration; keep private.auth_security_events rows (append-only).
-- Never delete auth_security_events.
