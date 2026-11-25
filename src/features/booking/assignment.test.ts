import { describe, expect, it } from "vitest";
import {
  applyAssignments,
  assignEvaluators,
  bookedSeatCountForEvaluator,
  bulkReassignSeatEvaluator,
  duplicateBookingSeatIds,
  duplicateEvaluatorSeatIds,
  redistributeUnbookedSeats,
  reassignSeatEvaluator,
  seatsUsedByBookings,
  sharedEvaluatorSlotIds,
  type BookingRef,
  type EvaluatorRef,
  type SeatRef,
  type SlotRef,
} from "./assignment";

/**
 * Unit boundary for the evaluator-assignment rule. The SQL migration mirrors
 * this walk inside a locked transaction; these tests pin the shared semantics.
 */
const evaluator = (id: string, position: number): EvaluatorRef => ({ id, position });
const slot = (id: string, startsAt: string, capacity: number): SlotRef => ({
  id,
  starts_at: startsAt,
  capacity,
});
const seat = (
  id: string,
  slotId: string,
  seatNumber: number,
  evaluatorId: string | null = null,
  booked = false,
): SeatRef => ({
  id,
  slot_id: slotId,
  seat_number: seatNumber,
  evaluator_id: evaluatorId,
  booked,
});

const ABC = [evaluator("A", 0), evaluator("B", 1), evaluator("C", 2)];

function generateSlots(count: number, capacity: number): SlotRef[] {
  return Array.from({ length: count }, (_, index) =>
    slot(`slot-${index + 1}`, `2030-01-01T${String(9 + index).padStart(2, "0")}:00`, capacity),
  );
}

function generateSeats(slots: readonly SlotRef[]): SeatRef[] {
  return slots.flatMap((current) =>
    Array.from({ length: current.capacity }, (_, index) =>
      seat(`${current.id}-seat-${index + 1}`, current.id, index + 1),
    ),
  );
}

function assignmentMap(
  slots: readonly SlotRef[],
  seats: readonly SeatRef[],
  evaluators: readonly EvaluatorRef[],
): Map<string, string | null> {
  const assignments = redistributeUnbookedSeats(slots, seats, evaluators);
  return new Map(assignments.map((assignment) => [assignment.seatId, assignment.evaluatorId]));
}

describe("evaluator round-robin assignment", () => {
  it("rotates A, B, C across capacity-1 slots", () => {
    const slots = generateSlots(5, 1);
    const seats = generateSeats(slots);
    const map = assignmentMap(slots, seats, ABC);
    expect(slots.map((current) => map.get(`${current.id}-seat-1`))).toEqual([
      "A",
      "B",
      "C",
      "A",
      "B",
    ]);
  });

  it("keeps every seat in a slot distinct when capacity equals evaluator count", () => {
    const slots = generateSlots(3, 3);
    const seats = generateSeats(slots);
    const map = assignmentMap(slots, seats, ABC);
    const rows = slots.map((current) =>
      [1, 2, 3].map((number) => map.get(`${current.id}-seat-${number}`)),
    );
    expect(rows).toEqual([
      ["A", "B", "C"],
      ["A", "B", "C"],
      ["A", "B", "C"],
    ]);
    for (const row of rows) expect(new Set(row).size).toBe(3);
  });

  it("continues the global rotation across slots (slot 1 A,B / slot 2 C,A / slot 3 B,C)", () => {
    const slots = generateSlots(3, 2);
    const seats = generateSeats(slots);
    const map = assignmentMap(slots, seats, ABC);
    expect(slots.map((current) => [1, 2].map((n) => map.get(`${current.id}-seat-${n}`)))).toEqual([
      ["A", "B"],
      ["C", "A"],
      ["B", "C"],
    ]);
    const perSlot = generateSlots(3, 2).map((current) =>
      [1, 2].map((n) => map.get(`${current.id}-seat-${n}`)),
    );
    for (const row of perSlot) expect(new Set(row).size).toBe(2);
  });

  it("shares evaluators as evenly as possible when capacity exceeds the count", () => {
    const slots = [slot("slot-1", "2030-01-01T09:00", 5)];
    const seats = generateSeats(slots);
    const map = assignmentMap(slots, seats, ABC);
    const assigned = [1, 2, 3, 4, 5].map((n) => map.get(`slot-1-seat-${n}`));
    expect(assigned).toEqual(["A", "B", "C", "A", "B"]);
    expect(sharedEvaluatorSlotIds(slots, ABC.length)).toEqual(["slot-1"]);
    expect(sharedEvaluatorSlotIds(slots, 0)).toEqual([]);
  });

  it("leaves every seat unassigned for a period with no evaluators (legacy behavior)", () => {
    const slots = generateSlots(2, 2);
    const seats = generateSeats(slots);
    const map = assignmentMap(slots, seats, []);
    expect([...map.values()].every((value) => value === null)).toBe(true);
    expect(assignEvaluators(slots, seats, [])).toHaveLength(4);
  });
});

