-- ============================================================================
-- Migration: 20261125100000_a_evaluator_assignment
-- Lane: a  Module: evaluation_booking (evaluator assignment for slot booking)
--
-- Builds on: 20261016180000_a_evaluation_booking (periods/slots/bookings,
--   book_slot/cancel_booking/period_booking_overview),
--   20261108100000_a_booking_delete_bulk_switch (create_slots_bulk,
--   switch_booking, update_slot_capacity, delete RPCs, assert_period_manage_permission,
--   write_delete_audit, natural_sort_key),
--   20261110000000_a_booking_fixes (book_slot limit, active-only staff roster).
--
-- Adds (expand-only; no existing column is renamed or dropped):
--   1. public.evaluation_period_evaluators - account-less evaluator records
--      attached to a period, with an explicit position (A, B, C, ...).
--   2. public.slot_seats - one row per seat (1..capacity) with its assigned
--      evaluator. Seats are created when slots are created/generated, never at
--      booking time. A booking takes exactly one pre-assigned seat.
--   3. bookings.seat_id / bookings.evaluator_id (both NULLABLE) - the seat taken
--      and a SNAPSHOT of that seat's evaluator at booking time. Redistribution
--      only ever touches unbooked seats, so an existing booking's evaluator can
--      change solely through an explicit reassignment RPC.
--   4. private.rebuild_slot_seats(p_period_id) - the single transactional
--      assignment/redistribution executor: deterministic round-robin over the
--      flattened ordered seats, per-slot uniqueness where possible, booked
--      seats preserved, idempotent. Mirrored by the pure TS service in
--      src/features/booking/assignment.ts (unit-tested).
--   5. RPCs to save/reorder/add/remove evaluators, reassign one booking or all
--      of one evaluator's bookings, delete a booking (staff), create a single
--      slot with seats, plus seat allocation inside book_slot/switch_booking.
--   6. period_booking_overview extensions: staff-only evaluators + per-seat
--      schedule; every student sees ONLY their own booking's evaluator (never
--      evaluator data for slots they have not booked).
--
-- Legacy compatibility: existing slots are backfilled with seats that have a
-- NULL evaluator; existing bookings keep NULL seat_id/evaluator_id. A period
-- with no evaluators keeps the old behavior (no evaluator shown, no warnings).
--
-- Rollback: additive only. Drop the new RPCs/wrappers/policies first, then the
-- bookings columns, slot_seats and evaluation_period_evaluators tables; no
-- existing booking data is required to be restored.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ----------------------------------------------------------------------------
-- SECTION 1: tables, columns, backfill, RLS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.evaluation_period_evaluators(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  period_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  contact_note text,
  position integer NOT NULL,
  CONSTRAINT evaluation_period_evaluators_pkey PRIMARY KEY(id),
  CONSTRAINT evaluation_period_evaluators_tenant_id_key UNIQUE(university_id,id),
  CONSTRAINT evaluation_period_evaluators_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT,
  CONSTRAINT evaluation_period_evaluators_period_tenant_fk FOREIGN KEY(university_id,period_id) REFERENCES public.evaluation_periods(university_id,id) ON DELETE CASCADE,
  CONSTRAINT evaluation_period_evaluators_name_check CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT evaluation_period_evaluators_email_check CHECK(email IS NULL OR char_length(email) <= 254),
  CONSTRAINT evaluation_period_evaluators_phone_check CHECK(phone IS NULL OR char_length(phone) <= 60),
  CONSTRAINT evaluation_period_evaluators_note_check CHECK(contact_note IS NULL OR char_length(contact_note) <= 500),
  CONSTRAINT evaluation_period_evaluators_position_check CHECK(position >= 0 AND position < 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_period_evaluators_order_key
  ON public.evaluation_period_evaluators(university_id,period_id,position);
CREATE INDEX IF NOT EXISTS evaluation_period_evaluators_tenant_created_idx
  ON public.evaluation_period_evaluators(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_period_evaluators_period_idx
  ON public.evaluation_period_evaluators(university_id,period_id,position);
ALTER TABLE public.evaluation_period_evaluators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_period_evaluators FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.touch_evaluation_period_evaluators()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS evaluation_period_evaluators_touch ON public.evaluation_period_evaluators;
CREATE TRIGGER evaluation_period_evaluators_touch
  BEFORE UPDATE ON public.evaluation_period_evaluators FOR EACH ROW
  EXECUTE FUNCTION private.touch_evaluation_period_evaluators();

CREATE TABLE IF NOT EXISTS public.slot_seats(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  slot_id uuid NOT NULL,
  seat_number integer NOT NULL,
  evaluator_id uuid,
  CONSTRAINT slot_seats_pkey PRIMARY KEY(id),
  CONSTRAINT slot_seats_tenant_id_key UNIQUE(university_id,id),
  CONSTRAINT slot_seats_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT,
  CONSTRAINT slot_seats_slot_tenant_fk FOREIGN KEY(university_id,slot_id) REFERENCES public.slots(university_id,id) ON DELETE CASCADE,
  CONSTRAINT slot_seats_evaluator_tenant_fk FOREIGN KEY(university_id,evaluator_id) REFERENCES public.evaluation_period_evaluators(university_id,id) ON DELETE SET NULL,
  CONSTRAINT slot_seats_number_check CHECK(seat_number >= 1 AND seat_number <= 500),
  CONSTRAINT slot_seats_slot_number_key UNIQUE(university_id,slot_id,seat_number)
);
CREATE INDEX IF NOT EXISTS slot_seats_tenant_created_idx ON public.slot_seats(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS slot_seats_slot_idx ON public.slot_seats(university_id,slot_id,seat_number);
CREATE INDEX IF NOT EXISTS slot_seats_evaluator_idx ON public.slot_seats(university_id,evaluator_id) WHERE evaluator_id IS NOT NULL;
ALTER TABLE public.slot_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_seats FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.touch_slot_seats()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS slot_seats_touch ON public.slot_seats;
CREATE TRIGGER slot_seats_touch BEFORE UPDATE ON public.slot_seats FOR EACH ROW
  EXECUTE FUNCTION private.touch_slot_seats();

-- Additive bookings columns. Seat/evaluator are nullable for legacy rows and
-- for periods that intentionally have no evaluators (old behavior).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS seat_id uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS evaluator_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_seat_tenant_fk') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_seat_tenant_fk
      FOREIGN KEY(university_id,seat_id) REFERENCES public.slot_seats(university_id,id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_evaluator_tenant_fk') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_evaluator_tenant_fk
      FOREIGN KEY(university_id,evaluator_id) REFERENCES public.evaluation_period_evaluators(university_id,id) ON DELETE SET NULL;
  END IF;
END $$;

-- One active booking per seat: the definitive concurrency guard alongside the
-- existing period-row lock and capacity trigger.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_seat_uniq
  ON public.bookings(university_id,seat_id) WHERE status = 'active' AND seat_id IS NOT NULL;

-- Backfill one row per seat for every existing slot; evaluator stays NULL so
-- existing periods keep working exactly as before.
INSERT INTO public.slot_seats(university_id,slot_id,seat_number)
SELECT s.university_id, s.id, g.seat_number
FROM public.slots s
CROSS JOIN LATERAL generate_series(1, s.capacity) AS g(seat_number)
ON CONFLICT (university_id,slot_id,seat_number) DO NOTHING;

-- Staff of the offering manage/read evaluators and seats; nobody else gets
-- direct table access (student-visible evaluator data comes from the definer
-- overview RPC, scoped to the caller's own booking only).
DROP POLICY IF EXISTS evaluation_period_evaluators_staff_all ON public.evaluation_period_evaluators;
CREATE POLICY evaluation_period_evaluators_staff_all ON public.evaluation_period_evaluators FOR ALL TO authenticated
  USING (
    private.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.evaluation_periods ep
      JOIN public.offering_staff os
        ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE ep.university_id = evaluation_period_evaluators.university_id
        AND ep.id = evaluation_period_evaluators.period_id
        AND private.has_permission(ep.university_id,'booking.manage_period')
    )
  )
  WITH CHECK (
    private.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.evaluation_periods ep
      JOIN public.offering_staff os
        ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE ep.university_id = evaluation_period_evaluators.university_id
        AND ep.id = evaluation_period_evaluators.period_id
        AND private.has_permission(ep.university_id,'booking.manage_period')
    )
  );

DROP POLICY IF EXISTS slot_seats_staff_read ON public.slot_seats;
CREATE POLICY slot_seats_staff_read ON public.slot_seats FOR SELECT TO authenticated
  USING (
    private.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.slots s
      JOIN public.evaluation_periods ep
        ON ep.university_id = s.university_id AND ep.id = s.period_id
      JOIN public.offering_staff os
        ON os.university_id = ep.university_id AND os.offering_id = ep.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE s.university_id = slot_seats.university_id AND s.id = slot_seats.slot_id
    )
  );

REVOKE ALL ON public.evaluation_period_evaluators FROM anon;
REVOKE ALL ON public.slot_seats FROM anon;

-- ----------------------------------------------------------------------------
-- SECTION 2: the one authoritative assignment / redistribution function
-- ----------------------------------------------------------------------------
-- Locks the period row (same lock order as book_slot / switch_booking /
-- create_slots_bulk), makes the seat rows match slot capacities, then walks
-- every seat in order (slot starts_at, id; then seat_number) assigning the
-- next evaluator in rotation. Seats with an ACTIVE booking keep their current
-- evaluator; only unbooked seats are (re)assigned. Within one slot we skip
-- evaluators already used by another seat of that slot whenever an unused one
-- exists, so capacity <= evaluator count always means distinct evaluators.
-- The function is deterministic and idempotent for a given booking state.

CREATE OR REPLACE FUNCTION private.rebuild_slot_seats(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uni uuid;
  v_evaluators uuid[];
  v_n integer;
  v_cursor integer := 0;
  v_slot record;
  v_seat record;
  v_used uuid[];
  v_candidate uuid;
  v_eval uuid;
  v_found boolean;
  v_i integer;
BEGIN
  SELECT ep.university_id INTO v_uni
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT COALESCE(array_agg(e.id ORDER BY e.position, e.id), '{}'::uuid[]) INTO v_evaluators
  FROM public.evaluation_period_evaluators e
  WHERE e.university_id = v_uni AND e.period_id = p_period_id;
  v_n := COALESCE(array_length(v_evaluators,1), 0);

  FOR v_slot IN
    SELECT s.id, s.capacity
    FROM public.slots s
    WHERE s.university_id = v_uni AND s.period_id = p_period_id
    ORDER BY s.starts_at ASC, s.id ASC
  LOOP
    INSERT INTO public.slot_seats(university_id,slot_id,seat_number)
    SELECT v_uni, v_slot.id, g.seat_number
    FROM generate_series(1, v_slot.capacity) AS g(seat_number)
    ON CONFLICT (university_id,slot_id,seat_number) DO NOTHING;

    -- Never drop a seat that is still held by an active booking. Capacity edits
    -- must not silently orphan a seat; the UI surfaces this as a typed error.
    IF EXISTS (
      SELECT 1
      FROM public.slot_seats ss
      JOIN public.bookings b
        ON b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
      WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id
        AND ss.seat_number > v_slot.capacity
    ) THEN
      RAISE EXCEPTION 'capacity_seat_conflict';
    END IF;
    DELETE FROM public.slot_seats ss
    WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id
      AND ss.seat_number > v_slot.capacity;

    -- Evaluators already present in this slot (booked seats are immutable here).
    SELECT COALESCE(array_agg(ss.evaluator_id) FILTER (WHERE ss.evaluator_id IS NOT NULL), '{}'::uuid[])
      INTO v_used
    FROM public.slot_seats ss
    JOIN public.bookings b
      ON b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
    WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id;

    FOR v_seat IN
      SELECT ss.id,
             EXISTS (
               SELECT 1 FROM public.bookings b
               WHERE b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
             ) AS is_booked
      FROM public.slot_seats ss
      WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id
      ORDER BY ss.seat_number ASC
    LOOP
      IF v_seat.is_booked THEN
        -- Booked seat: preserve its evaluator and its position in the rotation.
        NULL;
      ELSIF v_n = 0 THEN
        UPDATE public.slot_seats SET evaluator_id = NULL WHERE id = v_seat.id;
      ELSE
        v_candidate := NULL;
        v_found := false;
        FOR v_i IN 0..(v_n - 1) LOOP
          v_eval := v_evaluators[((v_cursor + v_i) % v_n) + 1];
          -- Booked seats' evaluators are already in v_used.
          IF NOT (v_eval = ANY(v_used)) THEN
            v_candidate := v_eval;
            v_found := true;
            EXIT;
          END IF;
        END LOOP;
        -- capacity > evaluator count: sharing is allowed, spread as evenly as
        -- the rotation does.
        IF NOT v_found THEN
          v_candidate := v_evaluators[(v_cursor % v_n) + 1];
        END IF;
        UPDATE public.slot_seats SET evaluator_id = v_candidate WHERE id = v_seat.id;
        v_used := array_append(v_used, v_candidate);
      END IF;
      v_cursor := (v_cursor + 1) % GREATEST(v_n, 1);
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 3: evaluator write RPCs
-- ----------------------------------------------------------------------------

-- Full save of the ordered evaluator list (create, edit, reorder, add, remove).
-- Existing ids are preserved so booked seats keep their evaluator reference;
-- removed evaluators must have no active bookings (use reassign/remove RPCs).
CREATE OR REPLACE FUNCTION private.save_period_evaluators(
  p_period_id uuid,
  p_evaluators jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_items jsonb;
  v_item jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_removed uuid[];
  v_id uuid;
  v_position integer;
  v_name text;
  v_email text;
  v_phone text;
  v_note text;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep WHERE ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_period.university_id,'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_evaluators IS NULL OR jsonb_typeof(p_evaluators) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  SELECT count(*)::integer INTO v_count FROM jsonb_array_elements(p_evaluators);
  IF v_count > 50 THEN RAISE EXCEPTION 'too_many_evaluators'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_evaluators) AS x(item)
    WHERE jsonb_typeof(x.item) <> 'object'
       OR COALESCE(NULLIF(btrim(x.item->>'name'),''),'') = ''
       OR char_length(x.item->>'name') > 120
       OR (x.item->>'email') IS NOT NULL AND char_length(x.item->>'email') > 254
       OR (x.item->>'phone') IS NOT NULL AND char_length(x.item->>'phone') > 60
       OR (x.item->>'contact_note') IS NOT NULL AND char_length(x.item->>'contact_note') > 500
       OR (x.item->>'position') IS NULL
       OR (x.item->>'position') !~ '^[0-9]+$'
       OR (x.item->>'id') IS NOT NULL AND (x.item->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  -- Distinct positions and distinct supplied ids are required.
  IF (SELECT count(DISTINCT (x.item->>'position')::integer) FROM jsonb_array_elements(p_evaluators) AS x(item)) <> v_count THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF (SELECT count(DISTINCT x.item->>'id') FROM jsonb_array_elements(p_evaluators) AS x(item)
       WHERE x.item->>'id' IS NOT NULL)
     <> (SELECT count(*) FROM jsonb_array_elements(p_evaluators) AS x(item) WHERE x.item->>'id' IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  -- Any supplied id must already belong to THIS period.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_evaluators) AS x(item)
    WHERE x.item->>'id' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.evaluation_period_evaluators e
        WHERE e.university_id = v_period.university_id
          AND e.period_id = p_period_id
          AND e.id = (x.item->>'id')::uuid
      )
  ) THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;

  SELECT COALESCE(array_agg((x.item->>'id')::uuid) FILTER (WHERE x.item->>'id' IS NOT NULL), '{}'::uuid[])
    INTO v_ids
  FROM jsonb_array_elements(p_evaluators) AS x(item);

  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) INTO v_removed
  FROM public.evaluation_period_evaluators e
  WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
    AND NOT (e.id = ANY(v_ids));

  -- A booked evaluator is never removed implicitly; use remove_period_evaluator
  -- with a replacement so no booking changes without an explicit decision.
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.university_id = v_period.university_id AND b.period_id = p_period_id
      AND b.status = 'active' AND b.evaluator_id = ANY(v_removed)
  ) THEN
    RAISE EXCEPTION 'evaluator_has_bookings';
  END IF;

  -- Two-phase position update so the unique (period, position) index never
  -- collides while rows are being reordered.
  UPDATE public.evaluation_period_evaluators e
  SET position = -e.position - 1
  WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id;

  DELETE FROM public.evaluation_period_evaluators e
  WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
    AND e.id = ANY(v_removed);

  FOR v_item IN SELECT x.item FROM jsonb_array_elements(p_evaluators) AS x(item) LOOP
    v_id := NULLIF(v_item->>'id','')::uuid;
    v_position := (v_item->>'position')::integer;
    v_name := btrim(v_item->>'name');
    v_email := NULLIF(btrim(COALESCE(v_item->>'email','')),'');
    v_phone := NULLIF(btrim(COALESCE(v_item->>'phone','')),'');
    v_note := NULLIF(btrim(COALESCE(v_item->>'contact_note','')),'');

    IF v_id IS NULL THEN
      INSERT INTO public.evaluation_period_evaluators
        (university_id,period_id,created_by,name,email,phone,contact_note,position)
      VALUES (v_period.university_id,p_period_id,v_profile_id,v_name,v_email,v_phone,v_note,v_position);
    ELSE
      UPDATE public.evaluation_period_evaluators e
      SET name = v_name, email = v_email, phone = v_phone,
          contact_note = v_note, position = v_position
      WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id AND e.id = v_id;
    END IF;
  END LOOP;

  PERFORM private.rebuild_slot_seats(p_period_id);
  PERFORM private.write_delete_audit(v_period.university_id, v_profile_id,
    'booking.evaluators.saved', 'period', p_period_id,
    jsonb_build_object('evaluators', v_count, 'removed', v_removed));
END $$;

-- Reassign one booking (and its seat) to another evaluator of the same period.
CREATE OR REPLACE FUNCTION private.reassign_booking_evaluator(
  p_booking_id uuid,
  p_evaluator_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_booking public.bookings%ROWTYPE;
  v_period public.evaluation_periods%ROWTYPE;
  v_old_evaluator_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT b.* INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT ep.* INTO v_period FROM public.evaluation_periods ep
   WHERE ep.university_id = v_booking.university_id AND ep.id = v_booking.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_booking.university_id,'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_booking.status <> 'active' THEN RAISE EXCEPTION 'not_active'; END IF;
  IF p_evaluator_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.evaluation_period_evaluators e
    WHERE e.university_id = v_booking.university_id AND e.period_id = v_booking.period_id
      AND e.id = p_evaluator_id
  ) THEN
    RAISE EXCEPTION 'invalid_evaluator';
  END IF;

  v_old_evaluator_id := v_booking.evaluator_id;
  UPDATE public.bookings b SET evaluator_id = p_evaluator_id WHERE b.id = p_booking_id;
  UPDATE public.slot_seats ss SET evaluator_id = p_evaluator_id
  WHERE ss.university_id = v_booking.university_id AND ss.id = v_booking.seat_id;

  PERFORM private.write_delete_audit(v_booking.university_id, v_profile_id,
    'booking.evaluator.reassigned', 'booking', p_booking_id,
    jsonb_build_object('from', v_old_evaluator_id, 'to', p_evaluator_id));
END $$;

-- Move all active bookings of one evaluator to another in the same period.
CREATE OR REPLACE FUNCTION private.bulk_reassign_evaluator(
  p_period_id uuid,
  p_from_evaluator_id uuid,
  p_to_evaluator_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep WHERE ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_period.university_id,'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_from_evaluator_id IS NULL OR p_to_evaluator_id IS NULL
     OR p_from_evaluator_id = p_to_evaluator_id THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.evaluation_period_evaluators e
    WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
      AND e.id = p_to_evaluator_id
  ) THEN
    RAISE EXCEPTION 'invalid_evaluator';
  END IF;

  UPDATE public.bookings b SET evaluator_id = p_to_evaluator_id
  WHERE b.university_id = v_period.university_id AND b.period_id = p_period_id
    AND b.status = 'active' AND b.evaluator_id = p_from_evaluator_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.slot_seats ss SET evaluator_id = p_to_evaluator_id
  WHERE ss.university_id = v_period.university_id
    AND ss.evaluator_id = p_from_evaluator_id
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
    );

  PERFORM private.write_delete_audit(v_period.university_id, v_profile_id,
    'booking.evaluator.bulk_reassigned', 'period', p_period_id,
    jsonb_build_object('from', p_from_evaluator_id, 'to', p_to_evaluator_id, 'bookings', v_count));
  RETURN v_count;
