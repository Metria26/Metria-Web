import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcFailure } from "./action-errors";
import { restructureApplyInputSchema } from "./contracts";
import {
  defaultDayInputs,
  previewRestructure,
  restructureRpcPayload,
  undoBookingGuard,
  type RestructureData,
  type RestructureOptions,
} from "./restructure";

const MONDAY = "2026-11-30";
const WEDNESDAY = "2026-12-02";

function iso(day: string, time: string): string {
  return `${day}T${time}:00+05:00`;
}

function utc(day: string, time: string): string {
  return new Date(iso(day, time)).toISOString();
}

function fixture(): RestructureData {
  const slots = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      starts_at: iso(MONDAY, "13:10"),
      ends_at: iso(MONDAY, "13:20"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      starts_at: iso(MONDAY, "13:20"),
      ends_at: iso(MONDAY, "13:30"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      starts_at: iso(MONDAY, "13:30"),
      ends_at: iso(MONDAY, "13:40"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      starts_at: iso(MONDAY, "13:40"),
      ends_at: iso(MONDAY, "13:50"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      starts_at: iso(MONDAY, "13:50"),
      ends_at: iso(MONDAY, "14:00"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      starts_at: iso(MONDAY, "14:00"),
      ends_at: iso(MONDAY, "14:10"),
      capacity: 3,
      location: "Lab A",
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      starts_at: iso(WEDNESDAY, "13:00"),
      ends_at: iso(WEDNESDAY, "13:10"),
      capacity: 3,
      location: "Lab B",
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      starts_at: iso(WEDNESDAY, "13:10"),
      ends_at: iso(WEDNESDAY, "13:20"),
      capacity: 3,
      location: "Lab B",
    },
  ];
  const students = Array.from({ length: 13 }, (_, index) => ({
    bookingId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    studentId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
    studentName: `Student ${index + 1}`,
    rollNo: `R${index + 1}`,
    email: `student${index + 1}@example.com`,
    slotId: slots[Math.floor(index / 3)]!.id,
    slotStartsAt: slots[Math.floor(index / 3)]!.starts_at,
    seatNumber: (index % 3) + 1,
    evaluatorId: null,
    evaluatorName: null,
    createdAt: new Date(Date.parse(iso(MONDAY, "09:00")) + index * 1000).toISOString(),
  }));
  const wednesday = Array.from({ length: 6 }, (_, index) => ({
    bookingId: `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}`,
    studentId: `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, "0")}`,
    studentName: `Wednesday ${index + 1}`,
    rollNo: `W${index + 1}`,
    email: `wed${index + 1}@example.com`,
    slotId: slots[6 + Math.floor(index / 3)]!.id,
    slotStartsAt: slots[6 + Math.floor(index / 3)]!.starts_at,
    seatNumber: (index % 3) + 1,
    evaluatorId: null,
    evaluatorName: null,
    createdAt: new Date(Date.parse(iso(WEDNESDAY, "09:00")) + index * 1000).toISOString(),
  }));
  return {
    period: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Midterm evaluation",
      slotMinutes: 10,
      capacity: 3,
    },
    slots,
    students: [...students, ...wednesday],
    evaluators: [],
  };
}

function options(overrides: Partial<RestructureOptions> = {}): RestructureOptions {
  const data = fixture();
  return {
    slotMinutes: 15,
    capacity: 4,
    keepEvaluator: true,
    fillAfterLast: false,
    days: defaultDayInputs(data),
    ...overrides,
  };
}

describe("previewRestructure", () => {
  it("fills 15-minute slots at 4/4/4/1 and 4/2 without crossing days", () => {
    const data = fixture();
    const opts = options();
    const preview = previewRestructure(data, opts);
    const monday = preview.days.find((day) => day.input.key === MONDAY)!;
    const wednesday = preview.days.find((day) => day.input.key === WEDNESDAY)!;

    expect(preview.canApply).toBe(true);
    expect(preview.slotsBefore).toBe(8);
    expect(preview.slotsAfter).toBe(6);
    expect(monday.newSlots.map((slot) => slot.key)).toEqual([
      `${MONDAY}-1`,
      `${MONDAY}-2`,
      `${MONDAY}-3`,
      `${MONDAY}-4`,
    ]);
    expect(monday.newSlots.map((slot) => [slot.startsAt, slot.endsAt])).toEqual([
      [utc(MONDAY, "13:10"), utc(MONDAY, "13:25")],
      [utc(MONDAY, "13:25"), utc(MONDAY, "13:40")],
      [utc(MONDAY, "13:40"), utc(MONDAY, "13:55")],
      [utc(MONDAY, "13:55"), utc(MONDAY, "14:10")],
    ]);
    expect(monday.rows.map((row) => row.newSeat)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1]);
    expect(wednesday.newSlots).toHaveLength(2);
    expect(wednesday.rows.map((row) => row.newSeat)).toEqual([1, 2, 3, 4, 1, 2]);
    expect(wednesday.newSlots[0]!.startsAt).toBe(utc(WEDNESDAY, "13:00"));
    expect(preview.days.every((day) => day.rows.every((row) => row.dayKey === day.input.key))).toBe(
      true,
    );
    expect(monday.rows[12]!.newSlotLabel).not.toBe("—");
  });

  it("orders by old slot start then old seat, not by created time", () => {
    const data = fixture();
    const firstSlot = data.slots[0]!;
    data.students = data.students.slice(0, 2).map((student, index) => ({
      ...student,
      slotId: firstSlot.id,
      slotStartsAt: firstSlot.starts_at,
      seatNumber: index === 0 ? 2 : 1,
      createdAt: index === 0 ? iso(MONDAY, "08:00") : iso(MONDAY, "10:00"),
    }));
    const preview = previewRestructure(data, options());
    expect(preview.days[0]!.rows.map((row) => row.oldSeat)).toEqual([1, 2]);
  });

  it("reports an overflow when students do not fit before the day end", () => {
    const data = fixture();
    const opts = options();
    opts.days = opts.days.map((day) => (day.key === MONDAY ? { ...day, end: "13:25" } : day));
    const preview = previewRestructure(data, opts);
    const monday = preview.days.find((day) => day.input.key === MONDAY)!;
    expect(monday.error).toMatch(/13 student/);
    expect(preview.canApply).toBe(false);
  });

  it("keeps an overflowing preview renderable when students have evaluators", () => {
    const data = fixture();
    data.students = data.students.map((student) => ({
      ...student,
      evaluatorId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      evaluatorName: "A",
    }));
    const opts = options();
    opts.days = opts.days.map((day) => (day.key === MONDAY ? { ...day, end: "13:11" } : day));

    expect(() => previewRestructure(data, opts)).not.toThrow();
    const preview = previewRestructure(data, opts);
    const monday = preview.days.find((day) => day.input.key === MONDAY)!;
    expect(monday.error).toMatch(/slot\(s\) fit/);
    expect(monday.newSlots).toHaveLength(0);
    expect(monday.rows[0]!.newSlotLabel).toBe("—");
    expect(preview.canApply).toBe(false);
  });

  it("keeps the preview renderable with an empty capacity input", () => {
    const data = fixture();
    data.students = data.students.map((student) => ({
      ...student,
      evaluatorId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      evaluatorName: "A",
    }));

    expect(() => previewRestructure(data, options({ capacity: 0 }))).not.toThrow();
    const preview = previewRestructure(data, options({ capacity: 0 }));
    expect(preview.days[0]!.error).toMatch(/at least 1/i);
    expect(preview.days[0]!.newSlots).toHaveLength(0);
    expect(preview.canApply).toBe(false);
  });

  it("keeps evaluators unique within a slot when rebalancing", () => {
    const data = fixture();
    data.evaluators = ["A", "B", "C", "D"].map((name, index) => ({
      id: `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, "0")}`,
      name,
      position: index,
    }));
    const preview = previewRestructure(data, options({ keepEvaluator: false }));
    for (const day of preview.days) {
      for (const slot of day.newSlots) {
        const ids = slot.seatEvaluators.map((seat) => seat.evaluatorId).filter(Boolean);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
    expect(preview.canApply).toBe(true);
  });

  it("errors when there are fewer evaluators than seats in one slot", () => {
    const data = fixture();
    data.evaluators = ["A", "B", "C"].map((name, index) => ({
      id: `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, "0")}`,
      name,
      position: index,
    }));
    const preview = previewRestructure(data, options({ keepEvaluator: false }));
    expect(preview.days[0]!.error).toMatch(/at least 4 evaluators/i);
    expect(preview.canApply).toBe(false);
  });

  it("applies the exact 30 Nov / 2 Dec scenario with a valid RPC payload", () => {
    const data = fixture();
    data.students = [
      ...data.students.filter((student) => student.bookingId.startsWith("aaaaaaaa")),
      ...data.students.filter((student) => student.bookingId.startsWith("cccccccc")).slice(0, 4),
    ];
    data.students[0] = {
      ...data.students[0]!,
      studentName: "Shabi Ul Hassan BS(CS) 2025 FAST NU LHR",
      rollNo: null,
      email: "l250636@student.example.com",
    };
    const opts = options({ slotMinutes: 15, capacity: 4, fillAfterLast: true });
    opts.days = opts.days.map((day) =>
      day.key === MONDAY
        ? { ...day, start: "13:10", end: "14:10" }
        : { ...day, start: "13:00", end: "13:30" },
    );

    const preview = previewRestructure(data, opts);
    const monday = preview.days.find((day) => day.input.key === MONDAY)!;
    const wednesday = preview.days.find((day) => day.input.key === WEDNESDAY)!;
    const allRows = preview.days.flatMap((day) => day.rows);

    expect(preview.canApply).toBe(true);
    expect(monday.rows).toHaveLength(13);
    expect(wednesday.rows).toHaveLength(4);
    expect(monday.newSlots).toHaveLength(4);
    expect(wednesday.newSlots).toHaveLength(2);
    expect(wednesday.emptySlots).toBe(1);
    expect(preview.slotsAfter).toBe(6);
    expect(monday.rows[0]!.studentName).toBe("Shabi Ul Hassan");
    expect(monday.rows[0]!.rollNo).toBe("l250636");
    expect(preview.studentsMoved).toBe(allRows.filter((row) => row.changed).length);
    expect(preview.timeChangedCount).toBe(allRows.filter((row) => row.timeChanged).length);
    expect(preview.seatChangedCount).toBe(allRows.filter((row) => row.seatChanged).length);

    const payload = restructureRpcPayload(preview, opts);
    const parsed = restructureApplyInputSchema.safeParse({
      periodId: data.period.id,
      slotMinutes: opts.slotMinutes,
      capacity: opts.capacity,
      keepEvaluator: opts.keepEvaluator,
      fillAfterLast: opts.fillAfterLast,
      days: payload.days,
      plan: payload.plan,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plan).toHaveLength(17);
      expect(parsed.data.days.find((day) => day.key === WEDNESDAY)?.newSlots).toHaveLength(2);
    }
  });
});

describe("undoBookingGuard", () => {
  it("blocks undo after a new booking and allows an unchanged set", () => {
    expect(undoBookingGuard(["a", "b"], ["a", "b"])).toEqual({ ok: true });
    expect(undoBookingGuard(["a", "b"], ["a", "b", "c"])).toEqual({
      ok: false,
      code: "restructure_has_new_bookings",
    });
  });
});

describe("rpcFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the full DB diagnostic and surfaces unmapped messages", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = rpcFailure(
      "applySlotRestructure",
      { periodId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      {
        message: 'duplicate key value violates unique constraint "slot_seats_slot_number_key"',
        code: "23505",
        details: "Key (university_id, slot_id, seat_number)=(...) already exists.",
        hint: null,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("duplicate");
      expect(result.detail).toBeUndefined();
    }
    expect(log).toHaveBeenCalledWith(
      "[applySlotRestructure] RPC failed",
      expect.objectContaining({
        code: "23505",
        details: expect.stringContaining("already exists"),
        message: expect.stringContaining("slot_seats_slot_number_key"),
      }),
    );

    const unknown = rpcFailure("applySlotRestructure", {}, { message: "sqlstate 42P01" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.detail).toBe("sqlstate 42P01");
  });
});
