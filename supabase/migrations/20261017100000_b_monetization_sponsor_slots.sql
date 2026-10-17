-- =============================================================================
-- T-B003: monetization/ads — direct-sponsor read path (page_sponsor_slots)
-- =============================================================================
-- Purpose: one sanitized read RPC so <AdSlot> can render admin-managed direct
-- sponsor creatives (feature 10.5) without touching the platform-admin-only
-- sponsor tables (RLS baseline stays default-deny). Expiry is a read-time
-- window filter (starts_at/ends_at vs now()) — no background job needed.
--
-- REGISTRY DELTA (T-B003, 2026-10-17): functions
--   private.page_sponsor_slots(p_university_id uuid, p_page_type text)
--   public.page_sponsor_slots(p_university_id uuid, p_page_type text)  -- D-k wrapper
-- Mirrored in docs/SYMBOL_REGISTRY.md (functions contract).
--
-- Documented deviations (T-B003, D-B3-a/b):
--   D-B3-a  the sponsor tables carry no label/creative-url columns (docs DDL);
--           the "Sponsored" label is a fixed i18n string in the renderer and
--           links/images are filtered to http(s) in SQL so a `javascript:`
--           target_url can never reach the browser (defense in depth on top
--           of the admin-only write path).
--   D-B3-b  auth page types are excluded here exactly like build_ad_config
--           (R3): a login page type targeting returns an empty list even if a
--           sponsor slot row points at it.
--
-- Security: SECURITY DEFINER with empty search_path reads sponsor_slots ->
-- sponsor_creatives -> sponsors -> page_types, filters by tenant, active
-- sponsor, now() within the creative window, non-auth page type and http(s)
-- links. Output is sanitized keys only (no ids, no created_by, no emails).
-- The private function keeps PUBLIC execute revoked; anon + authenticated
-- reach it only through the thin public wrapper (D-k, same pattern as
-- public.ad_config_snapshot / public.ad_kill_state).
--
-- ROLLBACK NOTE (expand/contract, plan.md / DECISIONS rollback rule):
-- this migration is additive (one function pair, no table/column changes and
-- no data backfill). A later contract migration may drop both functions in
-- reverse dependency order (public wrapper first, then private) without any
-- consumer downtime: <AdSlot> treats an RPC failure as "no sponsor" and keeps
-- rendering the reserved empty slot (fail empty).
-- =============================================================================

CREATE OR REPLACE FUNCTION private.page_sponsor_slots(p_university_id uuid, p_page_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Unknown tenant mirrors private.ad_config_snapshot / private.ad_kill_state.
  IF NOT EXISTS (SELECT 1 FROM public.universities u WHERE u.id = p_university_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'creatives', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'image_url', c.image_url,
          'target_url', c.target_url,
          'priority', s.priority
        )
        ORDER BY s.priority DESC, c.created_at ASC
      )
      FROM public.sponsor_slots s
      JOIN public.sponsor_creatives c
        ON c.university_id = s.university_id AND c.id = s.creative_id
      JOIN public.sponsors sp
        ON sp.university_id = c.university_id AND sp.id = c.sponsor_id
      JOIN public.page_types pt
        ON pt.university_id = s.university_id AND pt.id = s.page_type_id
      WHERE s.university_id = p_university_id
        AND pt.key = p_page_type
        AND NOT pt.is_auth
        AND sp.is_active
        AND now() >= c.starts_at
        AND now() <= c.ends_at
        AND c.target_url ~* '^https?://'
        AND (c.image_url ~* '^https?://' OR c.image_url LIKE '/%')
    ), '[]'::jsonb)
  );
END;
$$;

-- Private stays internal: the definer wrapper below runs as the owner.
REVOKE EXECUTE ON FUNCTION private.page_sponsor_slots(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.page_sponsor_slots(p_university_id uuid, p_page_type text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.page_sponsor_slots(p_university_id, p_page_type)
$$;

GRANT EXECUTE ON FUNCTION public.page_sponsor_slots(uuid, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.page_sponsor_slots(uuid, text) FROM PUBLIC;
