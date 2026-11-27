-- Staff-triggered full redistribution of evaluator workloads (2026-11-27).
--
-- The automatic balance trigger added in 20261126 already spreads bookings on
-- every booking/evaluator change. This exposes the same transactional walk as
-- an explicit staff action so a TA can rebalance on demand (for example after
-- importing bookings) and see the roster change immediately.

CREATE OR REPLACE FUNCTION private.redistribute_booking_evaluators(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_period public.evaluation_periods%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT ep.* INTO v_period FROM public.evaluation_periods ep
  WHERE ep.id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    private.is_platform_admin()
    OR (private.is_offering_staff(v_period.offering_id)
        AND private.has_permission(v_period.university_id, 'booking.manage_period'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Active bookings get one global round-robin; free seats follow the same
  -- rotation. Counts differ by at most one across the whole roster.
  PERFORM private.balance_period_evaluators(p_period_id);
END $$;

CREATE OR REPLACE FUNCTION public.redistribute_booking_evaluators(p_period_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$ SELECT private.redistribute_booking_evaluators(p_period_id) $$;

REVOKE EXECUTE ON FUNCTION private.redistribute_booking_evaluators(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.redistribute_booking_evaluators(uuid) TO authenticated;