END $$;

-- Remove an evaluator. Booked seats must first be moved (replacement supplied
-- in the same action); unbooked seats are redistributed by rebuild_slot_seats.
CREATE OR REPLACE FUNCTION private.remove_period_evaluator(
  p_period_id uuid,
  p_evaluator_id uuid,
  p_replacement_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_bookings integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep WHERE ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_period.university_id,'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.evaluation_period_evaluators e
    WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
      AND e.id = p_evaluator_id
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT count(*)::integer INTO v_bookings
  FROM public.bookings b
  WHERE b.university_id = v_period.university_id AND b.period_id = p_period_id
    AND b.status = 'active' AND b.evaluator_id = p_evaluator_id;

  IF v_bookings > 0 THEN
    IF p_replacement_id IS NULL OR p_replacement_id = p_evaluator_id THEN
      RAISE EXCEPTION 'evaluator_has_bookings';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.evaluation_period_evaluators e
      WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
        AND e.id = p_replacement_id
    ) THEN
      RAISE EXCEPTION 'invalid_evaluator';
    END IF;
    PERFORM private.bulk_reassign_evaluator(p_period_id, p_evaluator_id, p_replacement_id);
  ELSIF p_replacement_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  DELETE FROM public.evaluation_period_evaluators e
  WHERE e.university_id = v_period.university_id AND e.period_id = p_period_id
    AND e.id = p_evaluator_id;

  PERFORM private.rebuild_slot_seats(p_period_id);
  PERFORM private.write_delete_audit(v_period.university_id, v_profile_id,
    'booking.evaluator.deleted', 'evaluator', p_evaluator_id,
    jsonb_build_object('period_id', p_period_id, 'bookings_moved', v_bookings,
                       'replacement', p_replacement_id));
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 4: seat allocation in booking paths + booking deletion
-- ----------------------------------------------------------------------------

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
  v_seat_id uuid;
  v_evaluator_id uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id AND m.profile_id = v_profile_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Serialize with switch_booking, slot generation and evaluator edits.
  SELECT ep.section_id INTO v_section_id
  FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF (SELECT count(*) FROM public.bookings b
      WHERE b.university_id = p_university_id AND b.period_id = p_period_id
        AND b.student_id = v_profile_id AND b.status = 'active') >= 2 THEN
    RAISE EXCEPTION 'too_many_bookings';
  END IF;
  IF NOT private.is_enrolled(v_section_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT s.ends_at INTO v_slot_ends
  FROM public.slots s
  WHERE s.university_id = p_university_id AND s.id = p_slot_id AND s.period_id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_slot_ends <= now() THEN RAISE EXCEPTION 'slot_ended'; END IF;

  IF (SELECT count(*) FROM public.bookings b
      WHERE b.university_id = p_university_id AND b.slot_id = p_slot_id AND b.status = 'active')
     >= (SELECT s.capacity FROM public.slots s
         WHERE s.university_id = p_university_id AND s.id = p_slot_id) THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  -- One booking = exactly one pre-assigned seat. Seat rows were created when
  -- slots were generated, never here.
  SELECT ss.id, ss.evaluator_id INTO v_seat_id, v_evaluator_id
  FROM public.slot_seats ss
  WHERE ss.university_id = p_university_id AND ss.slot_id = p_slot_id
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
    )
  ORDER BY ss.seat_number ASC
  LIMIT 1
  FOR UPDATE OF ss;
  IF v_seat_id IS NULL THEN RAISE EXCEPTION 'seat_unavailable'; END IF;

  BEGIN
    INSERT INTO public.bookings
      (university_id,period_id,slot_id,student_id,created_by,seat_id,evaluator_id)
    VALUES (p_university_id,p_period_id,p_slot_id,v_profile_id,v_profile_id,v_seat_id,v_evaluator_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.switch_booking(p_period_id uuid, p_target_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_target public.slots%ROWTYPE;
  v_current public.slots%ROWTYPE;
  v_seat_id uuid;
  v_evaluator_id uuid;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep WHERE ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = v_period.university_id AND m.profile_id = v_profile_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT b.* INTO v_booking FROM public.bookings b
  WHERE b.university_id = v_period.university_id AND b.period_id = p_period_id
    AND b.student_id = v_profile_id AND b.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_booking'; END IF;
  IF NOT private.is_enrolled(v_period.section_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT s.* INTO v_current FROM public.slots s
  WHERE s.university_id = v_period.university_id AND s.id = v_booking.slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_current.ends_at <= now() THEN RAISE EXCEPTION 'slot_ended'; END IF;
  IF now() >= v_current.starts_at - make_interval(hours => v_period.cutoff_hours) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  SELECT s.* INTO v_target FROM public.slots s
  WHERE s.university_id = v_period.university_id AND s.id = p_target_slot_id AND s.period_id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_target.id = v_current.id THEN RETURN v_booking.id; END IF;
  IF v_target.ends_at <= now() THEN RAISE EXCEPTION 'slot_ended'; END IF;

  IF (SELECT count(*) FROM public.bookings b
      WHERE b.university_id = v_period.university_id AND b.slot_id = v_target.id AND b.status = 'active')
     >= v_target.capacity THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  SELECT ss.id, ss.evaluator_id INTO v_seat_id, v_evaluator_id
  FROM public.slot_seats ss
  WHERE ss.university_id = v_period.university_id AND ss.slot_id = v_target.id
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.university_id = ss.university_id AND b.seat_id = ss.id AND b.status = 'active'
    )
  ORDER BY ss.seat_number ASC
  LIMIT 1
  FOR UPDATE OF ss;
  IF v_seat_id IS NULL THEN RAISE EXCEPTION 'seat_unavailable'; END IF;

  UPDATE public.bookings b SET status = 'cancelled', updated_at = now()
  WHERE id = v_booking.id AND status = 'active';
  BEGIN
    INSERT INTO public.bookings
      (university_id,period_id,slot_id,student_id,created_by,seat_id,evaluator_id)
    VALUES (v_period.university_id,p_period_id,v_target.id,v_profile_id,v_profile_id,
            v_seat_id,v_evaluator_id)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;
  RETURN v_new_id;
END $$;

-- Staff: hard-delete a booking (student cancel remains a status change). The
-- seat is released and an audit row records who was removed and their evaluator.
CREATE OR REPLACE FUNCTION private.delete_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_booking public.bookings%ROWTYPE;
  v_period public.evaluation_periods%ROWTYPE;
  v_student_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT b.* INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT ep.* INTO v_period FROM public.evaluation_periods ep
  WHERE ep.university_id = v_booking.university_id AND ep.id = v_booking.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_booking.university_id,'booking.manage_period'))
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT pr.display_name INTO v_student_name FROM public.profiles pr WHERE pr.id = v_booking.student_id;
  DELETE FROM public.swap_requests sr
  WHERE sr.university_id = v_booking.university_id
    AND (sr.from_booking_id = p_booking_id OR sr.to_booking_id = p_booking_id);
  DELETE FROM public.bookings b WHERE b.id = p_booking_id;

  PERFORM private.write_delete_audit(v_booking.university_id, v_profile_id,
    'booking.booking.deleted', 'booking', p_booking_id,
    jsonb_build_object('period_id', v_booking.period_id, 'slot_id', v_booking.slot_id,
                       'student_name', v_student_name, 'status', v_booking.status,
                       'evaluator_id', v_booking.evaluator_id));
