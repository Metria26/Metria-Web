-- ============================================================================
-- T-B002: monetization/ads base — page/ad registries, consent records, visit
-- and revenue tables (dark), kill switches, resolver config RPCs
-- (features 10.1-10.4, 10.6)
-- Lane: b  Module: monetization_ads
--
-- Depends on: 20261014140937_s_foundation_auth (universities, feature_flags,
--             platform_admins, private.is_platform_admin),
--             20261015141145_a_core_academics (GRANT USAGE ON SCHEMA private
--             TO authenticated).
--
-- Adds:
--   1. Monetization tables copied from docs/03-database/schema/monetization.sql:
--      page/ad registries (page_types, ad_formats, ad_networks, ad_placements),
--      immutable ad_config_versions, ad_kill_switches, direct-sponsor tables,
--      consent_records, ad_impressions, page_visits_* and the revenue/payout
--      ledger. Visit/revenue/payout tables stay dark for T-B005/T-B006:
--      analytics.visits.enabled / revenue.share.enabled / payouts.enabled are
--      false (seed) and those tables keep only the platform-admin baseline.
--   2. RLS baseline from docs/03-database/rls/monetization.sql: every table is
--      platform-admin-only (private.is_platform_admin), anon revoked. Consent
--      records stay platform-admin-only for now (client consent is first-party
--      cookie state; persistence ships with the privacy/consent card).
--   3. R3 hard rule: page_types CHECK forbids enabled auth page types; the
--      snapshot RPC never returns auth page types or placements on them.
--   4. Kill switches: one global row + one row per network per university
--      (partial unique indexes) so precedence (flag > global > network) is
--      well-defined and testable.
--   5. Resolver config RPCs (registry delta below): private.build_ad_config,
--      private.ad_config_snapshot, private.ad_kill_state + public wrappers
--      (anon + authenticated: public pages and /app pages both resolve ads).
--
-- Deviations from the docs sources:
--   D-B2-a  ad_config_versions: the docs DDL declares `created_by` twice (invalid
--           SQL); kept the NOT NULL declaration once (same fix as T-A003
--           import_batches).
--   D-B2-b  page_types: CHECK NOT (is_auth AND enabled) added — R3 ("login/auth
--           constrained to disabled — DB constraint"); docs DDL carried no
--           constraint.
--   D-B2-c  ad_kill_switches: shape CHECK (global XOR network) and partial unique
--           indexes (one global row, one row per network per university) added —
--           docs DDL allowed ambiguous/duplicate rows.
--   D-B2-d  ad_config_versions: UNIQUE(university_id, version) + REVOKE
--           UPDATE,DELETE from anon,authenticated — "immutable, rollback" per
--           plan §6 AD1; rollback publishes an old config as a new version.
--   D-B2-e  public wrappers are SECURITY DEFINER (not the D-k invoker hop):
--           anon has no USAGE on schema private (foundation revokes) and public
--           pages must resolve ads; bodies only forward to the private
--           functions, which are definer with SET search_path=''.
--   D-B2-f  functions/monetization.sql defines no RPCs ("defined as narrowly
--           scoped RPCs in the API contract"); the three new functions are the
--           T-B002 resolver contract. Snapshot output is sanitized (keys only,
--           no ids/created_by) and excludes auth page types + their placements.
--   Notes   Plan bullet "device targeting" and the spec's "minimum dimensions"
--           have no columns in the docs DDL; the resolver accepts device class
--           and carries it through (no-op until a schema delta adds targeting),
--           and dimensions stay a rendering concern (T-B003).
--
-- REGISTRY DELTA (T-B002, 2026-10-16): functions
--   private.build_ad_config(p_university_id uuid) RETURNS jsonb — sanitized live
--     registry assembly (page_types/formats/networks/placements); internal only.
--   private.ad_config_snapshot(p_university_id uuid) RETURNS jsonb — active
--     version config else live assembly; public.ad_config_snapshot wrapper.
--   private.ad_kill_state(p_university_id uuid) RETURNS jsonb — ads.* flags +
--     global/network kill state; public.ad_kill_state wrapper.
--   Mirrored in docs/SYMBOL_REGISTRY.md. No new tables/views/flags/permissions/
--   env names (all pre-registered v1).
--
-- Rollback: revoke + drop public wrappers and private RPCs first, then drop
--   policies, then tables in reverse order. Visit/revenue tables are dark, so
--   no data migration is needed while flags stay off (expand/contract).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: tables (verbatim from docs/03-database/schema/monetization.sql,
-- except the documented deviations below)
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS public.ad_networks(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL UNIQUE, name text NOT NULL, enabled boolean NOT NULL DEFAULT false, CONSTRAINT ad_networks_pkey PRIMARY KEY(id), CONSTRAINT ad_networks_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_networks_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_networks_tenant_created_idx ON public.ad_networks(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_networks_creator_idx ON public.ad_networks(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_networks ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_networks FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_networks() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_networks_touch ON public.ad_networks; CREATE TRIGGER ad_networks_touch BEFORE UPDATE ON public.ad_networks FOR EACH ROW EXECUTE FUNCTION private.touch_ad_networks();
CREATE TABLE IF NOT EXISTS public.ad_formats(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL UNIQUE, is_pop_style boolean NOT NULL, needs_consent boolean NOT NULL, injection_mode text NOT NULL, CONSTRAINT ad_formats_pkey PRIMARY KEY(id), CONSTRAINT ad_formats_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_formats_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_formats_tenant_created_idx ON public.ad_formats(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_formats_creator_idx ON public.ad_formats(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_formats ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_formats FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_formats() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_formats_touch ON public.ad_formats; CREATE TRIGGER ad_formats_touch BEFORE UPDATE ON public.ad_formats FOR EACH ROW EXECUTE FUNCTION private.touch_ad_formats();
CREATE TABLE IF NOT EXISTS public.page_types(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, key text NOT NULL UNIQUE, is_auth boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true, CONSTRAINT page_types_pkey PRIMARY KEY(id), CONSTRAINT page_types_tenant_id_key UNIQUE(university_id,id), CONSTRAINT page_types_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS page_types_tenant_created_idx ON public.page_types(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS page_types_creator_idx ON public.page_types(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.page_types ENABLE ROW LEVEL SECURITY; ALTER TABLE public.page_types FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_page_types() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS page_types_touch ON public.page_types; CREATE TRIGGER page_types_touch BEFORE UPDATE ON public.page_types FOR EACH ROW EXECUTE FUNCTION private.touch_page_types();
CREATE TABLE IF NOT EXISTS public.ad_placements(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, page_type_id uuid NOT NULL, network_id uuid NOT NULL, format_id uuid NOT NULL, slot_key text NOT NULL, enabled boolean NOT NULL DEFAULT false, priority integer NOT NULL DEFAULT 0, frequency_cap integer, isolation_mode text NOT NULL DEFAULT 'no_script_ads', CONSTRAINT ad_placements_pkey PRIMARY KEY(id), CONSTRAINT ad_placements_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_placements_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT ad_placements_page_type_id_tenant_fk FOREIGN KEY(university_id,page_type_id) REFERENCES public.page_types(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_placements_tenant_created_idx ON public.ad_placements(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_placements_creator_idx ON public.ad_placements(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_placements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_placements FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_placements() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_placements_touch ON public.ad_placements; CREATE TRIGGER ad_placements_touch BEFORE UPDATE ON public.ad_placements FOR EACH ROW EXECUTE FUNCTION private.touch_ad_placements();
CREATE TABLE IF NOT EXISTS public.ad_config_versions(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, version integer NOT NULL, config jsonb NOT NULL, CONSTRAINT ad_config_versions_pkey PRIMARY KEY(id), CONSTRAINT ad_config_versions_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_config_versions_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_config_versions_tenant_created_idx ON public.ad_config_versions(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_config_versions_creator_idx ON public.ad_config_versions(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_config_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_config_versions FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_config_versions() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_config_versions_touch ON public.ad_config_versions; CREATE TRIGGER ad_config_versions_touch BEFORE UPDATE ON public.ad_config_versions FOR EACH ROW EXECUTE FUNCTION private.touch_ad_config_versions();
CREATE TABLE IF NOT EXISTS public.ad_kill_switches(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, network_id uuid, is_global boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false, CONSTRAINT ad_kill_switches_pkey PRIMARY KEY(id), CONSTRAINT ad_kill_switches_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_kill_switches_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_kill_switches_tenant_created_idx ON public.ad_kill_switches(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_kill_switches_creator_idx ON public.ad_kill_switches(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_kill_switches ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_kill_switches FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_kill_switches() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_kill_switches_touch ON public.ad_kill_switches; CREATE TRIGGER ad_kill_switches_touch BEFORE UPDATE ON public.ad_kill_switches FOR EACH ROW EXECUTE FUNCTION private.touch_ad_kill_switches();
CREATE TABLE IF NOT EXISTS public.sponsors(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, CONSTRAINT sponsors_pkey PRIMARY KEY(id), CONSTRAINT sponsors_tenant_id_key UNIQUE(university_id,id), CONSTRAINT sponsors_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS sponsors_tenant_created_idx ON public.sponsors(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sponsors_creator_idx ON public.sponsors(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sponsors FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_sponsors() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS sponsors_touch ON public.sponsors; CREATE TRIGGER sponsors_touch BEFORE UPDATE ON public.sponsors FOR EACH ROW EXECUTE FUNCTION private.touch_sponsors();
CREATE TABLE IF NOT EXISTS public.sponsor_creatives(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, sponsor_id uuid NOT NULL, image_url text NOT NULL, target_url text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CONSTRAINT sponsor_creatives_pkey PRIMARY KEY(id), CONSTRAINT sponsor_creatives_tenant_id_key UNIQUE(university_id,id), CONSTRAINT sponsor_creatives_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS sponsor_creatives_tenant_created_idx ON public.sponsor_creatives(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sponsor_creatives_creator_idx ON public.sponsor_creatives(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.sponsor_creatives ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sponsor_creatives FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_sponsor_creatives() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS sponsor_creatives_touch ON public.sponsor_creatives; CREATE TRIGGER sponsor_creatives_touch BEFORE UPDATE ON public.sponsor_creatives FOR EACH ROW EXECUTE FUNCTION private.touch_sponsor_creatives();
CREATE TABLE IF NOT EXISTS public.sponsor_slots(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, creative_id uuid NOT NULL, page_type_id uuid NOT NULL, priority integer NOT NULL DEFAULT 0, CONSTRAINT sponsor_slots_pkey PRIMARY KEY(id), CONSTRAINT sponsor_slots_tenant_id_key UNIQUE(university_id,id), CONSTRAINT sponsor_slots_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS sponsor_slots_tenant_created_idx ON public.sponsor_slots(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sponsor_slots_creator_idx ON public.sponsor_slots(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.sponsor_slots ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sponsor_slots FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_sponsor_slots() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS sponsor_slots_touch ON public.sponsor_slots; CREATE TRIGGER sponsor_slots_touch BEFORE UPDATE ON public.sponsor_slots FOR EACH ROW EXECUTE FUNCTION private.touch_sponsor_slots();
CREATE TABLE IF NOT EXISTS public.page_visits_raw(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, visited_on date NOT NULL, page_type text NOT NULL, entity_type text, entity_id uuid, ta_id uuid, course_id uuid, offering_id uuid, visitor_hash text NOT NULL, CONSTRAINT page_visits_raw_pkey PRIMARY KEY(id), CONSTRAINT page_visits_raw_tenant_id_key UNIQUE(university_id,id), CONSTRAINT page_visits_raw_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS page_visits_raw_tenant_created_idx ON public.page_visits_raw(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS page_visits_raw_creator_idx ON public.page_visits_raw(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.page_visits_raw ENABLE ROW LEVEL SECURITY; ALTER TABLE public.page_visits_raw FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_page_visits_raw() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS page_visits_raw_touch ON public.page_visits_raw; CREATE TRIGGER page_visits_raw_touch BEFORE UPDATE ON public.page_visits_raw FOR EACH ROW EXECUTE FUNCTION private.touch_page_visits_raw();
CREATE TABLE IF NOT EXISTS public.page_visits_daily(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, visited_on date NOT NULL, page_type text NOT NULL, entity_type text, entity_id uuid, unique_visits bigint NOT NULL, CONSTRAINT page_visits_daily_pkey PRIMARY KEY(id), CONSTRAINT page_visits_daily_tenant_id_key UNIQUE(university_id,id), CONSTRAINT page_visits_daily_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS page_visits_daily_tenant_created_idx ON public.page_visits_daily(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS page_visits_daily_creator_idx ON public.page_visits_daily(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.page_visits_daily ENABLE ROW LEVEL SECURITY; ALTER TABLE public.page_visits_daily FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_page_visits_daily() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS page_visits_daily_touch ON public.page_visits_daily; CREATE TRIGGER page_visits_daily_touch BEFORE UPDATE ON public.page_visits_daily FOR EACH ROW EXECUTE FUNCTION private.touch_page_visits_daily();
CREATE TABLE IF NOT EXISTS public.attribution_rules(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, page_type text NOT NULL, entity_type text NOT NULL, attribution text NOT NULL, version integer NOT NULL, effective_from date NOT NULL, CONSTRAINT attribution_rules_pkey PRIMARY KEY(id), CONSTRAINT attribution_rules_tenant_id_key UNIQUE(university_id,id), CONSTRAINT attribution_rules_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS attribution_rules_tenant_created_idx ON public.attribution_rules(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS attribution_rules_creator_idx ON public.attribution_rules(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.attribution_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.attribution_rules FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_attribution_rules() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS attribution_rules_touch ON public.attribution_rules; CREATE TRIGGER attribution_rules_touch BEFORE UPDATE ON public.attribution_rules FOR EACH ROW EXECUTE FUNCTION private.touch_attribution_rules();
CREATE TABLE IF NOT EXISTS public.earnings_entries(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, network_id uuid NOT NULL, month date NOT NULL, amount_minor bigint NOT NULL, currency_code char(3) NOT NULL, statement_reference text NOT NULL, idempotency_key text NOT NULL, CONSTRAINT earnings_entries_pkey PRIMARY KEY(id), CONSTRAINT earnings_entries_tenant_id_key UNIQUE(university_id,id), CONSTRAINT earnings_entries_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS earnings_entries_tenant_created_idx ON public.earnings_entries(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS earnings_entries_creator_idx ON public.earnings_entries(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.earnings_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.earnings_entries FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_earnings_entries() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS earnings_entries_touch ON public.earnings_entries; CREATE TRIGGER earnings_entries_touch BEFORE UPDATE ON public.earnings_entries FOR EACH ROW EXECUTE FUNCTION private.touch_earnings_entries();
CREATE TABLE IF NOT EXISTS public.revenue_share_models(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, model_type text NOT NULL, share_basis_points integer NOT NULL, rate_per_thousand_minor bigint, currency_code char(3) NOT NULL, effective_from date NOT NULL, CONSTRAINT revenue_share_models_pkey PRIMARY KEY(id), CONSTRAINT revenue_share_models_tenant_id_key UNIQUE(university_id,id), CONSTRAINT revenue_share_models_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS revenue_share_models_tenant_created_idx ON public.revenue_share_models(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS revenue_share_models_creator_idx ON public.revenue_share_models(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.revenue_share_models ENABLE ROW LEVEL SECURITY; ALTER TABLE public.revenue_share_models FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_revenue_share_models() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS revenue_share_models_touch ON public.revenue_share_models; CREATE TRIGGER revenue_share_models_touch BEFORE UPDATE ON public.revenue_share_models FOR EACH ROW EXECUTE FUNCTION private.touch_revenue_share_models();
CREATE TABLE IF NOT EXISTS public.revenue_allocations(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, month date NOT NULL, profile_id uuid, platform_amount_minor bigint NOT NULL, ta_amount_minor bigint NOT NULL, currency_code char(3) NOT NULL, model_snapshot jsonb NOT NULL, input_snapshot jsonb NOT NULL, CONSTRAINT revenue_allocations_pkey PRIMARY KEY(id), CONSTRAINT revenue_allocations_tenant_id_key UNIQUE(university_id,id), CONSTRAINT revenue_allocations_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS revenue_allocations_tenant_created_idx ON public.revenue_allocations(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS revenue_allocations_creator_idx ON public.revenue_allocations(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.revenue_allocations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.revenue_allocations FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_revenue_allocations() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS revenue_allocations_touch ON public.revenue_allocations; CREATE TRIGGER revenue_allocations_touch BEFORE UPDATE ON public.revenue_allocations FOR EACH ROW EXECUTE FUNCTION private.touch_revenue_allocations();
CREATE TABLE IF NOT EXISTS public.payout_accounts(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid NOT NULL, method text NOT NULL, account_name text NOT NULL, account_reference_ciphertext text NOT NULL, CONSTRAINT payout_accounts_pkey PRIMARY KEY(id), CONSTRAINT payout_accounts_tenant_id_key UNIQUE(university_id,id), CONSTRAINT payout_accounts_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS payout_accounts_tenant_created_idx ON public.payout_accounts(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payout_accounts_creator_idx ON public.payout_accounts(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.payout_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payout_accounts FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_payout_accounts() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS payout_accounts_touch ON public.payout_accounts; CREATE TRIGGER payout_accounts_touch BEFORE UPDATE ON public.payout_accounts FOR EACH ROW EXECUTE FUNCTION private.touch_payout_accounts();
CREATE TABLE IF NOT EXISTS public.payouts(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid NOT NULL, amount_minor bigint NOT NULL, currency_code char(3) NOT NULL, status text NOT NULL DEFAULT 'pending', proof_reference text, CONSTRAINT payouts_pkey PRIMARY KEY(id), CONSTRAINT payouts_tenant_id_key UNIQUE(university_id,id), CONSTRAINT payouts_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS payouts_tenant_created_idx ON public.payouts(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payouts_creator_idx ON public.payouts(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payouts FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_payouts() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS payouts_touch ON public.payouts; CREATE TRIGGER payouts_touch BEFORE UPDATE ON public.payouts FOR EACH ROW EXECUTE FUNCTION private.touch_payouts();
CREATE TABLE IF NOT EXISTS public.payout_events(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, payout_id uuid NOT NULL, actor_id uuid NOT NULL, event_type text NOT NULL, CONSTRAINT payout_events_pkey PRIMARY KEY(id), CONSTRAINT payout_events_tenant_id_key UNIQUE(university_id,id), CONSTRAINT payout_events_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT payout_events_payout_id_tenant_fk FOREIGN KEY(university_id,payout_id) REFERENCES public.payouts(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS payout_events_tenant_created_idx ON public.payout_events(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payout_events_creator_idx ON public.payout_events(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.payout_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payout_events FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_payout_events() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS payout_events_touch ON public.payout_events; CREATE TRIGGER payout_events_touch BEFORE UPDATE ON public.payout_events FOR EACH ROW EXECUTE FUNCTION private.touch_payout_events();
CREATE TABLE IF NOT EXISTS public.ad_impressions(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, placement_id uuid NOT NULL, creative_id uuid, event_type text NOT NULL, occurred_at timestamptz NOT NULL, visitor_hash text, CONSTRAINT ad_impressions_pkey PRIMARY KEY(id), CONSTRAINT ad_impressions_tenant_id_key UNIQUE(university_id,id), CONSTRAINT ad_impressions_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS ad_impressions_tenant_created_idx ON public.ad_impressions(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ad_impressions_creator_idx ON public.ad_impressions(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ad_impressions FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_ad_impressions() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ad_impressions_touch ON public.ad_impressions; CREATE TRIGGER ad_impressions_touch BEFORE UPDATE ON public.ad_impressions FOR EACH ROW EXECUTE FUNCTION private.touch_ad_impressions();
CREATE TABLE IF NOT EXISTS public.consent_records(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, profile_id uuid, anonymous_key_hash text, policy_version text NOT NULL, categories jsonb NOT NULL, CONSTRAINT consent_records_pkey PRIMARY KEY(id), CONSTRAINT consent_records_tenant_id_key UNIQUE(university_id,id), CONSTRAINT consent_records_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS consent_records_tenant_created_idx ON public.consent_records(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS consent_records_creator_idx ON public.consent_records(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY; ALTER TABLE public.consent_records FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_consent_records() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS consent_records_touch ON public.consent_records; CREATE TRIGGER consent_records_touch BEFORE UPDATE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION private.touch_consent_records();

-- ----------------------------------------------------------------------------
-- SECTION 2: T-B002 constraints (documented deviations D-B2-b/c/d)
-- ----------------------------------------------------------------------------

-- D-B2-b: auth page types can never be enabled (R3).
ALTER TABLE public.page_types DROP CONSTRAINT IF EXISTS page_types_auth_disabled_check;
ALTER TABLE public.page_types ADD CONSTRAINT page_types_auth_disabled_check CHECK (NOT (is_auth AND enabled));

-- D-B2-c: kill switch shape + uniqueness (precedence: flag > global > network).
ALTER TABLE public.ad_kill_switches DROP CONSTRAINT IF EXISTS ad_kill_switches_shape_check;
ALTER TABLE public.ad_kill_switches ADD CONSTRAINT ad_kill_switches_shape_check CHECK ((is_global AND network_id IS NULL) OR (NOT is_global AND network_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS ad_kill_switches_global_uniq ON public.ad_kill_switches(university_id) WHERE is_global;
CREATE UNIQUE INDEX IF NOT EXISTS ad_kill_switches_network_uniq ON public.ad_kill_switches(university_id, network_id) WHERE NOT is_global;

-- D-B2-d: immutable config versions (rollback publishes an old config anew).
CREATE UNIQUE INDEX IF NOT EXISTS ad_config_versions_tenant_version_uniq ON public.ad_config_versions(university_id, version);
REVOKE UPDATE, DELETE ON public.ad_config_versions FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3: RLS baseline (verbatim from docs/03-database/rls/monetization.sql;
-- helper definitions skipped — already installed with the T-A003 correction)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS ad_networks_tenant_access ON public.ad_networks;
CREATE POLICY ad_networks_tenant_access ON public.ad_networks FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_networks FROM anon;
DROP POLICY IF EXISTS ad_formats_tenant_access ON public.ad_formats;
CREATE POLICY ad_formats_tenant_access ON public.ad_formats FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_formats FROM anon;
DROP POLICY IF EXISTS page_types_tenant_access ON public.page_types;
CREATE POLICY page_types_tenant_access ON public.page_types FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.page_types FROM anon;
DROP POLICY IF EXISTS ad_placements_tenant_access ON public.ad_placements;
CREATE POLICY ad_placements_tenant_access ON public.ad_placements FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_placements FROM anon;
DROP POLICY IF EXISTS ad_config_versions_tenant_access ON public.ad_config_versions;
CREATE POLICY ad_config_versions_tenant_access ON public.ad_config_versions FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_config_versions FROM anon;
DROP POLICY IF EXISTS ad_kill_switches_tenant_access ON public.ad_kill_switches;
CREATE POLICY ad_kill_switches_tenant_access ON public.ad_kill_switches FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_kill_switches FROM anon;
DROP POLICY IF EXISTS sponsors_tenant_access ON public.sponsors;
CREATE POLICY sponsors_tenant_access ON public.sponsors FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.sponsors FROM anon;
DROP POLICY IF EXISTS sponsor_creatives_tenant_access ON public.sponsor_creatives;
CREATE POLICY sponsor_creatives_tenant_access ON public.sponsor_creatives FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.sponsor_creatives FROM anon;
DROP POLICY IF EXISTS sponsor_slots_tenant_access ON public.sponsor_slots;
CREATE POLICY sponsor_slots_tenant_access ON public.sponsor_slots FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.sponsor_slots FROM anon;
DROP POLICY IF EXISTS page_visits_raw_tenant_access ON public.page_visits_raw;
CREATE POLICY page_visits_raw_tenant_access ON public.page_visits_raw FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.page_visits_raw FROM anon;
DROP POLICY IF EXISTS page_visits_daily_tenant_access ON public.page_visits_daily;
CREATE POLICY page_visits_daily_tenant_access ON public.page_visits_daily FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.page_visits_daily FROM anon;
DROP POLICY IF EXISTS attribution_rules_tenant_access ON public.attribution_rules;
CREATE POLICY attribution_rules_tenant_access ON public.attribution_rules FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.attribution_rules FROM anon;
DROP POLICY IF EXISTS earnings_entries_tenant_access ON public.earnings_entries;
CREATE POLICY earnings_entries_tenant_access ON public.earnings_entries FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.earnings_entries FROM anon;
DROP POLICY IF EXISTS revenue_share_models_tenant_access ON public.revenue_share_models;
CREATE POLICY revenue_share_models_tenant_access ON public.revenue_share_models FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.revenue_share_models FROM anon;
DROP POLICY IF EXISTS revenue_allocations_tenant_access ON public.revenue_allocations;
CREATE POLICY revenue_allocations_tenant_access ON public.revenue_allocations FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.revenue_allocations FROM anon;
REVOKE UPDATE,DELETE ON public.revenue_allocations FROM anon,authenticated;
DROP POLICY IF EXISTS payout_accounts_tenant_access ON public.payout_accounts;
CREATE POLICY payout_accounts_tenant_access ON public.payout_accounts FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.payout_accounts FROM anon;
DROP POLICY IF EXISTS payouts_tenant_access ON public.payouts;
CREATE POLICY payouts_tenant_access ON public.payouts FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.payouts FROM anon;
DROP POLICY IF EXISTS payout_events_tenant_access ON public.payout_events;
CREATE POLICY payout_events_tenant_access ON public.payout_events FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.payout_events FROM anon;
REVOKE UPDATE,DELETE ON public.payout_events FROM anon,authenticated;
DROP POLICY IF EXISTS ad_impressions_tenant_access ON public.ad_impressions;
CREATE POLICY ad_impressions_tenant_access ON public.ad_impressions FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.ad_impressions FROM anon;
DROP POLICY IF EXISTS consent_records_tenant_access ON public.consent_records;
CREATE POLICY consent_records_tenant_access ON public.consent_records FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.consent_records FROM anon;
-- Add narrow per-operation student/staff policies only after identity and role fixtures are defined; no client receives service_role.
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- SECTION 4: resolver config RPCs (T-B002, registry delta)
-- ----------------------------------------------------------------------------

-- Live registry assembly. Sanitized: keys only, no ids/created_by; auth page
-- types and placements on them are excluded (R3 defense in depth).
CREATE OR REPLACE FUNCTION private.build_ad_config(p_university_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'page_types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', pt.key, 'is_auth', pt.is_auth, 'enabled', pt.enabled) ORDER BY pt.key)
      FROM public.page_types pt
      WHERE pt.university_id = p_university_id AND NOT pt.is_auth
    ), '[]'::jsonb),
    'formats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', f.key, 'is_pop_style', f.is_pop_style, 'needs_consent', f.needs_consent, 'injection_mode', f.injection_mode) ORDER BY f.key)
      FROM public.ad_formats f
      WHERE f.university_id = p_university_id
    ), '[]'::jsonb),
    'networks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', n.key, 'name', n.name, 'enabled', n.enabled) ORDER BY n.key)
      FROM public.ad_networks n
      WHERE n.university_id = p_university_id
    ), '[]'::jsonb),
    'placements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slot_key', pl.slot_key,
        'page_type', pt.key,
        'network', n.key,
        'format', f.key,
        'enabled', pl.enabled,
        'priority', pl.priority,
        'frequency_cap', pl.frequency_cap,
        'isolation_mode', pl.isolation_mode
      ) ORDER BY pl.priority DESC, pl.slot_key, n.key, f.key)
      FROM public.ad_placements pl
      JOIN public.page_types pt ON pt.university_id = pl.university_id AND pt.id = pl.page_type_id
      JOIN public.ad_networks n ON n.university_id = pl.university_id AND n.id = pl.network_id
      JOIN public.ad_formats f ON f.university_id = pl.university_id AND f.id = pl.format_id
      WHERE pl.university_id = p_university_id AND NOT pt.is_auth
    ), '[]'::jsonb)
  )
$$;

-- Active config = highest published version; falls back to the live registry
-- assembly while no version has been published (admin publish ships with the
-- admin slice; visit/revenue tables stay dark).
CREATE OR REPLACE FUNCTION private.ad_config_snapshot(p_university_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
  v_config jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.universities u WHERE u.id = p_university_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT v.version, v.config INTO v_version, v_config
  FROM public.ad_config_versions v
  WHERE v.university_id = p_university_id
  ORDER BY v.version DESC
  LIMIT 1;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('source', 'live', 'version', 0)
      || private.build_ad_config(p_university_id);
  END IF;

  RETURN jsonb_build_object('source', 'version', 'version', v_version) || v_config;
END;
$$;

-- Emergency layer state: whitelisted ads.* flags + kill switch rows. Absent
-- flag rows fail closed (enabled=false, global_kill=true — ads stay dark
-- until configured). Precedence: global_kill flag > global row > network rows.
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

-- ----------------------------------------------------------------------------
-- SECTION 5: grants and public wrappers (D-B2-e: definer wrappers — anon has
-- no USAGE on schema private; only these two reads are exposed)
-- ----------------------------------------------------------------------------

-- Private functions stay internal: PUBLIC execute revoked (the definer
-- wrappers below run as the owner, so they are unaffected).
REVOKE EXECUTE ON FUNCTION private.build_ad_config(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.ad_config_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.ad_kill_state(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ad_config_snapshot(p_university_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT private.ad_config_snapshot(p_university_id) $$;
CREATE OR REPLACE FUNCTION public.ad_kill_state(p_university_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT private.ad_kill_state(p_university_id) $$;

GRANT EXECUTE ON FUNCTION public.ad_config_snapshot(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_kill_state(uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ad_config_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ad_kill_state(uuid) FROM PUBLIC;
