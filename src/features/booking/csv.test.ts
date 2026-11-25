import { describe, expect, it } from "vitest";
import { buildBookingCsv } from "./csv";
import type { PeriodBookingOverview } from "./overview";

function overviewFixture(): PeriodBookingOverview {
  return {
    period: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Midterm evaluation",
      offering_id: "22222222-2222-4222-8222-222222222222",
      section_id: "33333333-3333-4333-8333-333333333333",
      starts_at: "2026-11-13T05:00:00Z",
      ends_at: "2026-11-13T13:00:00Z",
      cutoff_hours: 6,
      offering_code: "CS-401",
      course_code: "CS",
      section_code: "A",
    },
    can_manage: true,
    evaluators: [],
    slots: [
      {
        id: "slot-1",
        starts_at: "2026-11-13T12:30:00Z",
        ends_at: "2026-11-13T13:00:00Z",
        capacity: 2,
        location: null,
        booked: 1,
        my_booking_id: null,
        my_evaluator: null,
        seats: [],
      },
    ],
    students: [
      {
        slot_id: "slot-1",
        slot_starts_at: "2026-11-13T12:30:00Z",
        student_name: 'Aina "A" Khan',
        student_email: "aina@example.com",
        status: "active",
        booking_id: "44444444-4444-4444-8444-444444444444",
        seat_number: 2,
        evaluator_id: "55555555-5555-4555-8555-555555555555",
        evaluator_name: "=Dr. Sara, Ahmed",
      },
    ],
  };
}

describe("buildBookingCsv", () => {
  it("writes one quoted row per student with Karachi slot time and evaluator", () => {
    const csv = buildBookingCsv(overviewFixture());

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Student","Email","Slot date","Slot time","Evaluator","Seat"');
    expect(csv).toContain('"Aina ""A"" Khan"');
    expect(csv).toContain('"aina@example.com"');
    expect(csv).toContain("13 Nov 2026");
    expect(csv).toMatch(/"5:30\s*\.?pm - 6:00\s*\.?pm"/i);
    expect(csv).toContain('"\'=Dr. Sara, Ahmed"');
    expect(csv).toContain('"2"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("leaves evaluator and seat blank for legacy bookings without them", () => {
    const overview = overviewFixture();
    overview.students = [
      {
        ...overview.students[0]!,
        slot_id: "missing-slot",
        evaluator_name: null,
        seat_number: undefined,
      },
    ];

    const csv = buildBookingCsv(overview);
    expect(csv).toMatch(/"5:30\s*\.?pm","",""/i);
  });
});
