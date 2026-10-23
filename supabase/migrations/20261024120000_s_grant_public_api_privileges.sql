-- ============================================================================
-- Migration: 20261024120000_s_grant_public_api_privileges
--
-- The current Supabase Postgres image creates migrations-owned tables as
-- `postgres`. Its default ACL for `postgres`-created tables only grants
-- TRUNCATE/REFERENCES/TRIGGER to anon/authenticated/service_role, so the API
-- roles cannot SELECT or write ordinary public tables. Auth provisioning then
-- fails at `private.bootstrap_admin_email()` with
-- "permission denied for table platform_settings", and every direct table read
-- in the app fails for authenticated users.
--
-- Supabase's expected contract is that RLS, not table grants, is the tenant
-- boundary: API roles may use public tables, while policies decide which rows
-- are visible. Restore that contract explicitly and make future tables created
-- by `postgres` inherit it.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Read-only for anonymous visitors; RLS policies still deny rows unless a
-- policy explicitly targets anon.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Authenticated app traffic: DML is required by policies that allow staff /
-- student writes. RLS policies are the row-level gate.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- service_role is server-only (never exposed to the browser) and bypasses RLS
-- for background jobs, auth triggers and fixture setup.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Future tables/sequences created by the migration role must be usable by the
-- API without another grant migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- ============================================================================
-- Rollback: revoke the explicit/default privileges. Never leave API roles
-- without table grants: auth provisioning and the whole app depend on them.
-- ============================================================================