END $$;

-- Single-slot creation now goes through an RPC so seat rows are created in the
-- same transaction (the old direct RLS INSERT is retained for compatibility but
-- the app uses this path).
CREATE OR REPLACE FUNCTION private.create_slot(
  p_university_id uuid,
  p_period_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer,
  p_location text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id AND m.profile_id = v_profile_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(p_university_id,'booking.manage_period'))
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 500
     OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF p_starts_at < v_period.starts_at OR p_ends_at > v_period.ends_at THEN
    RAISE EXCEPTION 'outside_period';
  END IF;

  INSERT INTO public.slots
    (university_id,period_id,starts_at,ends_at,capacity,location,created_by)
  VALUES (p_university_id,p_period_id,p_starts_at,p_ends_at,p_capacity,
          NULLIF(btrim(COALESCE(p_location,'')),''),v_profile_id)
  RETURNING id INTO v_id;

  PERFORM private.rebuild_slot_seats(p_period_id);
  RETURN v_id;
END $$;

-- Capacity edit: same authoritative checks as before, then reconcile seats.
CREATE OR REPLACE FUNCTION private.update_slot_capacity(p_slot_id uuid, p_capacity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_period_id uuid;
  v_offering_id uuid;
  v_active integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT s.university_id, s.period_id, ep.offering_id
    INTO v_uni, v_period_id, v_offering_id
  FROM public.slots s
  JOIN public.evaluation_periods ep ON ep.id = s.period_id AND ep.university_id = s.university_id
  WHERE s.id = p_slot_id;
  IF v_offering_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM private.assert_period_manage_permission(v_uni, v_offering_id);
  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 500 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  SELECT count(*)::integer INTO v_active
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id AND b.university_id = v_uni AND b.status = 'active';
  IF p_capacity < v_active THEN RAISE EXCEPTION 'capacity_below_bookings'; END IF;

  UPDATE public.slots s SET capacity = p_capacity, updated_at = now()
  WHERE s.id = p_slot_id AND s.university_id = v_uni;
  PERFORM private.rebuild_slot_seats(v_period_id);
END $$;

-- Bulk slot generation: identical validation to the prior version, plus one
-- seat rebuild after the atomic INSERT (no per-row O(n^2) work).
CREATE OR REPLACE FUNCTION private.create_slots_bulk(
  p_university_id uuid,
  p_period_id uuid,
  p_from_date date,
  p_to_date date,
  p_daily_start time,
  p_daily_end time,
  p_slot_minutes integer,
  p_gap_minutes integer,
  p_capacity integer,
  p_location text,
  p_slots_per_day integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_offering_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_days int;
  v_per_day int;
  v_total int;
  v_overlaps int;
  v_out_of_window int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id AND m.profile_id = v_profile_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.offering_id, ep.starts_at, ep.ends_at
    INTO v_offering_id, v_period_start, v_period_end
  FROM public.evaluation_periods ep
  WHERE ep.university_id = p_university_id AND ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_offering_id)
        AND private.has_permission(p_university_id,'booking.manage_period'))
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date
     OR p_daily_start IS NULL OR p_slot_minutes IS NULL
     OR p_slot_minutes < 1 OR p_slot_minutes > 480
     OR p_gap_minutes IS NULL OR p_gap_minutes < 0 OR p_gap_minutes > 240
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 500
     OR (p_slots_per_day IS NULL AND p_daily_end IS NULL)
     OR (p_slots_per_day IS NOT NULL AND (p_slots_per_day < 1 OR p_slots_per_day > 200)) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF p_daily_end IS NOT NULL THEN
    IF p_daily_end <= p_daily_start THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF p_slots_per_day IS NOT NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  END IF;

  IF p_slots_per_day IS NOT NULL THEN
    v_per_day := p_slots_per_day;
  ELSE
    v_per_day := floor(
      (extract(epoch FROM (p_daily_end - p_daily_start)) - p_slot_minutes::int * 60)
      / (p_slot_minutes::int * 60 + p_gap_minutes::int * 60)
    )::int + 1;
    IF v_per_day < 1 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  END IF;

  SELECT count(DISTINCT d)::int INTO v_days
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d;
  v_total := v_days * v_per_day;
  IF v_total < 1 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_total > 500 THEN RAISE EXCEPTION 'too_many_slots'; END IF;

  SELECT count(*)::int INTO v_overlaps
  FROM public.slots s
  WHERE s.university_id = p_university_id AND s.period_id = p_period_id
    AND EXISTS (
      SELECT 1
      FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
           generate_series(0, v_per_day - 1) AS i
      WHERE s.starts_at < (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi' + make_interval(secs => p_slot_minutes::int * 60)
        AND ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi') < s.ends_at
    );
  IF v_overlaps > 0 THEN RAISE EXCEPTION 'slot_overlap'; END IF;

  SELECT count(*)::int INTO v_out_of_window
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
       generate_series(0, v_per_day - 1) AS i
  WHERE ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi') < v_period_start
     OR ((d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60) + p_slot_minutes::int * 60)) AT TIME ZONE 'Asia/Karachi') > v_period_end;
  IF v_out_of_window > 0 THEN RAISE EXCEPTION 'outside_period'; END IF;

  INSERT INTO public.slots
    (university_id,period_id,starts_at,ends_at,capacity,location,created_by)
  SELECT p_university_id,p_period_id,
         (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60))) AT TIME ZONE 'Asia/Karachi',
         (d + p_daily_start + make_interval(secs => i * (p_slot_minutes::int * 60 + p_gap_minutes::int * 60) + p_slot_minutes::int * 60)) AT TIME ZONE 'Asia/Karachi',
         p_capacity, NULLIF(trim(p_location),''), v_profile_id
  FROM generate_series(p_from_date::timestamp, p_to_date::timestamp, interval '1 day') AS d,
       generate_series(0, v_per_day - 1) AS i;

  PERFORM private.rebuild_slot_seats(p_period_id);
  RETURN v_total;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 5: period overview — staff-only schedule, own-booking evaluator only
