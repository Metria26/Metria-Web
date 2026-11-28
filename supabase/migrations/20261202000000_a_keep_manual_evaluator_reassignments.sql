-- Manual evaluator reassignment inside a slot was being undone by two automatic
-- paths:
--   1. trg_rebalance_bookings fired on every booking insert, status change or
--      deletion and called balance_period_evaluators(), which reassigns ALL
--      booked seats. A new student therefore reset a hand-swapped slot back to
--      the plain A,B,C,D rotation.
--   2. private.rebuild_slot_seats() ended with the same balancer, so slot
--      generation, capacity edits and evaluator edits also reset bookings.
--
-- Booked seats are now immutable during normal seat rebuilds and booking
-- changes. The staff "Redistribute" button still calls
-- balance_period_evaluators() explicitly when workload balancing is wanted.

BEGIN;

DROP TRIGGER IF EXISTS trg_rebalance_bookings ON public.bookings;
DROP FUNCTION IF EXISTS private.rebalance_bookings_trigger();

CREATE OR REPLACE FUNCTION private.rebuild_slot_seats(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- rebuild_slot_seats_base() creates/removes seats and assigns only unbooked
  -- seats; booked seats keep the evaluator staff chose for them.
  PERFORM private.rebuild_slot_seats_base(p_period_id);
END $$;

REVOKE EXECUTE ON FUNCTION private.rebuild_slot_seats(uuid) FROM PUBLIC, authenticated, anon;

COMMIT;
