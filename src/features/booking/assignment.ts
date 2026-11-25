/**
 * Pure evaluator-assignment rules for evaluation booking.
 *
 * This is the single, reusable specification of the round-robin rule used by
 * the app. `private.rebuild_slot_seats(p_period_id)` in the evaluator-assignment
 * migration is the transactional executor that writes the same result inside a
 * locked database transaction (Supabase's JS client cannot span multiple writes
 * in one transaction). Keeping the pure logic here lets the UI preview it and
 * the unit tests pin its behavior without a database.
 *
 * Seat order is always: slot (starts_at, id), then seat_number — the same order
 * the SQL function uses. Booked seats are immutable during redistribution; only
 * unbooked seats are assigned. Within one slot we prefer an evaluator that is
 * not already used by another seat of that slot; if none is free (capacity >
 * evaluator count) sharing is allowed and the rotation simply continues.
 */

export type EvaluatorRef = {
  id: string;
  /** Explicit A, B, C, ... order stored on the evaluator record. */
  position: number;
};

export type SlotRef = {
  id: string;
  starts_at: string;
  capacity: number;
};

export type SeatRef = {
  id: string;
  slot_id: string;
  seat_number: number;
  evaluator_id: string | null;
  booked: boolean;
};

export type SeatAssignment = {
  seatId: string;
  evaluatorId: string | null;
};

export type BookingRef = {
  id: string;
  seatId: string | null;
  status: string;
  /** Optional label ("Group 4"): a group still occupies exactly one seat. */
  label?: string;
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedEvaluatorIds(evaluators: readonly EvaluatorRef[]): string[] {
  return [...evaluators]
    .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
    .map((evaluator) => evaluator.id);
}

function orderedSlots(slots: readonly SlotRef[]): SlotRef[] {
  return [...slots].sort(
    (a, b) => compareText(a.starts_at, b.starts_at) || compareText(a.id, b.id),
  );
}

function seatsBySlot(seats: readonly SeatRef[]): Map<string, SeatRef[]> {
  const grouped = new Map<string, SeatRef[]>();
  for (const seat of seats) {
    const group = grouped.get(seat.slot_id) ?? [];
    group.push(seat);
    grouped.set(seat.slot_id, group);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => a.seat_number - b.seat_number || compareText(a.id, b.id));
  }
  return grouped;
}

/** Core walk shared by initial assignment and later redistribution. */
function walkSeats(
  slots: readonly SlotRef[],
  seats: readonly SeatRef[],
  evaluators: readonly EvaluatorRef[],
  preserveBooked: boolean,
): SeatAssignment[] {
  const evaluatorIds = orderedEvaluatorIds(evaluators);
  const evaluatorCount = evaluatorIds.length;
  const grouped = seatsBySlot(seats);
  const assignments: SeatAssignment[] = [];
  let cursor = 0;

  for (const slot of orderedSlots(slots)) {
    const usedInSlot = new Set<string>();
    const slotSeats = (grouped.get(slot.id) ?? []).filter(
      (seat) => seat.seat_number >= 1 && seat.seat_number <= slot.capacity,
    );

    for (const seat of slotSeats) {
      if (preserveBooked && seat.booked) {
        // A booked seat keeps its evaluator (and its place in the rotation).
        assignments.push({ seatId: seat.id, evaluatorId: seat.evaluator_id });
        if (seat.evaluator_id) usedInSlot.add(seat.evaluator_id);
      } else if (evaluatorCount === 0) {
        // Periods without evaluators keep the legacy behavior.
        assignments.push({ seatId: seat.id, evaluatorId: null });
      } else {
        let candidate: string | undefined;
        for (let offset = 0; offset < evaluatorCount; offset += 1) {
          const next = evaluatorIds[(cursor + offset) % evaluatorCount]!;
          if (!usedInSlot.has(next)) {
            candidate = next;
            break;
          }
        }
        // capacity > evaluator count: every evaluator is already used in this
        // slot, so sharing is allowed.
        candidate ??= evaluatorIds[cursor % evaluatorCount]!;
        assignments.push({ seatId: seat.id, evaluatorId: candidate });
        usedInSlot.add(candidate);
      }
      // Every seat advances the rotation, booked or not.
      cursor = (cursor + 1) % Math.max(evaluatorCount, 1);
    }
  }
  return assignments;
}