-- ----------------------------------------------------------------------------

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep WHERE ep.id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  v_is_staff := private.is_offering_staff(v_period.offering_id);
  v_can_manage := private.is_platform_admin()
    OR (v_is_staff AND private.has_permission(v_period.university_id,'booking.manage_period'));
  IF NOT (v_can_manage OR v_is_staff OR private.is_enrolled(v_period.section_id)) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN jsonb_build_object(
    'period', (
      SELECT jsonb_build_object(
        'id', ep.id, 'title', ep.title,
        'offering_id', ep.offering_id, 'section_id', ep.section_id,
        'starts_at', ep.starts_at, 'ends_at', ep.ends_at,
        'cutoff_hours', ep.cutoff_hours,
        'offering_code', o.offering_code, 'course_code', c.code, 'section_code', s.section_code
      )
      FROM public.evaluation_periods ep
      JOIN public.sections s ON s.university_id = ep.university_id AND s.id = ep.section_id
      JOIN public.course_offerings o ON o.university_id = ep.university_id AND o.id = ep.offering_id
      JOIN public.courses c ON c.university_id = o.university_id AND c.id = o.course_id
      WHERE ep.id = v_period.id
    ),
    'can_manage', v_can_manage,
    -- Evaluator contact details are staff-only. Students never receive the
    -- evaluator list: they learn only their own evaluator after booking.
    'evaluators', CASE WHEN v_is_staff THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'email', e.email, 'phone', e.phone,
        'contact_note', e.contact_note, 'position', e.position
      ) ORDER BY e.position ASC, e.id ASC)
      FROM public.evaluation_period_evaluators e
      WHERE e.university_id = v_period.university_id AND e.period_id = v_period.id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
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
            WHERE b.university_id = sl.university_id AND b.slot_id = sl.id AND b.status = 'active'
          ),
          'my_booking_id', (
            SELECT b.id FROM public.bookings b
            WHERE b.university_id = sl.university_id AND b.slot_id = sl.id
              AND b.student_id = v_profile_id AND b.status = 'active'
            LIMIT 1
          ),
          -- Only the caller's own booking exposes evaluator data to students.
          'my_evaluator', (
            SELECT CASE WHEN ev.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', ev.id, 'name', ev.name, 'email', ev.email,
              'phone', ev.phone, 'contact_note', ev.contact_note
            ) END
            FROM public.bookings b2
            LEFT JOIN public.evaluation_period_evaluators ev
              ON ev.university_id = b2.university_id AND ev.id = b2.evaluator_id
            WHERE b2.university_id = sl.university_id AND b2.slot_id = sl.id
              AND b2.student_id = v_profile_id AND b2.status = 'active'
            LIMIT 1
          ),
          'seats', CASE WHEN v_is_staff THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', ss.id,
              'seat_number', ss.seat_number,
              'evaluator_id', ss.evaluator_id,
              'evaluator_name', ev2.name,
              'booking_id', b3.id,
              'student_name', pr2.display_name,
              'student_email', pr2.email,
              'status', b3.status
            ) ORDER BY ss.seat_number ASC)
            FROM public.slot_seats ss
            LEFT JOIN public.evaluation_period_evaluators ev2
              ON ev2.university_id = ss.university_id AND ev2.id = ss.evaluator_id
            LEFT JOIN public.bookings b3
              ON b3.university_id = ss.university_id AND b3.seat_id = ss.id AND b3.status = 'active'
            LEFT JOIN public.profiles pr2 ON pr2.id = b3.student_id
            WHERE ss.university_id = sl.university_id AND ss.slot_id = sl.id
          ), '[]'::jsonb) ELSE '[]'::jsonb END
        ) AS row_json
        FROM public.slots sl
        WHERE sl.university_id = v_period.university_id AND sl.period_id = v_period.id
      ) slot_rows
    ), '[]'::jsonb),
    'students', CASE WHEN v_is_staff THEN COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'slot_starts_at' ASC,
                                private.natural_sort_key(row_json->>'student_email') ASC)
      FROM (
        SELECT jsonb_build_object(
          'slot_id', b.slot_id,
          'slot_starts_at', sl.starts_at,
          'student_name', pr.display_name,
          'student_email', pr.email,
          'booked_at', b.created_at,
          'status', b.status,
          'booking_id', b.id,
          'seat_number', ss.seat_number,
          'evaluator_id', b.evaluator_id,
          'evaluator_name', ev.name
        ) AS row_json
        FROM public.bookings b
        JOIN public.slots sl ON sl.university_id = b.university_id AND sl.id = b.slot_id
        JOIN public.profiles pr ON pr.id = b.student_id
        LEFT JOIN public.slot_seats ss ON ss.university_id = b.university_id AND ss.id = b.seat_id
        LEFT JOIN public.evaluation_period_evaluators ev
          ON ev.university_id = b.university_id AND ev.id = b.evaluator_id
        WHERE b.university_id = v_period.university_id AND b.period_id = v_period.id
          AND b.status = 'active'
      ) booking_rows
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 6: public wrappers + grants (D-k transport)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_period_evaluators(p_period_id uuid, p_evaluators jsonb)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.save_period_evaluators(p_period_id, p_evaluators) $$;

