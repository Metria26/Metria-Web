import { formatDayHeading, formatSlotTime, formatSlotTimeRange } from "@/lib/time-format";
import type { PeriodBookingOverview } from "./overview";

/**
 * Staff-only booking export. Every instant is formatted in Asia/Karachi (the
 * university timezone), and cells are quoted so names/emails with commas or
 * quotes survive a spreadsheet round-trip. A leading apostrophe neutralises
 * spreadsheet formulas without changing the visible text.
 */
const HEADERS = ["Student", "Email", "Slot date", "Slot time", "Evaluator", "Seat"] as const;

function escapeCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildBookingCsv(overview: PeriodBookingOverview): string {
  const slots = new Map(overview.slots.map((slot) => [slot.id, slot]));

  const lines = [HEADERS.map(escapeCell).join(",")];
  for (const student of overview.students) {
    const slot = slots.get(student.slot_id);
    const startsAt = slot?.starts_at ?? student.slot_starts_at;
    const time = slot
      ? formatSlotTimeRange(slot.starts_at, slot.ends_at)
      : formatSlotTime(student.slot_starts_at);

    lines.push(
      [
        student.student_name,
        student.student_email ?? "",
        formatDayHeading(startsAt),
        time,
        student.evaluator_name ?? "",
        student.seat_number ?? "",
      ]
        .map(escapeCell)
        .join(","),
    );
  }

  // UTF-8 BOM keeps Excel from mangling non-ASCII names; CRLF is the CSV norm.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
