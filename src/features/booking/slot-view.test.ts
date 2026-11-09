import { describe, expect, it } from "vitest";
import { bookingSlotOverviewSchema } from "./overview";
import { groupSlotsByDay, slotStatus } from "./slot-view";
import { mapRpcError } from "./rules";
import type { BookingSlotOverview } from "./overview";

function slot(overrides: Partial<BookingSlotOverview>): BookingSlotOverview {
  return bookingSlotOverviewSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    starts_at: "2026-11-09T05:00:00.000Z",
    ends_at: "2026-11-09T05:30:00.000Z",
    capacity: 3,
    location: null,
    booked: 0,
    my_booking_id: null,
    ...overrides,
  });
}

const NOW = new Date("2026-11-09T00:00:00.000Z"); // 05:00 PKT, well before slots

describe("slot-view status", () => {
  it("marks a held slot as booked_by_me even when it still has seats", () => {
    expect(
      slotStatus(slot({ my_booking_id: "00000000-0000-4000-8000-000000000002" }), {
        now: NOW,
        cutoffHours: 6,
      }),
    ).toBe("booked_by_me");
  });

  it("marks free / almost_full / full by fill ratio", () => {
    const open = { now: NOW, cutoffHours: 6 };
    const later = "2026-11-09T20:00:00.000Z"; // outside any 6h cutoff from NOW
    expect(slotStatus(slot({ starts_at: later, booked: 1, capacity: 3 }), open)).toBe("free");
    expect(slotStatus(slot({ starts_at: later, booked: 3, capacity: 3 }), open)).toBe("full");
    expect(slotStatus(slot({ starts_at: later, booked: 4, capacity: 5 }), open)).toBe(
      "almost_full",
    );
    expect(slotStatus(slot({ starts_at: later, booked: 1, capacity: 1 }), open)).toBe("full");
  });

  it("shows cutoff_passed once the D11 cutoff is reached, overriding seats", () => {
    // Slot starts 05:00Z; cutoff 6h → 23:00Z the previous day.
    expect(
      slotStatus(slot({ booked: 0, capacity: 3, starts_at: "2026-11-09T05:00:00.000Z" }), {
        now: new Date("2026-11-08T23:00:00.000Z"),
        cutoffHours: 6,
      }),
    ).toBe("cutoff_passed");
    expect(
      slotStatus(slot({ booked: 0, capacity: 3, starts_at: "2026-11-09T05:00:00.000Z" }), {
        now: new Date("2026-11-08T22:59:59.000Z"),
        cutoffHours: 6,
      }),
    ).toBe("free");
  });
});

describe("slot-view day grouping", () => {
  it("groups by the Asia/Karachi day and sorts days + slots ascending", () => {
    const groups = groupSlotsByDay([
      slot({ id: "00000000-0000-4000-8000-000000000002", starts_at: "2026-11-09T06:00:00.000Z" }),
      slot({ id: "00000000-0000-4000-8000-000000000001", starts_at: "2026-11-09T05:00:00.000Z" }),
      // 19:00Z Nov 8 = 00:00 Nov 9 PKT → day "2026-11-09"... no: 19:00Z - 5h? +5h = 00:00 Nov 9.
      slot({ id: "00000000-0000-4000-8000-000000000003", starts_at: "2026-11-08T19:00:00.000Z" }),
      slot({ id: "00000000-0000-4000-8000-000000000004", starts_at: "2026-11-07T20:00:00.000Z" }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["2026-11-08", "2026-11-09"]);
    // 2026-11-07T20:00Z = 01:00 Nov 8 PKT; 19:00Z Nov 8 = 00:00 Nov 9 PKT —
    // the first slot of Nov 9 chronologically.
    expect(groups[0]!.slots.map((candidate) => candidate.id.slice(-1))).toEqual(["4"]);
    expect(groups[1]!.slots.map((candidate) => candidate.id.slice(-1))).toEqual(["3", "1", "2"]);
  });

  it("keeps single-day inputs in one group ordered by time", () => {
    const groups = groupSlotsByDay([
      slot({ id: "00000000-0000-4000-8000-000000000002", starts_at: "2026-11-09T06:00:00.000Z" }),
      slot({ id: "00000000-0000-4000-8000-000000000001", starts_at: "2026-11-09T05:00:00.000Z" }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.slots.map((candidate) => candidate.id.slice(-1))).toEqual(["1", "2"]);
  });
});

describe("mapRpcError", () => {
  it("maps the new stable codes added in 2026-11-08", () => {
    expect(mapRpcError("slot_overlap")).toBe("slotOverlap");
    expect(mapRpcError("outside_period")).toBe("outsidePeriod");
    expect(mapRpcError("too_many_slots")).toBe("tooManySlots");
    expect(mapRpcError("no_active_booking")).toBe("noActiveBooking");
    expect(mapRpcError("marks_protected")).toBe("marksProtected");
    expect(mapRpcError("capacity_below_bookings")).toBe("capacityBelowBookings");
    expect(mapRpcError("slot_full")).toBe("slotFull");
    expect(mapRpcError("cutoff_passed")).toBe("cutoffPassed");
    expect(mapRpcError("forbidden")).toBe("notAuthorized");
    expect(mapRpcError("42P01 whatever")).toBe("generic");
  });
});
