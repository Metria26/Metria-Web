-- Workload balancer v2 (2026-11-27).
--
-- Slots can have fewer seats than there are evaluators (e.g. capacity 3 with 4
-- evaluators). The rotation must therefore skip evaluators already used in the
-- same slot and continue the global cursor into the next slot:
--   slot 1 -> A, B, C | slot 2 -> D, A, B | slot 3 -> C, D, A
-- This version applies that walk to every seat, including seats with an ACTIVE
-- booking, so previously booked students are redistributed too. Counts across
-- the whole period stay within one of each other.

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
  v_slot record;
  v_seat record;
  v_used uuid[];
  v_eval uuid;
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

  FOR v_slot IN
    SELECT sl.id FROM public.slots sl
    WHERE sl.university_id = v_uni AND sl.period_id = p_period_id
    ORDER BY sl.starts_at ASC, sl.id ASC
  LOOP
    -- Reset per slot: each evaluator should appear at most once per slot while
    -- capacity <= evaluator count.
    v_used := '{}'::uuid[];

    FOR v_seat IN
      SELECT ss.id AS seat_id, b.id AS booking_id
      FROM public.slot_seats ss
      LEFT JOIN public.bookings b
        ON b.university_id = ss.university_id
       AND b.seat_id = ss.id
       AND b.status = 'active'
      WHERE ss.university_id = v_uni AND ss.slot_id = v_slot.id
      ORDER BY ss.seat_number ASC
    LOOP
      v_eval := NULL;
      FOR v_i IN 0..(v_n - 1) LOOP
        v_eval := v_evaluators[((v_cursor + v_i) % v_n) + 1];
        EXIT WHEN NOT (v_eval = ANY(v_used));
      END LOOP;
      -- More seats than evaluators in this slot: sharing is unavoidable.
      IF v_i = v_n THEN
        v_eval := v_evaluators[(v_cursor % v_n) + 1];
      END IF;

      UPDATE public.slot_seats SET evaluator_id = v_eval WHERE id = v_seat.seat_id;
      IF v_seat.booking_id IS NOT NULL THEN
        UPDATE public.bookings
        SET evaluator_id = v_eval, updated_at = now()
        WHERE id = v_seat.booking_id;
      END IF;

      v_used := array_append(v_used, v_eval);
      v_cursor := (v_cursor + 1) % v_n;
    END LOOP;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION private.balance_period_evaluators(uuid) FROM PUBLIC, authenticated, anon;
