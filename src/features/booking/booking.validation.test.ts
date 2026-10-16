import { describe, expect, it } from "vitest";
import {
  bookingInputSchema,
  cancelBookingInputSchema,
  periodInputSchema,
  slotInputSchema,
} from "./contracts";
import { cancelCutoffAt, cancelState, mapRpcError, mapWriteError, remainingSeats } from "./rules";

/**
 * T-A006 unit boundary: form contracts (FormData strings → typed values) and
 * the pure rules behind the booking UI. The database re-checks every rule
 * (see the evaluation_booking migration and its pgTAP file).
 */

const validPeriod = {
  offeringId: "11111111-1111-4111-8111-111111111111",
  sectionId: "22222222-2222-4222-8222-222222222222",
  title: "Midterm evaluation",
  startsAt: "2030-01-07T09:00",
  endsAt: "2030-01-07T18:00",
  cutoffHours: "6",
};

describe("periodInputSchema", () => {
  it("accepts a well-formed period and coerces cutoff hours", () => {
    const parsed = periodInputSchema.safeParse(validPeriod);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutoffHours).toBe(6);
      expect(new Date(parsed.data.startsAt).getTime()).not.toBeNaN();
    }
  });

  it("rejects an ends-before-starts window", () => {
    const parsed = periodInputSchema.safeParse({
      ...validPeriod,
      endsAt: "2030-01-07T08:00",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message === "endsAfterStarts")).toBe(true);
    }
  });

  it("rejects cutoff hours outside 0..168 and non-integers", () => {
    expect(periodInputSchema.safeParse({ ...validPeriod, cutoffHours: "200" }).success).toBe(false);
    expect(periodInputSchema.safeParse({ ...validPeriod, cutoffHours: "-1" }).success).toBe(false);
    expect(periodInputSchema.safeParse({ ...validPeriod, cutoffHours: "6.5" }).success).toBe(false);
  });

  it("requires a valid offering and section uuid", () => {
    expect(periodInputSchema.safeParse({ ...validPeriod, offeringId: "" }).success).toBe(false);
    expect(periodInputSchema.safeParse({ ...validPeriod, sectionId: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});

describe("slotInputSchema", () => {
  const validSlot = {
    periodId: "33333333-3333-4333-8333-333333333333",
    startsAt: "2030-01-07T09:00",
    endsAt: "2030-01-07T09:15",
    capacity: "3",
    location: "CS Lab 1",
  };

  it("accepts a well-formed slot and coerces capacity", () => {
    const parsed = slotInputSchema.safeParse(validSlot);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.capacity).toBe(3);
      expect(parsed.data.location).toBe("CS Lab 1");
    }
  });

  it("defaults a missing location to an empty string", () => {
    const parsed = slotInputSchema.safeParse({ ...validSlot, location: undefined });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.location).toBe("");
  });

  it("rejects capacity below 1", () => {
    expect(slotInputSchema.safeParse({ ...validSlot, capacity: "0" }).success).toBe(false);
  });
});

describe("booking/cancel input schemas", () => {
  it("requires uuids for both booking ids", () => {
    expect(
      bookingInputSchema.safeParse({
        periodId: "33333333-3333-4333-8333-333333333333",
        slotId: "44444444-4444-4444-8444-444444444444",
      }).success,
    ).toBe(true);
    expect(
      bookingInputSchema.safeParse({
        periodId: "33333333-3333-4333-8333-333333333333",
        slotId: "",
      }).success,
    ).toBe(false);
  });

  it("requires both cancel ids", () => {
    expect(
      cancelBookingInputSchema.safeParse({
        bookingId: "55555555-5555-4555-8555-555555555555",
        periodId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(true);
    expect(
      cancelBookingInputSchema.safeParse({
        bookingId: "nope",
        periodId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(false);
  });
});

describe("cancelState (D11: cancellation closes cutoffHours before the slot)", () => {
  const start = "2030-01-07T12:00:00.000Z";

  it("is open well before the cutoff", () => {
    const now = new Date("2030-01-07T03:00:00.000Z"); // cutoff at 06:00Z
    expect(cancelState(start, 6, now)).toBe("open");
  });

  it("closes exactly at the cutoff boundary", () => {
    const now = new Date("2030-01-07T06:00:00.000Z"); // start - 6h
    expect(cancelState(start, 6, now)).toBe("cutoff");
  });

  it("stays closed inside the cutoff window", () => {
    const now = new Date("2030-01-07T10:30:00.000Z");
    expect(cancelState(start, 6, now)).toBe("cutoff");
  });

  it("is ended once the slot has started", () => {
    const now = new Date("2030-01-07T12:05:00.000Z");
    expect(cancelState(start, 6, now)).toBe("ended");
  });

  it("computes the cutoff instant from the slot start", () => {
    expect(cancelCutoffAt(start, 6).toISOString()).toBe("2030-01-07T06:00:00.000Z");
    expect(cancelCutoffAt(start, 0).toISOString()).toBe("2030-01-07T12:00:00.000Z");
  });
});

describe("remainingSeats", () => {
  it("clamps at zero and never goes negative", () => {
    expect(remainingSeats(1, 3)).toBe(2);
    expect(remainingSeats(3, 3)).toBe(0);
    expect(remainingSeats(4, 3)).toBe(0);
  });
});

describe("stable error code mapping (api-contracts.md)", () => {
  it("maps every booking RPC code to its i18n key", () => {
    expect(mapRpcError("slot_full")).toBe("slotFull");
    expect(mapRpcError("already_booked")).toBe("alreadyBooked");
    expect(mapRpcError("cutoff_passed")).toBe("cutoffPassed");
    expect(mapRpcError("slot_ended")).toBe("slotEnded");
    expect(mapRpcError("not_active")).toBe("notActive");
    expect(mapRpcError("not_found")).toBe("notFound");
    expect(mapRpcError("forbidden")).toBe("notAuthorized");
    expect(mapRpcError("unauthenticated")).toBe("notAuthorized");
    expect(mapRpcError("  slot_full  ")).toBe("slotFull");
  });

  it("falls back to generic for unknown or missing messages", () => {
    expect(mapRpcError("weird")).toBe("generic");
    expect(mapRpcError(undefined)).toBe("generic");
    expect(mapRpcError(null)).toBe("generic");
  });

  it("maps Postgres write codes to i18n keys", () => {
    expect(mapWriteError("42501")).toBe("notAuthorized");
    expect(mapWriteError("23505")).toBe("duplicate");
    expect(mapWriteError("23503")).toBe("invalidReference");
    expect(mapWriteError("23502")).toBe("invalidInput");
    expect(mapWriteError("23514")).toBe("invalidInput");
    expect(mapWriteError(undefined)).toBe("generic");
  });
});
