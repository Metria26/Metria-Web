-- ============================================================================
-- Migration: 20261024120000_s_grant_public_api_privileges
--
-- The current Supabase Postgres image creates migrations-owned tables as
-- `postgres`. Its default ACL for `postgres`-created tables only grants
-- TRUNCATE/REFERENCES/TRIGGER to anon/authenticated/service_role, so the API
-- roles cannot SELECT or write ordinary public tables. Auth provisioning then
-- fails at `private.bootstrap_admin_email()` with
-- "permission denied for table platform_settings", and authenticated app
-- queries cannot read ordinary public tables.
--
-- Supabase's expected contract is that RLS, not table grants, is the tenant
-- boundary. Restore the API-role grants, but preserve the explicit
-- append-only/immutability revokes from earlier migrations (audit_log,
-- mark history, config versions, financial ledgers). Anonymous direct table
-- reads stay revoked; public read paths go through the narrow RPC wrappers.
-- Make future tables created by the migration role inherit the contract.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Authenticated app traffic: DML is required by policies that allow staff /
-- student writes. RLS policies are the row-level gate.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Earlier migrations deliberately rely on missing UPDATE/DELETE grants to
-- enforce append-only history. Re-apply those revokes after the broad grant.
REVOKE UPDATE, DELETE ON
  public.audit_log,
  public.role_assignment_history,
  public.mark_history,
  public.ad_config_versions,
  public.revenue_allocations,
  public.payout_events
FROM authenticated;

-- service_role is server-only (never exposed to the browser) and bypasses RLS
-- for background jobs, auth triggers and fixture setup.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- service_role also drives server-only RPCs (for example the anonymous landing
-- page resolves the ad kill state with a service-role client). Function
-- EXECUTE defaults were revoked from PUBLIC by the monetization migration, so
-- restore it for the server role only. Browser roles keep their narrow grants.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future tables/sequences/functions created by the migration role must be
-- usable by the API without another grant migration. Anonymous direct table
-- reads remain opt-in: new migrations still revoke anon explicitly where a
-- table is private.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ============================================================================
-- Rollback: revoke the explicit/default privileges. Never leave API roles
-- without table grants: auth provisioning and the whole app depend on them.
-- ============================================================================
