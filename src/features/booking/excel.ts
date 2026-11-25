import ExcelJS from "exceljs";
import { formatDayHeading, formatSlotTime, formatSlotTimeRange } from "@/lib/time-format";
import type { PeriodBookingOverview } from "./overview";

/**
 * Staff-only booking export as a real, formatted .xlsx workbook (never CSV).
 * Every instant is formatted in Asia/Karachi (the university timezone). Cells
 * that start with a spreadsheet operator are prefixed with an apostrophe so
 * names/emails can never execute as formulas, and every column has an explicit
 * width + wrapping so nothing overlaps when the file is opened in Excel.
 */

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Student", key: "student", width: 28 },
  { header: "Email", key: "email", width: 32 },
  { header: "Slot date", key: "slotDate", width: 20 },
  { header: "Slot time", key: "slotTime", width: 26 },
  { header: "Evaluator", key: "evaluator", width: 26 },
  { header: "Seat", key: "seat", width: 12 },
];

const HEADER_FILL = "FFEFF3FB";
const STRIPE_FILL = "FFF8FAFE";
const BORDER_COLOR = "FFDCE3EE";

function safeText(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function buildBookingWorkbook(overview: PeriodBookingOverview): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Metria";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Bookings");
  sheet.columns = COLUMNS;

  const slots = new Map(overview.slots.map((slot) => [slot.id, slot]));
  const rows = [...overview.students].sort((a, b) => {
    const aStart = slots.get(a.slot_id)?.starts_at ?? a.slot_starts_at;
    const bStart = slots.get(b.slot_id)?.starts_at ?? b.slot_starts_at;
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    const aEmail = (a.student_email ?? "").toLowerCase();
    const bEmail = (b.student_email ?? "").toLowerCase();
    if (aEmail !== bEmail) return aEmail < bEmail ? -1 : 1;
    return a.student_name.localeCompare(b.student_name);
  });

  for (const student of rows) {
    const slot = slots.get(student.slot_id);
    const startsAt = slot?.starts_at ?? student.slot_starts_at;
    sheet.addRow({
      student: safeText(student.student_name),
      email: safeText(student.student_email ?? ""),
      slotDate: formatDayHeading(startsAt),
      slotTime: slot
        ? formatSlotTimeRange(slot.starts_at, slot.ends_at)
        : formatSlotTime(student.slot_starts_at),
      evaluator: safeText(student.evaluator_name ?? ""),
      seat: student.seat_number ?? "",
    });
  }

  // Header: bold, tinted, wrapped and frozen so it stays visible while
  // scrolling through a long roster.
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FF1E293B" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
  header.eachCell((cell) => {
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF93A5C4" } },
    };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Body: consistent row height, roomy padding, wrapping and light stripes so
  // adjacent values never run into each other.
  sheet.properties.defaultRowHeight = 22;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER_COLOR } },
      };
      if (rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE_FILL } };
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
