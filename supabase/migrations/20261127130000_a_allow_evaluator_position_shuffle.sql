-- Fix: saving an edited evaluator roster failed with a check-constraint error.
--
-- save_period_evaluators() uses a two-phase position update to avoid collisions
-- with the unique (university_id, period_id, position) index:
--   UPDATE ... SET position = -position - 1   (temporary, inside the transaction)
-- but evaluation_period_evaluators_position_check only allowed 0..999, so any
-- save with existing evaluator rows failed. Client input validation still
-- requires digit-only positions, so persisted final positions remain 0..999;
-- the widened lower bound only permits the internal temporary shuffle.

ALTER TABLE public.evaluation_period_evaluators
  DROP CONSTRAINT IF EXISTS evaluation_period_evaluators_position_check;

ALTER TABLE public.evaluation_period_evaluators
  ADD CONSTRAINT evaluation_period_evaluators_position_check
  CHECK (position >= -1000 AND position < 1000);
