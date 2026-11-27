/**
 * Pure evaluation-booking rules shared by the UI and unit tests. The database
 * is authoritative (private.cancel_booking re-checks the same cutoff math);
 * these helpers only pick labels and disable buttons, and map stable error
 * codes (docs/04-backend/api-contracts.md) to i18n keys.
 */

export type CancelState = "open" | "cutoff" | "ended";

/** Cancellation closes cutoffHours before the slot start (D11). */
export function cancelCutoffAt(startsAt: string | Date, cutoffHours: number): Date {
  return new Date(new Date(startsAt).getTime() - cutoffHours * 3_600_000);
}

export function cancelState(
  startsAt: string | Date,
  cutoffHours: number,
  now: Date = new Date(),
): CancelState {
  const nowMs = now.getTime();
  if (nowMs >= new Date(startsAt).getTime()) return "ended";
  if (nowMs >= cancelCutoffAt(startsAt, cutoffHours).getTime()) return "cutoff";
  return "open";
}

/** Open seats for a slot, clamped at zero (overbooking is a bug, not a minus). */
export function remainingSeats(booked: number, capacity: number): number {
  return Math.max(capacity - booked, 0);
}

/** Stable RPC error codes → i18n keys (messages pass through verbatim). */
export function mapRpcError(message: string | null | undefined): string {
  const normalized = (message ?? "").trim();
  // PostgREST reports a missing/stale RPC with a schema-cache message rather
  // than a stable code — make that actionable instead of a generic failure.
  if (/could not find the function|schema cache/i.test(normalized)) return "serviceUnavailable";
  // Postgres constraint failures arrive as sentences, not our stable codes.
  // Map the common ones so a TA sees what to fix instead of a generic error.
  if (/duplicate key value violates unique constraint/i.test(normalized)) return "duplicate";
  if (/violates foreign key constraint/i.test(normalized)) return "invalidReference";
  if (/violates check constraint|violates not-null constraint/i.test(normalized))
    return "invalidInput";
  if (/permission denied|row-level security/i.test(normalized)) return "notAuthorized";
  if (/deadlock detected/i.test(normalized)) return "serviceUnavailable";
  switch (normalized) {
    case "slot_full":
      return "slotFull";
    case "already_booked":
      return "alreadyBooked";
    case "cutoff_passed":
      return "cutoffPassed";
    case "slot_ended":
      return "slotEnded";
    case "not_active":
      return "notActive";
    case "no_active_booking":
      return "noActiveBooking";
    case "not_found":
      return "notFound";
    case "invalid_input":
      return "invalidInput";
    case "slot_overlap":
      return "slotOverlap";
    case "too_many_bookings":
      return "tooManyBookings";
    case "outside_period":
      return "outsidePeriod";
    case "too_many_slots":
      return "tooManySlots";
    case "marks_protected":
      return "marksProtected";
    case "capacity_below_bookings":
      return "capacityBelowBookings";
    case "capacity_seat_conflict":
      return "capacitySeatConflict";
    case "seat_unavailable":
      return "seatUnavailable";
    case "evaluator_has_bookings":
      return "evaluatorHasBookings";
    case "invalid_evaluator":
      return "invalidEvaluator";
    case "invalid_reference":
      return "invalidReference";
    case "too_many_evaluators":
      return "tooManyEvaluators";
    case "evaluator_required":
      return "evaluatorRequired";
    case "restructure_in_progress":
      return "restructureInProgress";
    case "restructure_stale":
      return "restructureStale";
    case "restructure_evaluator_conflict":
      return "restructureEvaluatorConflict";
    case "no_restructure_to_undo":
      return "noRestructureToUndo";
    case "restructure_has_new_bookings":
      return "restructureHasNewBookings";
    case "forbidden":
    case "unauthenticated":
      return "notAuthorized";
    default:
      return "generic";
  }
}

/** Postgres write error codes → i18n keys (RLS 42501, unique, FK, CHECK). */
export function mapWriteError(code: string | null | undefined): string {
  switch ((code ?? "").trim()) {
    case "42501":
      return "notAuthorized";
    case "23505":
      return "duplicate";
    case "23503":
      return "invalidReference";
    case "23502":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}