CREATE OR REPLACE FUNCTION public.reassign_booking_evaluator(p_booking_id uuid, p_evaluator_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.reassign_booking_evaluator(p_booking_id, p_evaluator_id) $$;

CREATE OR REPLACE FUNCTION public.bulk_reassign_evaluator(
  p_period_id uuid, p_from_evaluator_id uuid, p_to_evaluator_id uuid
)
RETURNS integer LANGUAGE sql SET search_path = ''
AS $$ SELECT private.bulk_reassign_evaluator(p_period_id, p_from_evaluator_id, p_to_evaluator_id) $$;

CREATE OR REPLACE FUNCTION public.remove_period_evaluator(
  p_period_id uuid, p_evaluator_id uuid, p_replacement_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.remove_period_evaluator(p_period_id, p_evaluator_id, p_replacement_id) $$;

CREATE OR REPLACE FUNCTION public.delete_booking(p_booking_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.delete_booking(p_booking_id) $$;

CREATE OR REPLACE FUNCTION public.create_slot(
  p_university_id uuid, p_period_id uuid, p_starts_at timestamptz,
  p_ends_at timestamptz, p_capacity integer, p_location text
)
RETURNS uuid LANGUAGE sql SET search_path = ''
AS $$ SELECT private.create_slot(p_university_id, p_period_id, p_starts_at, p_ends_at,
                                 p_capacity, p_location) $$;

-- rebuild_slot_seats has no auth check of its own: it is only ever called from
-- other SECURITY DEFINER functions, never exposed to clients.
REVOKE EXECUTE ON FUNCTION private.rebuild_slot_seats(uuid) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION private.save_period_evaluators(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.reassign_booking_evaluator(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.bulk_reassign_evaluator(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.remove_period_evaluator(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_slot(uuid,uuid,timestamptz,timestamptz,integer,text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.save_period_evaluators(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_booking_evaluator(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_reassign_evaluator(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_period_evaluator(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_slot(uuid,uuid,timestamptz,timestamptz,integer,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.save_period_evaluators(uuid,jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION private.reassign_booking_evaluator(uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.bulk_reassign_evaluator(uuid,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.remove_period_evaluator(uuid,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.delete_booking(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.create_slot(uuid,uuid,timestamptz,timestamptz,integer,text) FROM anon;

REVOKE EXECUTE ON FUNCTION public.save_period_evaluators(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reassign_booking_evaluator(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_reassign_evaluator(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_period_evaluator(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_booking(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_slot(uuid,uuid,timestamptz,timestamptz,integer,text) FROM PUBLIC, anon;

-- Replace-in-place functions keep their existing grants; re-assert them so a
-- fresh database from all migrations ends in the same state.
GRANT EXECUTE ON FUNCTION private.book_slot(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.switch_booking(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_slot_capacity(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_slots_bulk(uuid,uuid,date,date,time,time,integer,integer,integer,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.period_booking_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_slot(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_booking(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_slot_capacity(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_slots_bulk(uuid,uuid,date,date,time,time,integer,integer,integer,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.period_booking_overview(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 7: period creation with its evaluator list in one transaction
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.create_period_with_evaluators(
  p_university_id uuid,
  p_offering_id uuid,
  p_section_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_cutoff_hours integer,
  p_evaluators jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.university_memberships m
    WHERE m.university_id = p_university_id AND m.profile_id = v_profile_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(p_offering_id)
        AND private.has_permission(p_university_id,'booking.manage_period'))
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) < 3 OR char_length(btrim(p_title)) > 120
     OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
     OR p_cutoff_hours IS NULL OR p_cutoff_hours < 0 OR p_cutoff_hours > 168
     OR p_evaluators IS NULL OR jsonb_typeof(p_evaluators) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  INSERT INTO public.evaluation_periods
    (university_id,created_by,offering_id,section_id,title,starts_at,ends_at,cutoff_hours)
  VALUES (p_university_id,v_profile_id,p_offering_id,p_section_id,btrim(p_title),
          p_starts_at,p_ends_at,p_cutoff_hours)
  RETURNING id INTO v_period_id;

  -- Reuses all evaluator validation, ordering and assignment logic.
  PERFORM private.save_period_evaluators(v_period_id, p_evaluators);
  RETURN v_period_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_period_with_evaluators(
  p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_cutoff_hours integer, p_evaluators jsonb
)
RETURNS uuid LANGUAGE sql SET search_path = ''
AS $$ SELECT private.create_period_with_evaluators(p_university_id, p_offering_id, p_section_id,
  p_title, p_starts_at, p_ends_at, p_cutoff_hours, p_evaluators) $$;

GRANT EXECUTE ON FUNCTION private.create_period_with_evaluators(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_period_with_evaluators(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.create_period_with_evaluators(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_period_with_evaluators(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,jsonb) FROM PUBLIC, anon;
