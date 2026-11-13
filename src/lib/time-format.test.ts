import { describe, expect, it } from "vitest";
import {
  formatDayHeading,
  formatSlotTime,
  formatSlotTimeRange,
  karachiDateKey,
  toUniversityDateTimeInput,
  universityDateTimeInputToIso,
} from "./time-format";

/**
 * Registry delta 2026-11-08 — every time displays on a 12-hour clock with
 * AM/PM in Asia/Karachi. PKT is fixed UTC+05 (no DST), so the expectations
 * below are stable forever.
 */
describe("time-format", () => {
  it("formats a 22:45 UTC instant as 3:45 AM (UTC+05)", () => {
    // 22:45Z - 5h = 03:45 PKT next day.
    expect(formatSlotTime("2026-11-09T22:45:00Z")).toMatch(/3:45\s*\.?AM/i);
  });

  it("formats 05:30Z as 10:30 AM and 11:00Z as 4:00 PM (12-hour, AM/PM)", () => {
    expect(formatSlotTime("2026-11-09T05:30:00Z")).toMatch(/10:30\s*\.?AM/i);
    expect(formatSlotTime("2026-11-09T11:00:00Z")).toMatch(/4:00\s*\.?PM/i);
  });

  it("renders the slot range as '10:30 AM - 11:00 AM'", () => {
    const range = formatSlotTimeRange("2026-11-09T05:30:00Z", "2026-11-09T06:00:00Z");
    expect(range).toBe(
      `${formatSlotTime("2026-11-09T05:30:00Z")} - ${formatSlotTime("2026-11-09T06:00:00Z")}`,
    );
    expect(range).toMatch(/AM/i);
    expect(range.includes("-")).toBe(true);
  });

  it("keeps midnight and noon on the 12-hour clock", () => {
    expect(formatSlotTime("2026-11-09T19:00:00Z")).toMatch(/12:00\s*\.?AM/i); // 00:00 PKT
    expect(formatSlotTime("2026-11-09T07:00:00Z")).toMatch(/12:00\s*\.?PM/i); // 12:00 PKT
  });

  it("groups slots by the Asia/Karachi calendar day", () => {
    // 19:00Z on Nov 8 is 00:00 Nov 9 in Karachi.
    expect(karachiDateKey("2026-11-08T19:00:00Z")).toBe("2026-11-09");
    // 18:59Z stays on Nov 8.
    expect(karachiDateKey("2026-11-08T18:59:00Z")).toBe("2026-11-08");
  });

  it("formats the day heading as 'Monday, 9 Nov 2026'", () => {
    expect(formatDayHeading("2026-11-09T06:00:00+05:00")).toBe("Monday, 9 Nov 2026");
  });

  it("renders stored instants as Karachi wall time for datetime-local inputs", () => {
    expect(toUniversityDateTimeInput("2026-11-13T05:00:00Z")).toBe("2026-11-13T10:00");
    expect(toUniversityDateTimeInput("2026-11-13T19:00:00Z")).toBe("2026-11-14T00:00");
    expect(toUniversityDateTimeInput(null)).toBe("");
  });

  it("parses datetime-local values as Karachi wall time, not server time", () => {
    expect(universityDateTimeInputToIso("2026-11-13T10:00")).toBe("2026-11-13T05:00:00.000Z");
    expect(universityDateTimeInputToIso("2026-11-13T00:00")).toBe("2026-11-12T19:00:00.000Z");
    expect(universityDateTimeInputToIso("")).toBeNull();
  });
});
