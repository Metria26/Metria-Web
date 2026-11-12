-- ============================================================================
-- HilltopAds network row (owner request 2026-11-12)
-- Lane: b  Module: monetization_ads
--
-- Gives Hilltop its own row in ad_networks so the /admin/ads console renders
-- the separate Hilltop controls the owner asked for:
--   - Kill button: the console builds one kill switch per network row
--     (setKillAction with networkId -> ad_kill_switches(is_global=false)) and
--     private.ad_kill_state already reports per-network keys, so killing
--     Hilltop flows to killed_networks without further SQL.
--   - Turn-off toggle: the Networks card lists every ad_networks row.
--   - "All" stays the existing global kill row (is_global=true).
--
-- No table changes: ad_kill_switches already supports per-network rows. The
-- row is additive and idempotent; no data migration is required.
--
-- Rollback (incident): release the kill / re-enable from /admin/ads, or:
--   DELETE FROM public.ad_networks WHERE key = 'hilltop';
-- (code surface gates fail closed once the row is gone).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: seed the hilltop network row (idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO public.ad_networks (university_id, key, name, enabled)
SELECT u.id, 'hilltop', 'Hilltop', true
FROM public.universities u
WHERE u.deleted_at IS NULL
  AND u.is_enabled
ON CONFLICT (key) DO NOTHING;
