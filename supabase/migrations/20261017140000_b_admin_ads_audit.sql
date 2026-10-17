-- =============================================================================
-- AD3: platform admin ads console — audit_log (pulled forward from T-B008)
-- =============================================================================
-- Purpose: give the /admin/ads console an append-only change trail. Every
-- admin mutation (placement/network toggles, ads.* flag flips, global/network
-- kill switches, config publish/rollback) inserts one audit_log row with the
-- registered event types ad.config.changed / ad.kill_switch.changed.
--
-- REGISTRY DELTA (AD3, 2026-10-17): none.
--   public.audit_log is pre-registered (SYMBOL_REGISTRY "Platform Admin" +
--   "Cross-cutting tables"); the event names ad.config.changed /
--   ad.kill_switch.changed are pre-registered (Event names); the route prefix
--   /admin/* and the permission platform.manage_ads are pre-registered. The
--   private.touch_audit_log() helper follows the unlisted touch_* convention
--   (zero touch_* helpers appear in the registry).
--
-- Documented deviations (AD3, D-B4-a):
--   D-B4-a  audit_log was deferred to T-B008 by T-A004 ("audit_log — deferred
--           to T-B008"); plan.md §6 AD3 requires every console change to write
--           an audit event, so this migration creates the table now, exactly
--           as specified in docs/03-database/schema/admin.sql (DDL) and
--           docs/03-database/rls/admin.sql (policy + revokes). T-B008 keeps
--           ownership of rate_limit_counters and data_deletion_requests.
--   Access interpretation: platform.manage_ads is granted to no role (seed
--   grants platform caps via platform_admins, "never roles"), so the console
--   and the table policy both enforce private.is_platform_admin() — the
--   same gate the seed comment prescribes for platform.manage_ads.
--
-- Security: default-deny baseline — table created with RLS enabled+forced,
-- policy admits only authenticated platform admins (USING + WITH CHECK),
-- anon loses all privileges, and authenticated loses UPDATE/DELETE (append-
-- only; the BEFORE UPDATE touch trigger stays for future service-role edits).
-- The docs rls file's is_platform_admin() line reflects the pre-T-A003 body
-- (profile_id = auth.uid()); the landed function resolves via
-- profiles.auth_user_id and this migration copies only policy + revokes.
--
-- ROLLBACK NOTE (expand/contract, plan.md / DECISIONS rollback rule):
-- additive table. A later contract migration may DROP TRIGGER + TABLE
-- audit_log once consumers are cleared; the admin console degrades to
-- "mutations without trail" (actions return generic on audit failure) and
-- needs no consumer downtime.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.audit_log(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, actor_id uuid, event_type text NOT NULL, target_type text NOT NULL, target_id uuid, payload jsonb NOT NULL, CONSTRAINT audit_log_pkey PRIMARY KEY(id), CONSTRAINT audit_log_tenant_id_key UNIQUE(university_id,id), CONSTRAINT audit_log_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON public.audit_log(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_creator_idx ON public.audit_log(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_audit_log() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS audit_log_touch ON public.audit_log; CREATE TRIGGER audit_log_touch BEFORE UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION private.touch_audit_log();

DROP POLICY IF EXISTS audit_log_tenant_access ON public.audit_log;
CREATE POLICY audit_log_tenant_access ON public.audit_log FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.audit_log FROM anon;
REVOKE UPDATE,DELETE ON public.audit_log FROM anon,authenticated;