describe("redistribution after adding an evaluator", () => {
  const slots = generateSlots(2, 2);
  const originalSeats = [
    seat("s1", "slot-1", 1, "A", true),
    seat("s2", "slot-1", 2, "B"),
    seat("s3", "slot-2", 1, "A"),
    seat("s4", "slot-2", 2, "B"),
  ];

  it("preserves booked seats, redistributes unbooked seats and keeps the slot distinct", () => {
    const withC = [...ABC, evaluator("D", 3)];
    const map = assignmentMap(slots, originalSeats, withC);
    expect(map.get("s1")).toBe("A"); // booked seat never changes
    expect(map.get("s2")).toBe("B");
    expect(map.get("s3")).toBe("C");
    expect(map.get("s4")).toBe("D");

    const updated = applyAssignments(
      originalSeats,
      redistributeUnbookedSeats(slots, originalSeats, withC),
    );
    expect(duplicateEvaluatorSeatIds(updated)).toEqual([]);
  });

  it("is idempotent — running it twice gives the same result", () => {
    const first = applyAssignments(
      originalSeats,
      redistributeUnbookedSeats(slots, originalSeats, ABC),
    );
    const second = applyAssignments(first, redistributeUnbookedSeats(slots, first, ABC));
    expect(second).toEqual(first);
  });

  it("skips an evaluator already used by a booked seat in the same slot", () => {
    const bookedWithB = [seat("s1", "slot-1", 1, "B", true), seat("s2", "slot-1", 2, null)];
    const map = assignmentMap([slots[0]!], bookedWithB, ABC);
    expect(map.get("s1")).toBe("B");
    expect(map.get("s2")).toBe("C"); // A would come first, but B is taken; C is free
  });
});

describe("removal and bulk reassignment", () => {
  const seats = [
    seat("s1", "slot-1", 1, "B", true),
    seat("s2", "slot-1", 2, "A", true),
    seat("s3", "slot-2", 1, "B"),
  ];

  it("moves all of B's bookings to D before removing B", () => {
    const moved = bulkReassignSeatEvaluator(seats, "B", "D");
    expect(bookedSeatCountForEvaluator(moved, "B")).toBe(0);
    expect(bookedSeatCountForEvaluator(moved, "D")).toBe(1);
    // Only booked seats move; the unbooked s3 is handled by redistribution.
    expect(moved.find((current) => current.id === "s3")?.evaluator_id).toBe("B");
  });

  it("redistributes the remaining unbooked seats with the updated evaluator list", () => {
    const moved = bulkReassignSeatEvaluator(seats, "B", "D");
    const remaining = [evaluator("A", 0), evaluator("C", 1), evaluator("D", 2)];
    const slots = generateSlots(2, 2);
    const map = assignmentMap(slots, moved, remaining);
    expect(map.get("s1")).toBe("D"); // reassigned booking stays with D
    expect(map.get("s2")).toBe("A"); // booked seat stays with A
    expect(map.get("s3")).toBe("D"); // unbooked seat follows the new rotation
  });

  it("warns (without blocking) when a manual reassignment duplicates an evaluator in a slot", () => {
    const result = reassignSeatEvaluator(seats, "s2", "B");
    expect(duplicateEvaluatorSeatIds(result.seats)).toContain("s1");
    expect(duplicateEvaluatorSeatIds(result.seats)).toContain("s2");
  });
});

describe("one booking = one seat (individual and group-with-one-booker)", () => {
  it("a single individual booking consumes exactly one seat", () => {
    const bookings: BookingRef[] = [
      { id: "b1", seatId: "s1", status: "active" },
      { id: "b2", seatId: "s2", status: "cancelled" },
    ];
    expect(seatsUsedByBookings(bookings)).toEqual(["s1"]);
    expect(duplicateBookingSeatIds(bookings)).toEqual([]);
  });

  it("a group booking placed by one member also consumes exactly one seat", () => {
    const bookings: BookingRef[] = [{ id: "b1", seatId: "s1", status: "active", label: "Group 4" }];
    expect(seatsUsedByBookings(bookings)).toEqual(["s1"]);
    expect(seatsUsedByBookings(bookings)).toHaveLength(1);
  });

  it("two active bookings can never share a seat", () => {
    const bookings: BookingRef[] = [
      { id: "b1", seatId: "s1", status: "active", label: "Group 4" },
      { id: "b2", seatId: "s1", status: "active", label: "Ali" },
    ];
    expect(duplicateBookingSeatIds(bookings)).toEqual(["s1"]);
  });
});
