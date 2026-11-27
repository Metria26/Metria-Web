-- The restructure snapshot/undo RPCs record who created each slot seat, just
-- like slots and bookings. The original slot_seats table omitted that column,
-- so apply failed with "column ss.created_by does not exist" while snapshotting
-- the old layout. Add the nullable audit column; existing rows stay valid and
-- undo restores them with a NULL creator.

ALTER TABLE public.slot_seats
  ADD COLUMN IF NOT EXISTS created_by uuid;
