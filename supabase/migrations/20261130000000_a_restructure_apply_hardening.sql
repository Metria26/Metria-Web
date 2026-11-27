-- Harden the transactional slot restructure apply:
--  * fail early with a clear code when the audit table migration is missing;
--  * publish the new period defaults inside the same transaction, before seats
--    with the new capacity are assigned;
--  * release old seats in a first phase so no transient one-booking-per-seat
--    conflict can occur while bookings are moved to the new layout.
-- Everything remains one SECURITY DEFINER function (one DB transaction), so any
-- error rolls back slots, seats, bookings and period settings together.

CREATE OR REPLACE FUNCTION public.apply_slot_restructure(
  p_period_id uuid,
  p_slot_minutes integer,
  p_capacity integer,
  p_days jsonb,
  p_keep_evaluator boolean,
  p_fill_after_last boolean,
  p_plan jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uni uuid;
  v_profile uuid;
  v_snapshot jsonb;
  v_day jsonb;
  v_slot jsonb;
  v_row jsonb;
  v_seat jsonb;
  v_new_ids jsonb := '{}'::jsonb;
  v_first_by_day jsonb := '{}'::jsonb;
  v_new_slot_ids uuid[] := '{}'::uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_slot_id uuid;
  v_any_slot uuid;
  v_seat_id uuid;
  v_seat_no integer;
  v_evaluator uuid;
  v_audit_id uuid;
  v_slots_created integer := 0;
  v_booking_id uuid;
  v_old_day text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.university_id INTO v_uni
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id FOR UPDATE;
  IF v_uni IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (COALESCE(private.is_platform_admin(), false) OR EXISTS (
    SELECT 1 FROM public.evaluation_periods ep
    WHERE ep.id = p_period_id AND ep.created_by = v_profile
  )) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF to_regclass('public.period_slot_restructures') IS NULL THEN
    RAISE EXCEPTION 'migration_missing';
  END IF;

  IF p_slot_minutes IS NULL OR p_slot_minutes < 1 OR p_slot_minutes > 240
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 500
     OR jsonb_typeof(p_days) <> 'array' OR jsonb_typeof(p_plan) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evaluation_periods ep
             WHERE ep.id = p_period_id AND ep.restructure_locked) THEN
    RAISE EXCEPTION 'restructure_in_progress';
  END IF;

  -- Every active booking must appear once, on its original day.
  IF (SELECT count(*) FROM jsonb_array_elements(p_plan)) <>
     (SELECT count(*) FROM public.bookings b
      WHERE b.university_id = v_uni AND b.period_id = p_period_id AND b.status = 'active') THEN
    RAISE EXCEPTION 'restructure_stale';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
    v_booking_id := NULLIF(v_row->>'bookingId', '')::uuid;
    IF v_booking_id IS NULL OR v_booking_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'restructure_stale';
    END IF;
    v_seen := array_append(v_seen, v_booking_id);
    SELECT (sl.starts_at AT TIME ZONE 'Asia/Karachi')::date::text INTO v_old_day
    FROM public.bookings b
    JOIN public.slots sl ON sl.university_id = b.university_id AND sl.id = b.slot_id
    WHERE b.id = v_booking_id AND b.university_id = v_uni
      AND b.period_id = p_period_id AND b.status = 'active';
    IF v_old_day IS NULL OR v_old_day <> v_row->>'dayKey' THEN
      RAISE EXCEPTION 'restructure_stale';
    END IF;
  END LOOP;

  -- Snapshot everything before a single row is touched (used by undo).
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'slotMinutes', ep.slot_minutes, 'capacity', ep.slot_capacity,
      'startsAt', ep.starts_at, 'endsAt', ep.ends_at
    ),
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'location', s.location, 'startsAt', s.starts_at,
        'endsAt', s.ends_at, 'capacity', s.capacity, 'createdBy', s.created_by
      ) ORDER BY s.starts_at, s.id)
      FROM public.slots s WHERE s.university_id = v_uni AND s.period_id = p_period_id
    ), '[]'::jsonb),
    'seats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ss.id, 'slotId', ss.slot_id, 'seatNumber', ss.seat_number,
        'evaluatorId', ss.evaluator_id, 'createdBy', ss.created_by
      ) ORDER BY ss.slot_id, ss.seat_number)
      FROM public.slot_seats ss
      WHERE ss.university_id = v_uni AND ss.slot_id IN (
        SELECT s.id FROM public.slots s
        WHERE s.university_id = v_uni AND s.period_id = p_period_id
      )
    ), '[]'::jsonb),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'slotId', b.slot_id, 'seatId', b.seat_id,
        'evaluatorId', b.evaluator_id, 'status', b.status,
        'studentId', b.student_id, 'createdBy', b.created_by, 'createdAt', b.created_at
      ) ORDER BY b.created_at, b.id)
      FROM public.bookings b WHERE b.university_id = v_uni AND b.period_id = p_period_id
    ), '[]'::jsonb)
  ) INTO v_snapshot
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id;

  -- Publish the new defaults in the same transaction, before any seat numbered
  -- beyond the old capacity is assigned. Undo restores the snapshotted values.
  UPDATE public.evaluation_periods ep
     SET restructure_locked = true,
         slot_minutes = p_slot_minutes,
         slot_capacity = p_capacity
   WHERE ep.id = p_period_id;
  PERFORM set_config('metria.restructure', 'on', true);

  -- New slots + a full seat row per seat. Seat evaluators come straight from
  -- the previewed plan, so empty seats are ready for future bookings too.
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    FOR v_slot IN SELECT value FROM jsonb_array_elements(v_day->'newSlots') LOOP
      IF (v_slot->>'capacity')::integer <> p_capacity OR
         jsonb_array_length(v_slot->'seatEvaluators') <> p_capacity THEN
        RAISE EXCEPTION 'invalid_input';
      END IF;
      INSERT INTO public.slots(university_id, period_id, starts_at, ends_at, capacity, location, created_by)
      VALUES (v_uni, p_period_id, (v_slot->>'startsAt')::timestamptz,
              (v_slot->>'endsAt')::timestamptz, p_capacity,
              NULLIF(v_day->>'location', ''), v_profile)
      RETURNING id INTO v_slot_id;
      v_new_slot_ids := array_append(v_new_slot_ids, v_slot_id);
      v_any_slot := COALESCE(v_any_slot, v_slot_id);
      v_new_ids := v_new_ids || jsonb_build_object(v_slot->>'key', v_slot_id::text);
      IF NOT (v_first_by_day ? (v_day->>'key')) THEN
        v_first_by_day := v_first_by_day || jsonb_build_object(v_day->>'key', v_slot_id::text);
      END IF;

      FOR v_seat IN SELECT value FROM jsonb_array_elements(v_slot->'seatEvaluators') LOOP
        v_seat_no := (v_seat->>'seat')::integer;
        v_evaluator := NULLIF(v_seat->>'evaluatorId', '')::uuid;
        IF v_seat_no IS NULL OR v_seat_no < 1 OR v_seat_no > p_capacity THEN
          RAISE EXCEPTION 'invalid_input';
        END IF;
        IF v_evaluator IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.evaluation_period_evaluators e
          WHERE e.university_id = v_uni AND e.period_id = p_period_id AND e.id = v_evaluator
        ) THEN RAISE EXCEPTION 'invalid_evaluator'; END IF;
        IF v_evaluator IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_slot->'seatEvaluators') AS other
          WHERE (other.value->>'evaluatorId') = (v_seat->>'evaluatorId')
            AND (other.value->>'seat')::integer < v_seat_no
        ) THEN RAISE EXCEPTION 'restructure_evaluator_conflict'; END IF;
        INSERT INTO public.slot_seats(university_id, slot_id, seat_number, evaluator_id, created_by)
        VALUES (v_uni, v_slot_id, v_seat_no, v_evaluator, v_profile);
      END LOOP;
      v_slots_created := v_slots_created + 1;
    END LOOP;
  END LOOP;

  -- Phase 1: release every active seat before assigning final seats. The
  -- one-active-booking-per-seat index allows NULL, so even a reused seat id
  -- cannot collide halfway through the move.
  UPDATE public.bookings b
     SET seat_id = NULL, updated_at = now()
   WHERE b.university_id = v_uni AND b.period_id = p_period_id
     AND b.status = 'active';

  -- Phase 2: move every active booking exactly where the preview said it would.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
    v_booking_id := (v_row->>'bookingId')::uuid;
    v_slot_id := NULLIF(v_new_ids ->> (v_row->>'newSlotKey'), '')::uuid;
    v_seat_no := (v_row->>'newSeat')::integer;
    v_evaluator := NULLIF(v_row->>'evaluatorId', '')::uuid;
    IF v_slot_id IS NULL OR v_seat_no IS NULL OR v_seat_no < 1 OR v_seat_no > p_capacity THEN
      RAISE EXCEPTION 'restructure_stale';
    END IF;
    SELECT ss.id INTO v_seat_id FROM public.slot_seats ss
     WHERE ss.university_id = v_uni AND ss.slot_id = v_slot_id AND ss.seat_number = v_seat_no;
    IF v_seat_id IS NULL THEN RAISE EXCEPTION 'restructure_stale'; END IF;
    UPDATE public.bookings b
       SET slot_id = v_slot_id, seat_id = v_seat_id, evaluator_id = v_evaluator,
           updated_at = now()
     WHERE b.id = v_booking_id AND b.university_id = v_uni
       AND b.period_id = p_period_id AND b.status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'restructure_stale'; END IF;
  END LOOP;

  -- Historical (cancelled/completed) bookings also reference old slots; move
  -- them off those rows before deletion, without inventing new active seats.
  UPDATE public.bookings b
     SET slot_id = COALESCE(NULLIF(v_first_by_day ->> (
             (sl.starts_at AT TIME ZONE 'Asia/Karachi')::date::text), '')::uuid, v_any_slot),
         seat_id = NULL,
         evaluator_id = NULL,
         updated_at = now()
    FROM public.slots sl
   WHERE sl.university_id = b.university_id AND sl.id = b.slot_id
     AND b.university_id = v_uni AND b.period_id = p_period_id AND b.status <> 'active';

  DELETE FROM public.slot_seats ss
   WHERE ss.university_id = v_uni
     AND NOT (ss.slot_id = ANY(v_new_slot_ids))
     AND ss.slot_id IN (SELECT s.id FROM public.slots s
                        WHERE s.university_id = v_uni AND s.period_id = p_period_id);
  DELETE FROM public.slots s
   WHERE s.university_id = v_uni AND s.period_id = p_period_id
     AND NOT (s.id = ANY(v_new_slot_ids));

  INSERT INTO public.period_slot_restructures(
    university_id, period_id, created_by, slot_minutes, capacity, snapshot, applied_plan
  ) VALUES (v_uni, p_period_id, v_profile, p_slot_minutes, p_capacity, v_snapshot, p_plan)
  RETURNING id INTO v_audit_id;

  UPDATE public.evaluation_periods ep
     SET restructure_locked = false
   WHERE ep.id = p_period_id;
  PERFORM set_config('metria.restructure', 'off', true);

  RETURN jsonb_build_object(
    'ok', true, 'auditId', v_audit_id,
    'slotsCreated', v_slots_created, 'studentsMoved', array_length(v_seen, 1)
  );
END $$;

REVOKE ALL ON FUNCTION public.apply_slot_restructure(uuid, integer, integer, jsonb, boolean, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_slot_restructure(uuid, integer, integer, jsonb, boolean, boolean, jsonb) TO authenticated;
