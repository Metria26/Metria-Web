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
  switch ((message ?? "").trim()) {
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
    case "not_found":
      return "notFound";
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
