import { describe, expect, it } from "vitest";
import {
  MAX_BULK_SLOTS,
  bulkSlotsInputSchema,
  dateRangeInclusive,
  karachiWallClockToInstant,
  planBulkSlots,
} from "./bulk-slots";

/** Pipeline anchor: 10:30 Karachi is 05:30 UTC (fixed +05, DST-free). */
const DAY = "2026-11-09";

function plan(overrides: Partial<Parameters<typeof planBulkSlots>[0]> = {}) {
  return planBulkSlots({
    fromDate: DAY,
    toDate: DAY,
    dailyStart: "10:00",
    dailyEnd: "14:00",
    slotsPerDay: undefined,
    slotMinutes: 30,
    gapMinutes: 0,
    ...overrides,
  });
}

describe("bulk-slots planner", () => {
  it("converts Karachi wall time to the correct UTC instant", () => {
    const instant = karachiWallClockToInstant(DAY, "10:30");
    expect(instant.toISOString()).toBe("2026-11-09T05:30:00.000Z");
    // 00:30 PKT is 19:30Z the previous day.
    expect(karachiWallClockToInstant(DAY, "00:30").toISOString()).toBe("2026-11-08T19:30:00.000Z");
  });

  it("plans exact 30-minute slots filling a 10:00–14:00 window", () => {
    const result = plan();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(8);
    expect(result.perDayCount).toBe(8);
    expect(result.slots[0]!.startsAt.toISOString()).toBe("2026-11-09T05:00:00.000Z"); // 10:00 PKT
    expect(result.slots[7]!.endsAt.toISOString()).toBe("2026-11-09T09:00:00.000Z"); // 14:00 PKT
  });

  it("honours the gap between slots", () => {
    const result = plan({
      dailyStart: "10:00",
      dailyEnd: "10:30",
      slotMinutes: 10,
      gapMinutes: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // window 30m: slot 10m + gap 10m → starts 0, 20; last ends 30m exactly.
    expect(result.total).toBe(2);
    expect(result.slots[1]!.startsAt.toISOString()).toBe("2026-11-09T05:20:00.000Z");
    expect(result.slots[1]!.endsAt.toISOString()).toBe("2026-11-09T05:30:00.000Z");
  });

  it("rejects an end time before/too equal to start (boundary)", () => {
    expect(plan({ dailyEnd: "10:00" })).toMatchObject({ ok: false, error: "endAfterStart" });
    expect(plan({ dailyStart: "14:00", dailyEnd: "10:00" })).toMatchObject({
      ok: false,
      error: "endAfterStart",
    });
  });

  it("moves the last slot out when it cannot finish inside the window", () => {
    // window eats exactly one slot short: 10:00–10:25 with 30m slots.
    expect(plan({ dailyEnd: "10:25" })).toMatchObject({ ok: false, error: "noSlotsFitDay" });
  });

  it("supports the slots-per-day alternative input", () => {
    const result = plan({ dailyEnd: undefined, slotsPerDay: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(4);
    // 10:00 + 4 × 30 min = 12:00 PKT end (07:00Z).
    expect(result.slots[3]!.endsAt.toISOString()).toBe("2026-11-09T07:00:00.000Z");
  });

  it("rejects inverted date ranges and spreads across days", () => {
    expect(plan({ toDate: "2026-11-08" })).toMatchObject({ ok: false, error: "fromAfterTo" });
    const multi = plan({ toDate: "2026-11-10" });
    expect(multi.ok).toBe(true);
    if (multi.ok) {
      expect(multi.days).toEqual(["2026-11-09", "2026-11-10"]);
      expect(multi.total).toBe(16);
    }
  });

  it("requires either an end time or a slot count", () => {
    expect(plan({ dailyEnd: undefined, slotsPerDay: undefined })).toMatchObject({
      ok: false,
      error: "endOrCountRequired",
    });
  });

  it("caps a huge request at the 500-slot limit", () => {
    // 64 days × 8 slots = 512 > 500 → reject.
    const big = plan({
      fromDate: "2026-01-01",
      toDate: "2026-04-15",
      slotsPerDay: 8,
      dailyEnd: undefined,
    });
    expect(big).toMatchObject({ ok: false, error: "tooManySlots" });
    // 50 days × 8 = 400 → accepted.
    const ok = plan({
      fromDate: "2026-01-01",
      toDate: "2026-02-19",
      slotsPerDay: 8,
      dailyEnd: undefined,
    });
    expect(ok).toMatchObject({ ok: true, total: 400 });
    expect(MAX_BULK_SLOTS).toBe(500);
  });

  it("dateRangeInclusive is inclusive and bounded", () => {
    expect(dateRangeInclusive("2026-11-08", "2026-11-10")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
    expect(dateRangeInclusive("2026-01-01", "2030-01-01").length).toBeLessThanOrEqual(500);
  });
});

describe("bulkSlotsInputSchema", () => {
  it("accepts the count mode with empty end time", () => {
    const parsed = bulkSlotsInputSchema.safeParse({
      periodId: "00000000-0000-4000-8000-000000000000",
      fromDate: DAY,
      toDate: DAY,
      dailyStart: "10:00",
      dailyEnd: "",
      slotsPerDay: "4",
      slotMinutes: "30",
      gapMinutes: "",
      capacity: "2",
    });
    expect(parsed.success).toBe(true);
  });

  it("coerces numeric strings and defaults the gap to 0", () => {
    const parsed = bulkSlotsInputSchema.safeParse({
      periodId: "00000000-0000-4000-8000-000000000000",
      fromDate: DAY,
      toDate: DAY,
      dailyStart: "09:00",
      dailyEnd: "11:00",
      slotMinutes: "30",
      capacity: "3",
    });
    expect(parsed.success && parsed.data.gapMinutes).toBe(0);
  });

  it("rejects a zero slot duration and non-positive capacity", () => {
    expect(
      bulkSlotsInputSchema.safeParse({
        periodId: "00000000-0000-4000-8000-000000000000",
        fromDate: DAY,
        toDate: DAY,
        dailyStart: "09:00",
        dailyEnd: "11:00",
        slotMinutes: "0",
        capacity: "3",
      }).success,
    ).toBe(false);
    expect(
      bulkSlotsInputSchema.safeParse({
        periodId: "00000000-0000-4000-8000-000000000000",
        fromDate: DAY,
        toDate: DAY,
        dailyStart: "09:00",
        dailyEnd: "11:00",
        slotMinutes: "30",
        capacity: "0",
      }).success,
    ).toBe(false);
  });
});
