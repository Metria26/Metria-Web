-- ============================================================================
-- T-A006: evaluation booking base — periods, slots, bookings, capacity,
-- cancel/cutoff (features 3.1, 3.2)
-- Lane: a  Module: evaluation_booking
--
-- Depends on: 20261014140937_s_foundation_auth, 20261014213000_s_auth_domain_allowlist,
--             20261015141145_a_core_academics (helpers is_enrolled/is_offering_staff),
--             20261015190000_a_marks_import (profiles_self_read),
--             20261016120000_a_announcements_dashboard.
--
-- Adds:
--   1. Booking tables copied from docs/03-database/schema/evaluation-booking.sql
--      (evaluation_periods, slots, bookings, waitlist_entries, swap_requests).
--      Waitlist/swap stay dark for T-A007: the feature flags
--      booking.waitlist.enabled / booking.social.enabled are false (seed) and
--      those two tables keep only the platform-admin baseline policy.
--   2. P19 correctness: one ACTIVE booking per period per student (partial unique
--      index) and capacity enforced by private.book_slot under a FOR UPDATE
--      period-row lock plus a BEFORE INSERT/UPDATE safety trigger on bookings
--      (brief: "capacity enforced by RPC with locking plus a safety trigger").
--   3. Narrow RLS: offering staff (booking.manage_period) manage periods/slots;
--      enrolled students read their section's periods/slots and their own
--      bookings; offering staff read every booking of their offerings
--      (feature 3.1: "student sees own bookings; TA sees all bookings").
--   4. RPCs private.book_slot / private.cancel_booking /
--      private.period_booking_overview (+ public wrappers, D-k transport).
--   5. private.student_dashboard() replaced (same signature/JSON keys):
--      evaluation_slots is now populated (T-A005 shipped the [] placeholder,
--      expand-only).
--
-- Deviations from the docs sources:
--   D-A6-a  bookings: the docs DDL UNIQUE(university_id,period_id,student_id) is
--           unconditional; replaced by a partial unique index WHERE status='active'
--           so cancelling frees the student to rebook (3.2) while concurrent
--           one-active-booking-per-period still holds (P19).
--   D-A6-b  bookings.status CHECK ('active','cancelled','completed') per the
--           SYMBOL_REGISTRY status list (docs DDL carried no CHECK).
--   D-A6-c  bookings(university_id,period_id) tenant FK to evaluation_periods
--           added — the docs DDL omitted it (tenant composite FK rule).
--   D-A6-d  private.book_slot body hardened vs the docs body: active-membership
--           check ('forbidden'), enrollment via is_enrolled ('forbidden'), slot
--           belongs-to-period validation ('not_found', the docs body could NPE
--           into a partial insert), ended-slot guard ('slot_ended'), unique
--           violation mapped to 'already_booked', created_by set to the booking
--           student (audit). The period-row lock, capacity check ('slot_full')
--           and uuid return are kept.
--   D-A6-e  private.cancel_booking implemented (registered in SYMBOL_REGISTRY,
--           no docs body): owner-only, active-only, per-period cutoff measured
--           against the slot start (D11, default 6h, TA-configurable per period).
--   D-A6-f  Narrow policies replace the docs platform-admin-only baseline for
--           periods/slots/bookings; waitlist/swap keep the baseline untouched.
--   D-A6-g  private.period_booking_overview added (registry delta recorded):
--           availability counts are computed definer-side because students must
--           not read peer booking rows ("peer visibility" is T-A007, flags off);
--           offering staff additionally see booked student names, never emails.
--           Errors use the stable API codes ('not_found' for non-participants).
--   D-A6-h  private.student_dashboard() body replaced; signature and return keys
--           unchanged (expand-only per the T-A005 comment).
--
-- Rollback: expand/contract only after consumers stop reading; bookings are
-- append-only business records (cancel is a status, never a delete).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ----------------------------------------------------------------------------
-- SECTION 1: tables (docs schema verbatim except the documented deviations)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.evaluation_periods(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, offering_id uuid NOT NULL, section_id uuid NOT NULL, title text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, cutoff_hours integer NOT NULL DEFAULT 6, allow_swaps boolean NOT NULL DEFAULT false, CONSTRAINT evaluation_periods_pkey PRIMARY KEY(id), CONSTRAINT evaluation_periods_tenant_id_key UNIQUE(university_id,id), CONSTRAINT evaluation_periods_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT evaluation_periods_offering_id_tenant_fk FOREIGN KEY(university_id,offering_id) REFERENCES public.course_offerings(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS evaluation_periods_tenant_created_idx ON public.evaluation_periods(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_periods_creator_idx ON public.evaluation_periods(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.evaluation_periods ENABLE ROW LEVEL SECURITY; ALTER TABLE public.evaluation_periods FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_evaluation_periods() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS evaluation_periods_touch ON public.evaluation_periods; CREATE TRIGGER evaluation_periods_touch BEFORE UPDATE ON public.evaluation_periods FOR EACH ROW EXECUTE FUNCTION private.touch_evaluation_periods();

CREATE TABLE IF NOT EXISTS public.slots(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, period_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, capacity integer NOT NULL CHECK(capacity>0), location text, CONSTRAINT slots_pkey PRIMARY KEY(id), CONSTRAINT slots_tenant_id_key UNIQUE(university_id,id), CONSTRAINT slots_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT slots_period_id_tenant_fk FOREIGN KEY(university_id,period_id) REFERENCES public.evaluation_periods(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS slots_tenant_created_idx ON public.slots(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS slots_creator_idx ON public.slots(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY; ALTER TABLE public.slots FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_slots() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS slots_touch ON public.slots; CREATE TRIGGER slots_touch BEFORE UPDATE ON public.slots FOR EACH ROW EXECUTE FUNCTION private.touch_slots();

-- D-A6-a/b/c applied here: no unconditional UNIQUE, status CHECK, tenant FK to
-- evaluation_periods, partial unique index for the ACTIVE booking.
CREATE TABLE IF NOT EXISTS public.bookings(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, period_id uuid NOT NULL, slot_id uuid NOT NULL, student_id uuid NOT NULL, status text NOT NULL DEFAULT 'active', CONSTRAINT bookings_pkey PRIMARY KEY(id), CONSTRAINT bookings_tenant_id_key UNIQUE(university_id,id), CONSTRAINT bookings_status_check CHECK(status IN ('active','cancelled','completed')), CONSTRAINT bookings_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT bookings_period_id_tenant_fk FOREIGN KEY(university_id,period_id) REFERENCES public.evaluation_periods(university_id,id) ON DELETE RESTRICT, CONSTRAINT bookings_slot_id_tenant_fk FOREIGN KEY(university_id,slot_id) REFERENCES public.slots(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS bookings_tenant_created_idx ON public.bookings(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_creator_idx ON public.bookings(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_period_student_uniq ON public.bookings(university_id,period_id,student_id) WHERE status = 'active';
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_bookings() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS bookings_touch ON public.bookings; CREATE TRIGGER bookings_touch BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.touch_bookings();

CREATE TABLE IF NOT EXISTS public.waitlist_entries(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, slot_id uuid NOT NULL, student_id uuid NOT NULL, position integer NOT NULL, status text NOT NULL DEFAULT 'waiting', CONSTRAINT waitlist_entries_pkey PRIMARY KEY(id), CONSTRAINT waitlist_entries_tenant_id_key UNIQUE(university_id,id), CONSTRAINT waitlist_entries_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS waitlist_entries_tenant_created_idx ON public.waitlist_entries(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS waitlist_entries_creator_idx ON public.waitlist_entries(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.waitlist_entries FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_waitlist_entries() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS waitlist_entries_touch ON public.waitlist_entries; CREATE TRIGGER waitlist_entries_touch BEFORE UPDATE ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION private.touch_waitlist_entries();

CREATE TABLE IF NOT EXISTS public.swap_requests(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, from_booking_id uuid NOT NULL, to_booking_id uuid NOT NULL, requested_by uuid NOT NULL, accepted_by uuid, status text NOT NULL DEFAULT 'pending', CONSTRAINT swap_requests_pkey PRIMARY KEY(id), CONSTRAINT swap_requests_tenant_id_key UNIQUE(university_id,id), CONSTRAINT swap_requests_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS swap_requests_tenant_created_idx ON public.swap_requests(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS swap_requests_creator_idx ON public.swap_requests(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE public.swap_requests FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_swap_requests() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS swap_requests_touch ON public.swap_requests; CREATE TRIGGER swap_requests_touch BEFORE UPDATE ON public.swap_requests FOR EACH ROW EXECUTE FUNCTION private.touch_swap_requests();

-- ----------------------------------------------------------------------------
-- SECTION 2: capacity safety trigger (P19, brief 4.3)
-- ----------------------------------------------------------------------------
-- The RPC's FOR UPDATE period lock is the real serializer for concurrent
-- bookers; this trigger is defense-in-depth for any write path that bypasses
-- the RPC (admin tooling, future RPCs). It also validates the slot exists in
-- the same tenant. Raises the stable codes 'slot_full' / 'not_found'.

CREATE OR REPLACE FUNCTION private.enforce_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_capacity integer;
  v_active integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT s.capacity INTO v_capacity
  FROM public.slots s
  WHERE s.university_id = NEW.university_id AND s.id = NEW.slot_id;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  SELECT count(*) INTO v_active
  FROM public.bookings b
  WHERE b.university_id = NEW.university_id
    AND b.slot_id = NEW.slot_id
    AND b.status = 'active'
    AND (TG_OP = 'INSERT' OR b.id <> NEW.id);
  IF v_active >= v_capacity THEN
    RAISE EXCEPTION 'slot_full';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_capacity ON public.bookings;
CREATE TRIGGER bookings_capacity BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.enforce_slot_capacity();

-- ----------------------------------------------------------------------------
-- SECTION 3: narrow RLS (D-A6-f; replaces the docs platform-admin-only baseline)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS evaluation_periods_tenant_access ON public.evaluation_periods;
DROP POLICY IF EXISTS evaluation_periods_platform_admin ON public.evaluation_periods;
CREATE POLICY evaluation_periods_platform_admin ON public.evaluation_periods FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

-- Staff of the offering read every period of the offering; enrolled students
-- read the periods of their own sections.
DROP POLICY IF EXISTS evaluation_periods_read ON public.evaluation_periods;
CREATE POLICY evaluation_periods_read ON public.evaluation_periods FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offering_staff os
      WHERE os.university_id = evaluation_periods.university_id
        AND os.offering_id = evaluation_periods.offering_id
        AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
    )
    OR private.is_enrolled(evaluation_periods.section_id)
  );

-- Staff create periods for an offering they staff, holding booking.manage_period,
-- authoring the row as themselves (created_by spoofing denied).
DROP POLICY IF EXISTS evaluation_periods_staff_insert ON public.evaluation_periods;
CREATE POLICY evaluation_periods_staff_insert ON public.evaluation_periods FOR INSERT TO authenticated
  WITH CHECK (
    private.is_platform_admin()
    OR (
      created_by = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      AND private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.offering_staff os
        WHERE os.university_id = evaluation_periods.university_id
          AND os.offering_id = evaluation_periods.offering_id
          AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      )
    )
  );

-- Any staff member of the offering with the permission may adjust or remove a
-- period (periods are team resources, not author-owned).
DROP POLICY IF EXISTS evaluation_periods_staff_update ON public.evaluation_periods;
CREATE POLICY evaluation_periods_staff_update ON public.evaluation_periods FOR UPDATE TO authenticated
  USING (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.offering_staff os
        WHERE os.university_id = evaluation_periods.university_id
          AND os.offering_id = evaluation_periods.offering_id
          AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      )
    )
  )
  WITH CHECK (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.offering_staff os
        WHERE os.university_id = evaluation_periods.university_id
          AND os.offering_id = evaluation_periods.offering_id
          AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      )
    )
  );

DROP POLICY IF EXISTS evaluation_periods_staff_delete ON public.evaluation_periods;
CREATE POLICY evaluation_periods_staff_delete ON public.evaluation_periods FOR DELETE TO authenticated
  USING (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.offering_staff os
        WHERE os.university_id = evaluation_periods.university_id
          AND os.offering_id = evaluation_periods.offering_id
          AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      )
    )
  );

REVOKE ALL ON public.evaluation_periods FROM anon;

DROP POLICY IF EXISTS slots_tenant_access ON public.slots;
DROP POLICY IF EXISTS slots_platform_admin ON public.slots;
CREATE POLICY slots_platform_admin ON public.slots FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

-- Staff of the parent period's offering read; students enrolled in the parent
-- period's section read.
DROP POLICY IF EXISTS slots_read ON public.slots;
CREATE POLICY slots_read ON public.slots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evaluation_periods ep
      JOIN public.offering_staff os
        ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
    )
    OR EXISTS (
      SELECT 1 FROM public.evaluation_periods ep
      WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
        AND private.is_enrolled(ep.section_id)
    )
  );

DROP POLICY IF EXISTS slots_staff_insert ON public.slots;
CREATE POLICY slots_staff_insert ON public.slots FOR INSERT TO authenticated
  WITH CHECK (
    private.is_platform_admin()
    OR (
      created_by = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      AND private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.evaluation_periods ep
        JOIN public.offering_staff os
          ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
         AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
        WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
      )
    )
  );

DROP POLICY IF EXISTS slots_staff_update ON public.slots;
CREATE POLICY slots_staff_update ON public.slots FOR UPDATE TO authenticated
  USING (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.evaluation_periods ep
        JOIN public.offering_staff os
          ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
         AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
        WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
      )
    )
  )
  WITH CHECK (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.evaluation_periods ep
        JOIN public.offering_staff os
          ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
         AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
        WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
      )
    )
  );

DROP POLICY IF EXISTS slots_staff_delete ON public.slots;
CREATE POLICY slots_staff_delete ON public.slots FOR DELETE TO authenticated
  USING (
    private.is_platform_admin()
    OR (
      private.has_permission(university_id, 'booking.manage_period')
      AND EXISTS (
        SELECT 1 FROM public.evaluation_periods ep
        JOIN public.offering_staff os
          ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
         AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
        WHERE ep.university_id = slots.university_id AND ep.id = slots.period_id
      )
    )
  );

REVOKE ALL ON public.slots FROM anon;

DROP POLICY IF EXISTS bookings_tenant_access ON public.bookings;
DROP POLICY IF EXISTS bookings_platform_admin ON public.bookings;
CREATE POLICY bookings_platform_admin ON public.bookings FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

-- Students read their own bookings; offering staff read every booking of their
-- offerings (feature 3.1 "TA sees all bookings"). No member INSERT/UPDATE/DELETE
-- policy exists — writes happen only through the definer RPCs below.
DROP POLICY IF EXISTS bookings_own_read ON public.bookings;
CREATE POLICY bookings_own_read ON public.bookings FOR SELECT TO authenticated
  USING (
    student_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS bookings_staff_read ON public.bookings;
CREATE POLICY bookings_staff_read ON public.bookings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evaluation_periods ep
      JOIN public.offering_staff os
        ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE ep.university_id = bookings.university_id AND ep.id = bookings.period_id
    )
  );

REVOKE ALL ON public.bookings FROM anon;

-- Waitlist/swap keep the docs platform-admin-only baseline (dark until T-A007).
DROP POLICY IF EXISTS waitlist_entries_tenant_access ON public.waitlist_entries;
CREATE POLICY waitlist_entries_tenant_access ON public.waitlist_entries FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.waitlist_entries FROM anon;

DROP POLICY IF EXISTS swap_requests_tenant_access ON public.swap_requests;
CREATE POLICY swap_requests_tenant_access ON public.swap_requests FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.swap_requests FROM anon;

-- ----------------------------------------------------------------------------
-- SECTION 4: RPCs (D-A6-d/e/g; docs functions file is the base for book_slot)
-- ----------------------------------------------------------------------------
-- Security-definer RPCs set search_path to empty, validate auth.uid(), verify
-- tenant and role, and are granted narrowly. Errors raise the stable API codes
-- from docs/04-backend/api-contracts.md.

CREATE OR REPLACE FUNCTION private.book_slot(p_university_id uuid, p_period_id uuid, p_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_section_id uuid;
  v_slot_ends timestamptz;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id
      AND m.profile_id = v_profile_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Serialize every booking attempt on the period row (P19): concurrent
  -- bookers into the same period (and therefore the same slots) queue here.
  SELECT ep.section_id INTO v_section_id
  FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF NOT private.is_enrolled(v_section_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT s.ends_at INTO v_slot_ends
  FROM public.slots s
  WHERE s.university_id = p_university_id
    AND s.id = p_slot_id
    AND s.period_id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_slot_ends <= now() THEN
    RAISE EXCEPTION 'slot_ended';
  END IF;

  IF (
    SELECT count(*) FROM public.bookings b
    WHERE b.university_id = p_university_id
      AND b.slot_id = p_slot_id
      AND b.status = 'active'
  ) >= (
    SELECT s.capacity FROM public.slots s
    WHERE s.university_id = p_university_id AND s.id = p_slot_id
  ) THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  BEGIN
    INSERT INTO public.bookings (university_id, period_id, slot_id, student_id, created_by)
    VALUES (p_university_id, p_period_id, p_slot_id, v_profile_id, v_profile_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.cancel_booking(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_booking public.bookings%ROWTYPE;
  v_cutoff_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_booking.student_id <> v_profile_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_booking.status <> 'active' THEN
    RAISE EXCEPTION 'not_active';
  END IF;

  -- D11: cancellation closes cutoff_hours before the slot starts (default 6,
  -- TA-configurable per period; a stricter TA value is simply a larger number).
  SELECT s.starts_at - make_interval(hours => ep.cutoff_hours) INTO v_cutoff_at
  FROM public.slots s
  JOIN public.evaluation_periods ep
    ON ep.university_id = s.university_id AND ep.id = s.period_id
  WHERE s.university_id = v_booking.university_id AND s.id = v_booking.slot_id;
  IF v_cutoff_at IS NULL OR now() >= v_cutoff_at THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  UPDATE public.bookings SET status = 'cancelled'
  WHERE id = p_booking_id AND status = 'active';

  RETURN p_booking_id;
END $$;

-- Period detail for the owning student (availability counts only + own booking)
-- and for offering staff (adds booked student names; never emails). Non-
-- participants get 'not_found' so identifiers leak nothing.
CREATE OR REPLACE FUNCTION private.period_booking_overview(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_is_staff boolean := false;
  v_can_manage boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT ep.* INTO v_period
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_is_staff := private.is_offering_staff(v_period.offering_id);
  v_can_manage := private.is_platform_admin()
    OR (v_is_staff AND private.has_permission(v_period.university_id, 'booking.manage_period'));

  IF NOT (v_can_manage OR v_is_staff OR private.is_enrolled(v_period.section_id)) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'period', (
      SELECT jsonb_build_object(
        'id', ep.id,
        'title', ep.title,
        'offering_id', ep.offering_id,
        'section_id', ep.section_id,
        'starts_at', ep.starts_at,
        'ends_at', ep.ends_at,
        'cutoff_hours', ep.cutoff_hours,
        'offering_code', o.offering_code,
        'course_code', c.code,
        'section_code', s.section_code
      )
      FROM public.evaluation_periods ep
      JOIN public.sections s
        ON s.university_id = ep.university_id AND s.id = ep.section_id
      JOIN public.course_offerings o
        ON o.university_id = ep.university_id AND o.id = ep.offering_id
      JOIN public.courses c
        ON c.university_id = o.university_id AND c.id = o.course_id
      WHERE ep.id = v_period.id
    ),
    'can_manage', v_can_manage,
    'slots', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'starts_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'id', sl.id,
          'starts_at', sl.starts_at,
          'ends_at', sl.ends_at,
          'capacity', sl.capacity,
          'location', sl.location,
          'booked', (
            SELECT count(*) FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.status = 'active'
          ),
          'my_booking_id', (
            SELECT b.id FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.student_id = v_profile_id
              AND b.status = 'active'
            LIMIT 1
          )
        ) AS row_json
        FROM public.slots sl
        WHERE sl.university_id = v_period.university_id
          AND sl.period_id = v_period.id
      ) slot_rows
    ), '[]'::jsonb),
    'students', CASE WHEN v_is_staff THEN COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'slot_starts_at' ASC, row_json->>'student_name' ASC)
      FROM (
        SELECT jsonb_build_object(
          'slot_id', b.slot_id,
          'slot_starts_at', sl.starts_at,
          'student_name', pr.display_name,
          'status', b.status
        ) AS row_json
        FROM public.bookings b
        JOIN public.slots sl
          ON sl.university_id = b.university_id AND sl.id = b.slot_id
        JOIN public.profiles pr
          ON pr.id = b.student_id
        WHERE b.university_id = v_period.university_id
          AND b.period_id = v_period.id
      ) booking_rows
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 5: student_dashboard() — evaluation_slots now live (D-A6-h)
-- ----------------------------------------------------------------------------
-- Body copied from 20261016120000_a_announcements_dashboard.sql with the
-- evaluation_slots placeholder replaced; signature, keys and limits unchanged.

CREATE OR REPLACE FUNCTION private.student_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_result jsonb;
BEGIN
  SELECT p.id, p.university_id INTO v_profile_id, v_uni
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());

  IF v_profile_id IS NULL OR v_uni IS NULL THEN
    RAISE EXCEPTION 'profile not provisioned' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'latest_marks', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'recorded_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'assessment_title', a.title,
          'assessment_type', a.assessment_type,
          'course_code', c.code,
          'course_title', c.title,
          'offering_id', o.id,
          'score', m.score,
          'total', a.total,
          'recorded_at', m.updated_at
        ) AS row_json
        FROM public.marks m
        JOIN public.assessments a
          ON a.university_id = m.university_id AND a.id = m.assessment_id
        JOIN public.course_offerings o
          ON o.university_id = a.university_id AND o.id = a.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE m.university_id = v_uni
          AND m.student_id = v_profile_id
          AND a.visibility = 'students'
          AND m.score IS NOT NULL
        ORDER BY m.updated_at DESC
        LIMIT 5
      ) marks_rows
    ), '[]'::jsonb),
    'announcements', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', an.id,
          'title', an.title,
          'body_html', an.body_html,
          'section_code', s.section_code,
          'course_code', c.code,
          'offering_id', s.offering_id,
          'created_at', an.created_at
        ) AS row_json
        FROM public.announcements an
        JOIN public.sections s
          ON s.university_id = an.university_id AND s.id = an.section_id
        JOIN public.course_offerings o
          ON o.university_id = s.university_id AND o.id = s.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE an.university_id = v_uni
          AND EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.university_id = v_uni
              AND e.section_id = an.section_id
              AND e.profile_id = v_profile_id
              AND e.status = 'active'
          )
        ORDER BY an.created_at DESC
        LIMIT 5
      ) announcement_rows
    ), '[]'::jsonb),
    'upcoming_assessments', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'assessment_type', a.assessment_type,
          'total', a.total,
          'weight', a.weight,
          'course_code', c.code,
          'offering_id', o.id,
          'created_at', a.created_at
        ) AS row_json
        FROM public.assessments a
        JOIN public.course_offerings o
          ON o.university_id = a.university_id AND o.id = a.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE a.university_id = v_uni
          AND a.visibility = 'students'
          AND a.id NOT IN (
            SELECT m.assessment_id FROM public.marks m
            WHERE m.university_id = v_uni AND m.student_id = v_profile_id
          )
          AND EXISTS (
            SELECT 1 FROM public.enrollments e
            JOIN public.sections s
              ON s.university_id = e.university_id AND s.id = e.section_id
            WHERE e.university_id = v_uni
              AND e.profile_id = v_profile_id
              AND e.status = 'active'
              AND s.offering_id = o.id
          )
        ORDER BY a.created_at ASC
        LIMIT 5
      ) assessment_rows
    ), '[]'::jsonb),
    -- T-A006: upcoming slots of the student's enrolled sections (expand-only
    -- from the T-A005 [] placeholder). Availability count + own active booking.
    'evaluation_slots', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'starts_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'period_id', ep.id,
          'period_title', ep.title,
          'slot_id', sl.id,
          'course_code', c.code,
          'offering_id', ep.offering_id,
          'starts_at', sl.starts_at,
          'ends_at', sl.ends_at,
          'location', sl.location,
          'capacity', sl.capacity,
          'booked', (
            SELECT count(*) FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.status = 'active'
          ),
          'cutoff_hours', ep.cutoff_hours,
          'my_booking_id', (
            SELECT b.id FROM public.bookings b
            WHERE b.university_id = sl.university_id
              AND b.slot_id = sl.id
              AND b.student_id = v_profile_id
              AND b.status = 'active'
            LIMIT 1
          )
        ) AS row_json
        FROM public.evaluation_periods ep
        JOIN public.sections s
          ON s.university_id = ep.university_id AND s.id = ep.section_id
        JOIN public.course_offerings o
          ON o.university_id = ep.university_id AND o.id = ep.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        JOIN public.slots sl
          ON sl.university_id = ep.university_id AND sl.period_id = ep.id
        WHERE ep.university_id = v_uni
          AND EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.university_id = v_uni
              AND e.section_id = ep.section_id
              AND e.profile_id = v_profile_id
              AND e.status = 'active'
          )
          AND sl.ends_at > now()
        ORDER BY sl.starts_at ASC
        LIMIT 5
      ) slot_rows
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION private.student_dashboard() TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 6: grants and public wrappers (D-f grants, D-k transport)
-- ----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION private.book_slot(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cancel_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.period_booking_overview(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.book_slot(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.cancel_booking(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.period_booking_overview(uuid) FROM anon;

-- D-k: public wrappers are what PostgREST actually routes (default profile).
-- SECURITY INVOKER: the caller already holds private USAGE + EXECUTE (grants
-- above), so the forward is just a qualification hop; RAISE messages pass
-- through verbatim.
CREATE OR REPLACE FUNCTION public.book_slot(p_university_id uuid, p_period_id uuid, p_slot_id uuid) RETURNS uuid
LANGUAGE sql SET search_path = '' AS $$ SELECT private.book_slot(p_university_id, p_period_id, p_slot_id) $$;
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid) RETURNS uuid
LANGUAGE sql SET search_path = '' AS $$ SELECT private.cancel_booking(p_booking_id) $$;
CREATE OR REPLACE FUNCTION public.period_booking_overview(p_period_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$ SELECT private.period_booking_overview(p_period_id) $$;
GRANT EXECUTE ON FUNCTION public.book_slot(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.period_booking_overview(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.book_slot(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.period_booking_overview(uuid) FROM PUBLIC, anon;
