import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  addFormattedSheet,
  buildBookingWorkbook,
  cleanStudentName,
  evaluatorFileSlug,
  planBookingRows,
  sanitizeSheetName,
  sortBookingRows,
} from "./excel";
import type { ExportGroup } from "./export-groups";
import type { BookingSlotOverview, BookingStudent, PeriodBookingOverview } from "./overview";

const evaluatorA = "55555555-5555-4555-8555-555555555555";
const evaluatorB = "66666666-6666-4666-8666-666666666666";
const groupBookingId = "77777777-7777-4777-8777-777777777777";
const otherBookingId = "88888888-8888-4888-8888-888888888888";
const bookerId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const secondMemberId = "33333333-3333-4333-8333-333333333333";

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

const groupRoster = (bookingId: string): ExportGroup => ({
  bookingId,
  groupId: "G1",
  memberCount: 3,
  members: [
    {
      profileId: memberId,
      name: "Zoe Clark BS(CS) 2025 FAST NU LHR",
      rollNo: "l250636",
      email: "zoe@example.com",
      isBooker: false,
    },
    {
      profileId: bookerId,
      name: "Booker Ali BS(CS) 2025 FAST NU LHR",
      rollNo: "l250637",
      email: "booker@example.com",
      isBooker: true,
    },
    {
      profileId: secondMemberId,
      name: "Amy Khan",
      rollNo: "l250638",
      email: "amy@example.com",
      isBooker: false,
    },
  ],
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

describe("group-aware planBookingRows", () => {
  const slots = [slot("s1", "2026-11-13T05:00:00Z")];

  it("writes one row per current member, booker first, with shared slot data", () => {
    const booker = {
      ...student("s1", slots[0]!.starts_at, "Booker Ali", 1),
      booking_id: groupBookingId,
    };
    const individual = {
      ...student("s1", slots[0]!.starts_at, "Solo Student", 2),
      booking_id: otherBookingId,
    };
    const plan = planBookingRows([booker, individual], slots, undefined, [
      groupRoster(groupBookingId),
    ]);
    const rows = plan.filter((row) => row.kind === "booking");
    expect(rows.map((row) => (row.kind === "booking" ? row.student : ""))).toEqual([
      "Booker Ali",
      "Amy Khan",
      "Zoe Clark",
      "Solo Student",
    ]);
    const firstRow = rows[0];
    const lastRow = rows[3];
    if (firstRow?.kind !== "booking" || lastRow?.kind !== "booking") return;
    expect(firstRow.group).toBe("G1");
    expect(rows.slice(0, 3).map((row) => (row.kind === "booking" ? row.group : ""))).toEqual([
      "G1",
      "",
      "",
    ]);
    expect(rows.slice(0, 3).map((row) => (row.kind === "booking" ? row.rollNo : ""))).toEqual([
      "l250637",
      "l250638",
      "l250636",
    ]);
    expect(rows.slice(0, 3).every((row) => row.kind === "booking" && row.seat === 1)).toBe(true);
    expect(lastRow.group).toBe("");
    expect(lastRow.rollNo).toBe("");
  });

  it("does not emit a member twice when that member also booked separately", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = {
      ...student("s1", slots[0]!.starts_at, "Booker Ali", 1),
      booking_id: groupBookingId,
    };
    const second = {
      ...student("s1", slots[0]!.starts_at, "Amy Khan", 2),
      booking_id: otherBookingId,
    };
    const plan = planBookingRows([first, second], slots, undefined, [
      groupRoster(groupBookingId),
      groupRoster(otherBookingId),
    ]);
    expect(plan.filter((row) => row.kind === "booking")).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(
      "[booking-export] duplicate group member booking skipped",
      expect.objectContaining({ groupId: "G1", profileId: bookerId }),
    );
    warn.mockRestore();
  });
});

describe("group sheet layout", () => {
  const slots = [slot("s1", "2026-11-13T05:00:00Z")];

  it("merges booking cells vertically and thickens the group's bottom border", () => {
    const booker = {
      ...student("s1", slots[0]!.starts_at, "Booker Ali", 1),
      booking_id: groupBookingId,
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = addFormattedSheet(workbook, "Bookings", [booker], slots, undefined, [
      groupRoster(groupBookingId),
    ]);
    expect(sheet.model.merges).toEqual(["A4:A6", "E4:E6", "F4:F6", "G4:G6", "H4:H6"]);
    expect(sheet.getCell("A4").value).toBe("G1");
    expect(sheet.getCell("B4").value).toBe("Booker Ali");
    expect(sheet.getCell("B5").value).toBe("Amy Khan");
    expect(sheet.getCell("C5").value).toBe("l250638");
    expect(sheet.getCell("H4").value).toBe(1);
    expect(sheet.getCell("I4").value).toBe("");
    expect(sheet.getCell("J4").value).toBe("");
  });

  it("adds group member totals to the summary sheet", async () => {
    const booker = {
      ...student("s1", slots[0]!.starts_at, "Booker Ali", 1),
      booking_id: groupBookingId,
    };
    const overview = {
      period: {
        id: "99999999-9999-4999-8999-999999999999",
        title: "Evaluations",
        offering_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        section_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        starts_at: slots[0]!.starts_at,
        ends_at: slots[0]!.ends_at,
        cutoff_hours: 6,
        offering_code: "CS",
        course_code: "CS101",
        section_code: "A",
      },
      can_manage: true,
      evaluators: [],
      slots,
      students: [booker],
    } satisfies PeriodBookingOverview;

    const buffer = await buildBookingWorkbook(overview, {
      includeEvaluatorSheets: false,
      groups: [groupRoster(groupBookingId)],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const summary = workbook.getWorksheet("Summary");
    expect(summary?.getCell("A6").value).toBe("Group members");
    expect(summary?.getCell("B6").value).toBe(3);
    expect(summary?.getCell("A7").value).toBe("G1 (group members)");
    expect(summary?.getCell("B7").value).toBe(3);
  });
});

describe("sheet and file names", () => {
  it("sanitizes Excel sheet names and file slugs", () => {
    expect(sanitizeSheetName("M: Ahmad/Khan?")).toBe("M Ahmad Khan");
    expect(sanitizeSheetName("x".repeat(40))).toHaveLength(31);
    expect(evaluatorFileSlug("M Ahmad Khan")).toBe("M-Ahmad-Khan");
  });
});
