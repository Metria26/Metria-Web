-- Restructure an evaluation period's slots without asking students to rebook.
--
-- The admin previews a plan in the app; this migration adds the owner/admin-only
-- RPCs that (a) expose the current roster, (b) apply the previewed plan in one
-- transaction and (c) undo it while no new bookings exist. Old slot/seat/booking
-- rows are snapshotted as JSON before anything is deleted so undo restores the
-- exact previous state, including ids.

-- ---------------------------------------------------------------------------
-- 1. Period settings, restructuring flag and undo audit
-- ---------------------------------------------------------------------------

ALTER TABLE public.evaluation_periods
  ADD COLUMN IF NOT EXISTS slot_minutes integer,
  ADD COLUMN IF NOT EXISTS slot_capacity integer,
  ADD COLUMN IF NOT EXISTS restructure_locked boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluation_periods_slot_minutes_check') THEN
    ALTER TABLE public.evaluation_periods ADD CONSTRAINT evaluation_periods_slot_minutes_check
      CHECK (slot_minutes IS NULL OR (slot_minutes >= 1 AND slot_minutes <= 240));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluation_periods_slot_capacity_check') THEN
    ALTER TABLE public.evaluation_periods ADD CONSTRAINT evaluation_periods_slot_capacity_check
      CHECK (slot_capacity IS NULL OR (slot_capacity >= 1 AND slot_capacity <= 500));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.period_slot_restructures(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL,
  period_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by uuid,
  slot_minutes integer NOT NULL,
  capacity integer NOT NULL,
  snapshot jsonb NOT NULL,
  applied_plan jsonb NOT NULL,
  CONSTRAINT period_slot_restructures_pkey PRIMARY KEY(id),
  CONSTRAINT period_slot_restructures_tenant_id_key UNIQUE(university_id,id),
  CONSTRAINT period_slot_restructures_university_fk FOREIGN KEY(university_id)
    REFERENCES public.universities(id) ON DELETE RESTRICT,
  CONSTRAINT period_slot_restructures_period_tenant_fk FOREIGN KEY(university_id,period_id)
    REFERENCES public.evaluation_periods(university_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS period_slot_restructures_period_idx
  ON public.period_slot_restructures(university_id,period_id,applied_at DESC);
REVOKE ALL ON public.period_slot_restructures FROM PUBLIC, anon, authenticated;

-- Block ordinary booking writes while an apply/undo is running. The functions
-- set a transaction-local bypass because they move bookings themselves.
CREATE OR REPLACE FUNCTION private.guard_booking_restructure()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('metria.restructure', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.evaluation_periods ep
    WHERE ep.id = NEW.period_id AND ep.restructure_locked
  ) THEN
    RAISE EXCEPTION 'restructure_in_progress';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_restructure_guard ON public.bookings;
CREATE TRIGGER bookings_restructure_guard
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.guard_booking_restructure();

-- ---------------------------------------------------------------------------
-- 2. Owner/admin gate and read model
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_restructure_period(p_period_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(private.is_platform_admin(), false)
    OR EXISTS (
      SELECT 1
      FROM public.evaluation_periods ep
      JOIN public.profiles p ON p.id = ep.created_by
      WHERE ep.id = p_period_id AND p.auth_user_id = (SELECT auth.uid())
    )
$$;

CREATE OR REPLACE FUNCTION public.restructure_period_data(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uni uuid;
  v_minutes integer;
  v_capacity integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.can_restructure_period(p_period_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.university_id, ep.slot_minutes, ep.slot_capacity
    INTO v_uni, v_minutes, v_capacity
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id;
  IF v_uni IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  v_minutes := COALESCE(v_minutes, (
    SELECT round(avg(extract(epoch FROM (s.ends_at - s.starts_at)) / 60))::integer
    FROM public.slots s WHERE s.university_id = v_uni AND s.period_id = p_period_id
  ), 10);
  v_capacity := COALESCE(v_capacity, (
    SELECT max(s.capacity) FROM public.slots s
    WHERE s.university_id = v_uni AND s.period_id = p_period_id
  ), 1);

  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'id', ep.id,
      'title', ep.title,
      'slotMinutes', v_minutes,
      'capacity', v_capacity
    ),
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'capacity', s.capacity, 'location', s.location
      ) ORDER BY s.starts_at, s.id)
      FROM public.slots s
      WHERE s.university_id = v_uni AND s.period_id = p_period_id
    ), '[]'::jsonb),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bookingId', b.id, 'studentId', b.student_id,
        'studentName', pr.display_name, 'rollNo', pr.roll_no, 'email', pr.email,
        'slotId', b.slot_id, 'slotStartsAt', sl.starts_at,
        'seatNumber', ss.seat_number, 'evaluatorId', b.evaluator_id,
        'evaluatorName', ev.name, 'createdAt', b.created_at
      ) ORDER BY sl.starts_at, ss.seat_number NULLS LAST, b.created_at, b.id)
      FROM public.bookings b
      JOIN public.slots sl ON sl.university_id = b.university_id AND sl.id = b.slot_id
      JOIN public.profiles pr ON pr.id = b.student_id
      LEFT JOIN public.slot_seats ss ON ss.university_id = b.university_id AND ss.id = b.seat_id
      LEFT JOIN public.evaluation_period_evaluators ev
        ON ev.university_id = b.university_id AND ev.id = b.evaluator_id
      WHERE b.university_id = v_uni AND b.period_id = p_period_id AND b.status = 'active'
    ), '[]'::jsonb),
    'evaluators', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'position', e.position)
                       ORDER BY e.position, e.id)
      FROM public.evaluation_period_evaluators e
      WHERE e.university_id = v_uni AND e.period_id = p_period_id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id;
  RETURN v_result;
