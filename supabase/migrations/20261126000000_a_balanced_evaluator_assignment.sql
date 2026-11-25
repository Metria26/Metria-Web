-- Balanced evaluator workload for evaluation periods (2026-11-26).
--
-- Problem: seats carry a round-robin evaluator, but a student who cancels keeps
-- that evaluator on the (now free) seat, and booked seats were never rebalanced.
-- With uneven booking/cancellation patterns one evaluator could end up with all
-- the students while another had none.
--
-- Solution: one transactional rebalance that assigns ACTIVE bookings with a
-- single global round-robin (counts differ by at most one, nobody is idle while
-- another has two), then points free seats at evaluators not already used in
-- that slot. Triggers call it after every booking status change, evaluator edit
-- and seat rebuild, so student and staff pages always see the balanced roster.

-- ----------------------------------------------------------------------------
-- SECTION 1: authoritative balance function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.balance_period_evaluators(p_period_id uuid)
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
  v_i integer;
  v_booking record;
  v_slot record;
  v_seat record;
  v_eval uuid;
  v_used uuid[];
BEGIN
  SELECT ep.university_id INTO v_uni
  FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT COALESCE(array_agg(e.id ORDER BY e.position, e.id), '{}'::uuid[]) INTO v_evaluators
  FROM public.evaluation_period_evaluators e
  WHERE e.university_id = v_uni AND e.period_id = p_period_id;
  v_n := COALESCE(array_length(v_evaluators, 1), 0);

  IF v_n = 0 THEN
    UPDATE public.bookings b SET evaluator_id = NULL
    WHERE b.university_id = v_uni AND b.period_id = p_period_id AND b.status = 'active';
    UPDATE public.slot_seats ss SET evaluator_id = NULL
    WHERE ss.university_id = v_uni AND ss.slot_id IN (
      SELECT sl.id FROM public.slots sl
      WHERE sl.university_id = v_uni AND sl.period_id = p_period_id
    );
    RETURN;
  END IF;

  -- Active bookings only. One global rotation in chronological seat order keeps
  -- the load even across the whole period, not just inside each slot.
  FOR v_booking IN
    SELECT b.id AS booking_id, ss.id AS seat_id
    FROM public.bookings b
    JOIN public.slots sl
      ON sl.university_id = b.university_id AND sl.id = b.slot_id
    LEFT JOIN public.slot_seats ss
      ON ss.university_id = b.university_id AND ss.id = b.seat_id
    WHERE b.university_id = v_uni AND b.period_id = p_period_id AND b.status = 'active'
    ORDER BY sl.starts_at ASC, COALESCE(ss.seat_number, 0) ASC, b.created_at ASC, b.id ASC
  LOOP
    v_eval := v_evaluators[(v_cursor % v_n) + 1];
    UPDATE public.bookings
    SET evaluator_id = v_eval, updated_at = now()
    WHERE id = v_booking.booking_id;
    IF v_booking.seat_id IS NOT NULL THEN
      UPDATE public.slot_seats SET evaluator_id = v_eval WHERE id = v_booking.seat_id;
    END IF;
    v_cursor := (v_cursor + 1) % v_n;
  END LOOP;

  -- Free seats: prefer evaluators with no active booking in this slot; if the
  -- slot needs sharing, continue the rotation so seats stay spread out.
  FOR v_slot IN
    SELECT sl.id FROM public.slots sl
    WHERE sl.university_id = v_uni AND sl.period_id = p_period_id
    ORDER BY sl.starts_at ASC, sl.id ASC
  LOOP
    SELECT COALESCE(
      array_agg(b.evaluator_id) FILTER (WHERE b.evaluator_id IS NOT NULL),
      '{}'::uuid[]
    ) INTO v_used
    FROM public.bookings b
    WHERE b.university_id = v_uni AND b.slot_id = v_slot.id AND b.status = 'active';

    FOR v_seat IN
      SELECT ss.id
      FROM public.slot_seats ss
      WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.university_id = ss.university_id
            AND b.seat_id = ss.id
            AND b.status = 'active'
        )
      ORDER BY ss.seat_number ASC
    LOOP
      v_eval := NULL;
      FOR v_i IN 0..(v_n - 1) LOOP
        v_eval := v_evaluators[((v_cursor + v_i) % v_n) + 1];
        EXIT WHEN NOT (v_eval = ANY(v_used));
      END LOOP;
      IF v_i = v_n THEN
        v_eval := v_evaluators[(v_cursor % v_n) + 1];
      END IF;
      UPDATE public.slot_seats SET evaluator_id = v_eval WHERE id = v_seat.id;
      v_used := array_append(v_used, v_eval);
      v_cursor := (v_cursor + 1) % v_n;
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 2: automatic rebalance on every relevant write
-- ----------------------------------------------------------------------------

-- A cancelled/completed booking no longer holds its evaluator. BEFORE trigger
-- so the cleared value is the one persisted for the status update.
CREATE OR REPLACE FUNCTION private.clear_inactive_booking_evaluator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    NEW.evaluator_id := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.rebalance_bookings_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_period_id := OLD.period_id;
  ELSE
    v_period_id := NEW.period_id;
  END IF;
  -- Only evaluator_id / updated_at change inside the balance function, so the
  -- UPDATE OF status trigger cannot recurse into itself.
  PERFORM private.balance_period_evaluators(v_period_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.rebalance_evaluators_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_period_id := OLD.period_id;
  ELSE
    v_period_id := NEW.period_id;
  END IF;
  PERFORM private.balance_period_evaluators(v_period_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_clear_inactive_booking_evaluator ON public.bookings;
CREATE TRIGGER trg_clear_inactive_booking_evaluator
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.clear_inactive_booking_evaluator();

DROP TRIGGER IF EXISTS trg_rebalance_bookings ON public.bookings;
CREATE TRIGGER trg_rebalance_bookings
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.rebalance_bookings_trigger();

DROP TRIGGER IF EXISTS trg_rebalance_evaluators ON public.evaluation_period_evaluators;
CREATE TRIGGER trg_rebalance_evaluators
  AFTER INSERT OR UPDATE OR DELETE ON public.evaluation_period_evaluators
  FOR EACH ROW EXECUTE FUNCTION private.rebalance_evaluators_trigger();

-- ----------------------------------------------------------------------------
-- SECTION 3: seat rebuilds finish with the same balanced assignment
-- ----------------------------------------------------------------------------

-- Keep the existing transactional seat creation/capacity logic, then rebalance
-- it. Renaming preserves the body; the wrapper keeps every existing caller
-- (create_slot, create_slots_bulk, capacity edits, evaluator edits) working.
ALTER FUNCTION private.rebuild_slot_seats(uuid) RENAME TO rebuild_slot_seats_base;

CREATE OR REPLACE FUNCTION private.rebuild_slot_seats(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.rebuild_slot_seats_base(p_period_id);
  PERFORM private.balance_period_evaluators(p_period_id);
END $$;

REVOKE EXECUTE ON FUNCTION private.rebuild_slot_seats(uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION private.balance_period_evaluators(uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION private.clear_inactive_booking_evaluator() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION private.rebalance_bookings_trigger() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION private.rebalance_evaluators_trigger() FROM PUBLIC, authenticated, anon;