/** Initial assignment when slots are generated (no bookings exist yet). */
export function assignEvaluators(
  slots: readonly SlotRef[],
  seats: readonly SeatRef[],
  evaluators: readonly EvaluatorRef[],
): SeatAssignment[] {
  return walkSeats(slots, seats, evaluators, false);
}

/** Add an evaluator / rebuild after a change: booked seats never move. */
export function redistributeUnbookedSeats(
  slots: readonly SlotRef[],
  seats: readonly SeatRef[],
  evaluators: readonly EvaluatorRef[],
): SeatAssignment[] {
  return walkSeats(slots, seats, evaluators, true);
}

/** Merge assignments back into seat rows (keeps seat identity stable). */
export function applyAssignments(
  seats: readonly SeatRef[],
  assignments: readonly SeatAssignment[],
): SeatRef[] {
  const byId = new Map(
    assignments.map((assignment) => [assignment.seatId, assignment.evaluatorId]),
  );
  return seats.map((seat) =>
    byId.has(seat.id) ? { ...seat, evaluator_id: byId.get(seat.id) ?? null } : seat,
  );
}

/**
 * Non-blocking warning input: a slot with capacity > evaluator count must share
 * evaluators between seats. Returns the slot ids to warn about.
 */
export function sharedEvaluatorSlotIds(
  slots: readonly SlotRef[],
  evaluatorCount: number,
): string[] {
  if (evaluatorCount < 1) return [];
  return slots.filter((slot) => slot.capacity > evaluatorCount).map((slot) => slot.id);
}

/** Booked seats in a slot that ended up with the same evaluator (warning only). */
export function duplicateEvaluatorSeatIds(seats: readonly SeatRef[]): string[] {
  const duplicates: string[] = [];
  for (const group of seatsBySlot(seats).values()) {
    const seen = new Map<string, string>();
    for (const seat of group.filter((candidate) => candidate.booked && candidate.evaluator_id)) {
      const evaluatorId = seat.evaluator_id!;
      const previous = seen.get(evaluatorId);
      if (previous) duplicates.push(previous, seat.id);
      else seen.set(evaluatorId, seat.id);
    }
  }
  return [...new Set(duplicates)];
}

/** Single-booking reassignment: update one seat, report duplicate warnings. */
export function reassignSeatEvaluator(
  seats: readonly SeatRef[],
  seatId: string,
  evaluatorId: string,
): { seats: SeatRef[]; warningSeatIds: string[] } {
  const updated = seats.map((seat) =>
    seat.id === seatId ? { ...seat, evaluator_id: evaluatorId } : seat,
  );
  return { seats: updated, warningSeatIds: duplicateEvaluatorSeatIds(updated) };
}

/**
 * Bulk reassignment: only BOOKED seats of `fromId` move to `toId`; unbooked
 * seats are left for the round-robin redistribution (mirrors the SQL RPC).
 */
export function bulkReassignSeatEvaluator(
  seats: readonly SeatRef[],
  fromEvaluatorId: string,
  toEvaluatorId: string,
): SeatRef[] {
  return seats.map((seat) =>
    seat.booked && seat.evaluator_id === fromEvaluatorId
      ? { ...seat, evaluator_id: toEvaluatorId }
      : seat,
  );
}

export function bookedSeatCountForEvaluator(
  seats: readonly SeatRef[],
  evaluatorId: string,
): number {
  return seats.filter((seat) => seat.booked && seat.evaluator_id === evaluatorId).length;
}

/**
 * Active bookings consume exactly one seat each. Groups are represented by a
 * normal booking (one member books), so a "Group 4" booking still takes one
 * seat and can never occupy two. Duplicate ids would violate the database's
 * partial unique index on active bookings(seat_id).
 */
export function seatsUsedByBookings(bookings: readonly BookingRef[]): string[] {
  return bookings
    .filter((booking) => booking.status === "active" && booking.seatId !== null)
    .map((booking) => booking.seatId!);
}

export function duplicateBookingSeatIds(bookings: readonly BookingRef[]): string[] {
  const used = seatsUsedByBookings(bookings);
  return [...new Set(used.filter((seatId, index) => used.indexOf(seatId) !== index))];
}
