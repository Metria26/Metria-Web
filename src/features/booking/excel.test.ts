import { describe, expect, it } from "vitest";
import {
  cleanStudentName,
  evaluatorFileSlug,
  planBookingRows,
  sanitizeSheetName,
  sortBookingRows,
} from "./excel";
import type { BookingSlotOverview, BookingStudent } from "./overview";

const evaluatorA = "55555555-5555-4555-8555-555555555555";
const evaluatorB = "66666666-6666-4666-8666-666666666666";

const slot = (id: string, startsAt: string): BookingSlotOverview => ({
  id,
  starts_at: startsAt,
  ends_at: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
  capacity: 3,
  location: null,
  booked: 3,
  my_booking_id: null,
  my_evaluator: null,
  seats: [],
});

const student = (
  slotId: string,
  startsAt: string,
  name: string,
  seat: number,
  evaluatorId = evaluatorA,
): BookingStudent => ({
  slot_id: slotId,
  slot_starts_at: startsAt,
  student_name: name,
  student_email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  status: "active",
  booking_id: "44444444-4444-4444-8444-444444444444",
  seat_number: seat,
  evaluator_id: evaluatorId,
  evaluator_name: evaluatorId === evaluatorA ? "M Zohaib" : "M Ahmad Khan",
});

describe("cleanStudentName", () => {
  it("cuts BS(...), bare BSxx, batch year and campus suffixes", () => {
    expect(cleanStudentName("Shabi Ul Hassan BS(CS) 2025 FAST NU LHR")).toBe("Shabi Ul Hassan");
    expect(cleanStudentName("Fajar Fatima Majid BS(DS) 2025 FAST NU LHR")).toBe(
      "Fajar Fatima Majid",
    );
    expect(cleanStudentName("Muhammad Ali Aamir BSDS 2024 FAST NU LHR")).toBe("Muhammad Ali Aamir");
    expect(cleanStudentName("Aina Khan")).toBe("Aina Khan");
  });
});

describe("sortBookingRows", () => {
  it("uses real timestamps then seat number, not formatted strings", () => {
    const slots = [
      slot("s-late-text", "2026-11-13T05:00:00Z"), // 05:00 UTC
      slot("s-early-text", "2026-11-13T04:00:00-05:00"), // 09:00 UTC (string sorts first)
    ];
    const students = [
      student("s-late-text", "2026-11-13T05:00:00Z", "Later", 1),
      student("s-early-text", "2026-11-13T04:00:00-05:00", "Earlier Seat 3", 3),
      student("s-early-text", "2026-11-13T04:00:00-05:00", "Earlier Seat 1", 1),
    ];

    // Lexically "04:..." looks first, but its real instant is 09:00 UTC and
    // therefore sorts after the 05:00 UTC slot.
    expect(sortBookingRows(students, slots).map((item) => item.student_name)).toEqual([
      "Later",
      "Earlier Seat 1",
      "Earlier Seat 3",
    ]);
  });
});

describe("planBookingRows", () => {
  const slots = [slot("s1", "2026-11-13T05:00:00Z"), slot("s2", "2026-11-14T05:00:00Z")];

  it("inserts one empty row before the first booking of a new day", () => {
    const students = [
      student("s1", slots[0]!.starts_at, "Day One", 1),
      student("s2", slots[1]!.starts_at, "Day Two A", 1),
      student("s2", slots[1]!.starts_at, "Day Two B", 2),
    ];
    const plan = planBookingRows(students, slots);
    expect(plan.map((row) => row.kind)).toEqual(["booking", "gap", "booking", "booking"]);
    if (plan[1]!.kind === "gap") expect(plan[1]).toEqual({ kind: "gap" });
  });

  it("filters by evaluator id and strips the program suffix from student names", () => {
    const students = [
      student("s1", slots[0]!.starts_at, "Shabi Ul Hassan BS(CS) 2025 FAST NU LHR", 1, evaluatorA),
      student(
        "s1",
        slots[0]!.starts_at,
        "Fajar Fatima Majid BS(DS) 2025 FAST NU LHR",
        2,
        evaluatorB,
      ),
    ];
    const plan = planBookingRows(students, slots, evaluatorB);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: "booking", student: "Fajar Fatima Majid" });
  });
});

describe("sheet and file names", () => {
  it("sanitizes Excel sheet names and file slugs", () => {
    expect(sanitizeSheetName("M: Ahmad/Khan?")).toBe("M Ahmad Khan");
    expect(sanitizeSheetName("x".repeat(40))).toHaveLength(31);
    expect(evaluatorFileSlug("M Ahmad Khan")).toBe("M-Ahmad-Khan");
  });
});