END $$;

/** Defaults for the staff bulk-slot generator after a restructure. */
CREATE OR REPLACE FUNCTION public.period_slot_defaults(p_period_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'slotMinutes', COALESCE(ep.slot_minutes, 10),
    'capacity', COALESCE(ep.slot_capacity, 3)
  )
  FROM public.evaluation_periods ep WHERE ep.id = p_period_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Apply the previewed plan
-- ---------------------------------------------------------------------------

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

  UPDATE public.evaluation_periods ep
     SET restructure_locked = true WHERE ep.id = p_period_id;
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
  END FOR;

  -- Move every active booking exactly where the preview said it would go.
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
     SET slot_minutes = p_slot_minutes, slot_capacity = p_capacity,
         restructure_locked = false
   WHERE ep.id = p_period_id;
  PERFORM set_config('metria.restructure', 'off', true);

  RETURN jsonb_build_object(
    'ok', true, 'auditId', v_audit_id,
    'slotsCreated', v_slots_created, 'studentsMoved', array_length(v_seen, 1)
  );
END $$;

-- ---------------------------------------------------------------------------
-- 4. Undo the last restructure (only while no bookings changed)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_slot_restructure(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uni uuid;
  v_profile uuid;
  v_audit public.period_slot_restructures%ROWTYPE;
  v_slot jsonb;
  v_seat jsonb;
  v_booking jsonb;
  v_snapshot_ids uuid[];
  v_current_ids uuid[];
  v_slot_id uuid;
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

  SELECT * INTO v_audit FROM public.period_slot_restructures a
   WHERE a.university_id = v_uni AND a.period_id = p_period_id
   ORDER BY a.applied_at DESC, a.created_at DESC
   LIMIT 1 FOR UPDATE;
  IF v_audit.id IS NULL OR v_audit.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_restructure_to_undo';
  END IF;

  v_snapshot_ids := ARRAY(
    SELECT (value->>'id')::uuid FROM jsonb_array_elements(v_audit.snapshot->'bookings')
  );
  v_current_ids := ARRAY(
    SELECT b.id FROM public.bookings b
    WHERE b.university_id = v_uni AND b.period_id = p_period_id
  );
  IF EXISTS (SELECT 1 FROM unnest(v_current_ids) AS id WHERE id <> ALL(v_snapshot_ids))
     OR EXISTS (SELECT 1 FROM unnest(v_snapshot_ids) AS id WHERE id <> ALL(v_current_ids)) THEN
    RAISE EXCEPTION 'restructure_has_new_bookings';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evaluation_periods ep
             WHERE ep.id = p_period_id AND ep.restructure_locked) THEN
    RAISE EXCEPTION 'restructure_in_progress';
  END IF;

  UPDATE public.evaluation_periods ep
     SET restructure_locked = true WHERE ep.id = p_period_id;
  PERFORM set_config('metria.restructure', 'on', true);

  FOR v_slot IN SELECT value FROM jsonb_array_elements(v_audit.snapshot->'slots') LOOP
    INSERT INTO public.slots(id, university_id, period_id, starts_at, ends_at, capacity, location, created_by, created_at)
    VALUES ((v_slot->>'id')::uuid, v_uni, p_period_id, (v_slot->>'startsAt')::timestamptz,
            (v_slot->>'endsAt')::timestamptz, (v_slot->>'capacity')::integer,
            NULLIF(v_slot->>'location', ''),
            NULLIF(v_slot->>'createdBy', '')::uuid, COALESCE((v_slot->>'createdAt')::timestamptz, now()))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  -- created_at was not snapshotted for slots; keep the touch trigger's now().
  FOR v_seat IN SELECT value FROM jsonb_array_elements(v_audit.snapshot->'seats') LOOP
    INSERT INTO public.slot_seats(id, university_id, slot_id, seat_number, evaluator_id, created_by)
    VALUES ((v_seat->>'id')::uuid, v_uni, (v_seat->>'slotId')::uuid,
            (v_seat->>'seatNumber')::integer, NULLIF(v_seat->>'evaluatorId', '')::uuid,
            NULLIF(v_seat->>'createdBy', '')::uuid)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- Clear seat links first so restoring swapped seats cannot hit the partial
  -- one-active-booking-per-seat index mid-loop.
  UPDATE public.bookings b SET seat_id = NULL
   WHERE b.university_id = v_uni AND b.period_id = p_period_id;
  FOR v_booking IN SELECT value FROM jsonb_array_elements(v_audit.snapshot->'bookings') LOOP
    -- Status is never touched: apply never changes it, and assigning the
    -- column would fire the evaluator-rebalance trigger on a finished undo.
    UPDATE public.bookings b
       SET slot_id = (v_booking->>'slotId')::uuid,
           seat_id = NULLIF(v_booking->>'seatId', '')::uuid,
           evaluator_id = NULLIF(v_booking->>'evaluatorId', '')::uuid,
           updated_at = now()
     WHERE b.id = (v_booking->>'id')::uuid AND b.university_id = v_uni;
  END LOOP;

  DELETE FROM public.slot_seats ss
   WHERE ss.university_id = v_uni AND ss.slot_id NOT IN (
     SELECT (value->>'id')::uuid FROM jsonb_array_elements(v_audit.snapshot->'slots')
   );
  DELETE FROM public.slots s
   WHERE s.university_id = v_uni AND s.period_id = p_period_id
     AND s.id NOT IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(v_audit.snapshot->'slots'));

  UPDATE public.evaluation_periods ep
     SET slot_minutes = NULLIF(v_audit.snapshot->'period'->>'slotMinutes', '')::integer,
         slot_capacity = NULLIF(v_audit.snapshot->'period'->>'capacity', '')::integer,
         restructure_locked = false
   WHERE ep.id = p_period_id;
  UPDATE public.period_slot_restructures a
     SET undone_at = now(), undone_by = v_profile
   WHERE a.id = v_audit.id;
  PERFORM set_config('metria.restructure', 'off', true);

  RETURN jsonb_build_object('ok', true, 'undoneId', v_audit.id);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION private.guard_booking_restructure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_restructure_period(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restructure_period_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.period_slot_defaults(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_slot_restructure(uuid, integer, integer, jsonb, boolean, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_slot_restructure(uuid) TO authenticated;
