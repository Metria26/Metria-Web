-- ============================================================================
-- Adsterra popunder flag (owner request 2026-11-06)
-- Lane: b  Module: monetization_ads
--
-- Adds the independent `ads.popunder.enabled` kill switch and exposes it from
-- private.ad_kill_state. The code-level popunder unit is gated by this flag in
-- addition to the existing ads.enabled/public/private flags, network kill and
-- consent gates.
--
-- Absent flag rows fail closed as false, so deploying code before this
-- migration never enables popunder by accident. This migration inserts true
-- for existing tenants to match the approved production configuration.
--
-- Rollback (incident): set the flag false from /admin/ads, or:
--   DELETE FROM public.feature_flags WHERE key = 'ads.popunder.enabled';
-- and restore the previous private.ad_kill_state definition. The flag row is
-- additive; no data migration is required.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: feature flag (idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO public.feature_flags (university_id, key, enabled, config)
SELECT u.id, 'ads.popunder.enabled', true, '{}'::jsonb
FROM public.universities u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.feature_flags ff
    WHERE ff.university_id = u.id
      AND ff.key = 'ads.popunder.enabled'
  );

-- ----------------------------------------------------------------------------
-- SECTION 2: kill-state RPC now includes popunder_enabled
--
-- CREATE OR REPLACE preserves the existing function owner and ACL (the public
-- wrapper already delegates here and only anon/authenticated may execute the
-- wrapper). The shape otherwise matches 20261016200000_b_monetization_ads.sql.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.ad_kill_state(p_university_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flags jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.universities u WHERE u.id = p_university_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_flags := jsonb_build_object(
    'enabled', COALESCE((SELECT ff.enabled FROM public.feature_flags ff WHERE ff.university_id = p_university_id AND ff.key = 'ads.enabled'), false),
    'public_enabled', COALESCE((SELECT ff.enabled FROM public.feature_flags ff WHERE ff.university_id = p_university_id AND ff.key = 'ads.public.enabled'), false),
    'private_enabled', COALESCE((SELECT ff.enabled FROM public.feature_flags ff WHERE ff.university_id = p_university_id AND ff.key = 'ads.private.enabled'), false),
    'popunder_enabled', COALESCE((SELECT ff.enabled FROM public.feature_flags ff WHERE ff.university_id = p_university_id AND ff.key = 'ads.popunder.enabled'), false),
    'global_kill', COALESCE((SELECT ff.enabled FROM public.feature_flags ff WHERE ff.university_id = p_university_id AND ff.key = 'ads.global_kill'), true)
  );

  RETURN jsonb_build_object(
    'flags', v_flags,
    'global', COALESCE((
      SELECT ks.enabled FROM public.ad_kill_switches ks
      WHERE ks.university_id = p_university_id AND ks.is_global
      LIMIT 1
    ), false),
    'killed_networks', COALESCE((
      SELECT jsonb_agg(n.key ORDER BY n.key)
      FROM public.ad_kill_switches ks
      JOIN public.ad_networks n ON n.university_id = ks.university_id AND n.id = ks.network_id
      WHERE ks.university_id = p_university_id AND NOT ks.is_global AND ks.enabled
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION private.ad_kill_state(uuid) FROM PUBLIC;
