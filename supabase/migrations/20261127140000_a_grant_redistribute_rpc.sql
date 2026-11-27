-- Fix: the Redistribute button returned "You do not have permission" even for
-- staff who can manage bookings. The public SQL wrapper calls the guarded
-- private function as the caller, so the caller needs EXECUTE on it — the same
-- pattern used by save_period_evaluators, reassign_booking_evaluator, etc.
-- The private function still performs its own unauthenticated/forbidden checks.

GRANT EXECUTE ON FUNCTION private.redistribute_booking_evaluators(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.redistribute_booking_evaluators(uuid) FROM anon;
