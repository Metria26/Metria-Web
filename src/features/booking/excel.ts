import ExcelJS from "exceljs";
import JSZip from "jszip";
import { formatDayHeading, formatSlotTime, formatSlotTimeRange } from "@/lib/time-format";
import { cleanStudentName } from "./name-cleaning";
import type { BookingSlotOverview, BookingStudent, PeriodBookingOverview } from "./overview";

export { cleanStudentName } from "./name-cleaning";

/**
 * Staff-only booking export as a real, formatted .xlsx workbook (never CSV).
 * One sheet builder is shared by the main workbook, the per-evaluator sheets
 * and the separate files in the ZIP so every export looks identical.
 *
 * All instants are formatted in Asia/Karachi (the university timezone). Cells
 * that start with a spreadsheet operator are prefixed with an apostrophe so
 * names/emails can never execute as formulas.
 */

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Student", key: "student", width: 28 },
  { header: "Email", key: "email", width: 26 },
  { header: "Slot date", key: "slotDate", width: 24 },
  { header: "Slot time", key: "slotTime", width: 20 },
  { header: "Evaluator", key: "evaluator", width: 20 },
  { header: "Seat", key: "seat", width: 8 },
];

const HEADER_ROW = 3;
const FIRST_DATA_ROW = 4;
const DATA_ROW_HEIGHT = 24;
const HEADER_ROW_HEIGHT = 28;
const WHITE = "FFFFFFFF";
const BORDER_COLOR = "FFD9D9D9";

function safeText(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function slotStart(student: BookingStudent, slots: Map<string, BookingSlotOverview>): number {
  const raw = slots.get(student.slot_id)?.starts_at ?? student.slot_starts_at;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/** Sort by the real slot timestamp, then seat number (ascending). */
export function sortBookingRows(
  students: readonly BookingStudent[],
  slots: readonly BookingSlotOverview[],
): BookingStudent[] {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  return [...students].sort((a, b) => {
    const startDiff = slotStart(a, byId) - slotStart(b, byId);
    if (startDiff !== 0) return startDiff;
    const seatDiff =
      (a.seat_number ?? Number.MAX_SAFE_INTEGER) - (b.seat_number ?? Number.MAX_SAFE_INTEGER);
    if (seatDiff !== 0) return seatDiff;
    const emailDiff = (a.student_email ?? "").localeCompare(b.student_email ?? "");
    return emailDiff !== 0 ? emailDiff : a.student_name.localeCompare(b.student_name);
  });
}

export type BookingRowPlan =
  | { kind: "gap" }
  | {
      kind: "booking";
      student: string;
      email: string;
      slotDate: string;
      slotTime: string;
      evaluator: string;
      seat: number | "";
    };

/**
 * Pure row plan: one gap row before the first booking of each new day, so the
 * sheet builder and the unit tests share exactly the same layout rule.
 */
export function planBookingRows(
  students: readonly BookingStudent[],
  slots: readonly BookingSlotOverview[],
  evaluatorId?: string,
): BookingRowPlan[] {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const ordered = sortBookingRows(students, slots).filter(
    (student) => !evaluatorId || student.evaluator_id === evaluatorId,
  );
  const plans: BookingRowPlan[] = [];
  let previousDay: string | null = null;

  for (const student of ordered) {
    const slot = byId.get(student.slot_id);
    const startsAt = slot?.starts_at ?? student.slot_starts_at;
    const day = formatDayHeading(startsAt);
    if (previousDay !== null && day !== previousDay) plans.push({ kind: "gap" });
    plans.push({
      kind: "booking",
      student: safeText(cleanStudentName(student.student_name)),
      email: safeText(student.student_email ?? ""),
      slotDate: day,
      slotTime: slot ? formatSlotTimeRange(slot.starts_at, slot.ends_at) : formatSlotTime(startsAt),
      evaluator: safeText(student.evaluator_name ?? ""),
      seat: student.seat_number ?? "",
    });
    previousDay = day;
  }
  return plans;
}

/** Excel sheet names cannot exceed 31 chars or contain \ / ? * [ ] :. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Evaluator").slice(0, 31);
}

/** Files use readable, URL-safe fragments: "M Ahmad Khan" -> "M-Ahmad-Khan". */
export function evaluatorFileSlug(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "evaluator"
  );
}

function styleRow(row: ExcelJS.Row, isHeader: boolean): void {
  row.height = isHeader ? HEADER_ROW_HEIGHT : DATA_ROW_HEIGHT;
  row.alignment = { vertical: "middle", wrapText: false };
  row.eachCell((cell, columnNumber) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: columnNumber === COLUMNS.length && !isHeader ? "center" : "left",
      wrapText: false,
    };
    if (isHeader) cell.font = { bold: true, color: { argb: "FF1E293B" } };
  });
}

/** The single source of truth for every sheet in every export file. */
export function addFormattedSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  students: readonly BookingStudent[],
  slots: readonly BookingSlotOverview[],
  evaluatorId?: string,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = COLUMNS;

  // Rows 1 and 2 stay completely empty; the header lives in row 3.
  const header = sheet.getRow(HEADER_ROW);
  header.values = COLUMNS.map((column) => String(column.header ?? ""));
  styleRow(header, true);

  let rowNumber = FIRST_DATA_ROW;
  for (const plan of planBookingRows(students, slots, evaluatorId)) {
    if (plan.kind === "gap") {
      // Untouched row: no values, no fill, no border.
      rowNumber += 1;
      continue;
    }
    const row = sheet.getRow(rowNumber);
    row.values = [
      plan.student,
      plan.email,
      plan.slotDate,
      plan.slotTime,
      plan.evaluator,
      plan.seat,
    ];
    styleRow(row, false);
    rowNumber += 1;
  }

  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 0 }];
  return sheet;
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Metria";
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export type BookingWorkbookOptions = {
  /** Only this evaluator's bookings; disables the extra per-evaluator sheets. */
  evaluatorId?: string;
  /** Default true for the all-evaluators file. */
  includeEvaluatorSheets?: boolean;
};

export async function buildBookingWorkbook(
  overview: PeriodBookingOverview,
  options: BookingWorkbookOptions = {},
): Promise<ArrayBuffer> {
  const workbook = newWorkbook();
  addFormattedSheet(workbook, "Bookings", overview.students, overview.slots, options.evaluatorId);

  if (!options.evaluatorId && options.includeEvaluatorSheets !== false) {
    const usedNames = new Set(["Bookings"]);
    for (const evaluator of overview.evaluators) {
      const base = sanitizeSheetName(evaluator.name);
      let name = base;
      let suffix = 2;
      while (usedNames.has(name)) {
        const tail = ` ${suffix}`;
        name = `${base.slice(0, 31 - tail.length)}${tail}`;
        suffix += 1;
      }
      usedNames.add(name);
      addFormattedSheet(workbook, name, overview.students, overview.slots, evaluator.id);
    }
  }
  return toBuffer(workbook);
}

/** One workbook per evaluator, zipped; files share the exact same formatting. */
export async function buildEvaluatorZip(
  overview: PeriodBookingOverview,
  filePrefix: string,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const evaluator of overview.evaluators) {
    const workbook = newWorkbook();
    addFormattedSheet(workbook, "Bookings", overview.students, overview.slots, evaluator.id);
    const buffer = await toBuffer(workbook);
    zip.file(`${filePrefix}-${evaluatorFileSlug(evaluator.name)}.xlsx`, buffer);
  }
  const zipped = await zip.generateAsync({ type: "arraybuffer" });
  return zipped;
}
