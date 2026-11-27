-- Fix: adding/editing evaluators could fail with a generic error because the
-- AFTER trigger on evaluation_period_evaluators ran the workload balancer in
-- the middle of save_period_evaluators' two-phase position shuffle (and of
-- other partial roster edits), i.e. against a temporarily inconsistent roster.
--
-- The balancer is still applied at the right time: every evaluator/slot RPC
-- finishes with private.rebuild_slot_seats(), which now ends with the same
-- balance. Booking changes keep their own AFTER trigger. Direct evaluator
-- writes are RLS-protected, and staff can use the Redistribute button.

DROP TRIGGER IF EXISTS trg_rebalance_evaluators ON public.evaluation_period_evaluators;
DROP FUNCTION IF EXISTS private.rebalance_evaluators_trigger();
