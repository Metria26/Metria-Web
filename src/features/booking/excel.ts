import ExcelJS from "exceljs";
import JSZip from "jszip";
import { formatDayHeading, formatSlotTime, formatSlotTimeRange } from "@/lib/time-format";
import { cleanStudentName } from "./name-cleaning";
import type { ExportGroup } from "./export-groups";
import type { BookingSlotOverview, BookingStudent, PeriodBookingOverview } from "./overview";

export { cleanStudentName } from "./name-cleaning";

/**
 * Staff-only booking export as a real, formatted .xlsx workbook (never CSV).
 * One sheet builder is shared by the main workbook, the per-evaluator sheets
 * and the separate files in the ZIP so every export looks identical.
 *
 * A booking made by one group member expands to one row per current group
 * member. Group/slot/evaluator/seat cells are merged vertically across the
 * member rows; student, roll no, email, marks and remarks stay per member.
 *
 * All instants are formatted in Asia/Karachi (the university timezone). Cells
 * that start with a spreadsheet operator are prefixed with an apostrophe so
 * names/emails can never execute as formulas.
 */

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Group", key: "group", width: 12 },
  { header: "Student", key: "student", width: 28 },
  { header: "Roll no", key: "rollNo", width: 16 },
  { header: "Email", key: "email", width: 26 },
  { header: "Slot date", key: "slotDate", width: 24 },
  { header: "Slot time", key: "slotTime", width: 20 },
  { header: "Evaluator", key: "evaluator", width: 20 },
  { header: "Seat", key: "seat", width: 8 },
  { header: "Marks", key: "marks", width: 12 },
  { header: "Remarks", key: "remarks", width: 24 },
];

/** Columns that describe the booking, not the individual member. */
const BOOKING_COLUMNS = [1, 5, 6, 7, 8] as const;

const SUMMARY_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Metric", key: "metric", width: 36 },
  { header: "Count", key: "count", width: 12 },
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
      /** Consecutive rows with the same id form one merged booking block. */
      blockId: string;
      group: string;
      student: string;
      rollNo: string;
      email: string;
      slotDate: string;
      slotTime: string;
      evaluator: string;
      seat: number | "";
      memberCount: number;
      isGroup: boolean;
    };

/**
 * Pure row plan: one gap row before the first booking of each new day. A group
 * booking becomes one row per current member (booker first, then name order);
 * individuals keep a single row. A member who also booked separately is not
 * emitted twice — the first booking in sorted order wins and the duplicate is
 * logged by the server.
 */
export function planBookingRows(
  students: readonly BookingStudent[],
  slots: readonly BookingSlotOverview[],
  evaluatorId?: string,
  groups: readonly ExportGroup[] = [],
): BookingRowPlan[] {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const groupsByBooking = new Map(groups.map((group) => [group.bookingId, group]));
  const seenProfileIds = new Set<string>();
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

    const shared: {
      slotDate: string;
      slotTime: string;
      evaluator: string;
      seat: number | "";
    } = {
      slotDate: day,
      slotTime: slot ? formatSlotTimeRange(slot.starts_at, slot.ends_at) : formatSlotTime(startsAt),
      evaluator: safeText(student.evaluator_name ?? ""),
      seat: student.seat_number ?? "",
    };
    const bookingId = student.booking_id || `${student.slot_id}:${student.student_email}`;
    const group = student.booking_id ? groupsByBooking.get(student.booking_id) : undefined;

    if (group && group.members.length > 0) {
      const members = [...group.members].sort((a, b) => {
        if (a.isBooker !== b.isBooker) return a.isBooker ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const membersToWrite = members.filter((member) => {
        if (!member.profileId) return true;
        if (!seenProfileIds.has(member.profileId)) return true;
        console.warn("[booking-export] duplicate group member booking skipped", {
          bookingId,
          groupId: group.groupId,
          profileId: member.profileId,
          name: member.name,
        });
        return false;
      });
      if (membersToWrite.length === 0) continue;
      membersToWrite.forEach((member) => {
        if (member.profileId) seenProfileIds.add(member.profileId);
      });

      membersToWrite.forEach((member, index) => {
        plans.push({
          kind: "booking",
          blockId: bookingId,
          group: index === 0 ? safeText(group.groupId) : "",
          student: safeText(cleanStudentName(member.name)),
          rollNo: safeText(member.rollNo ?? ""),
          email: safeText(member.email ?? ""),
          ...shared,
          memberCount: group.memberCount || members.length,
          isGroup: true,
        });
      });
    } else {
      plans.push({
        kind: "booking",
        blockId: bookingId,
        group: "",
        student: safeText(cleanStudentName(student.student_name)),
        rollNo: "",
        email: safeText(student.student_email ?? ""),
        ...shared,
        memberCount: 1,
        isGroup: false,
      });
    }
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

function styleRow(
  row: ExcelJS.Row,
  isHeader: boolean,
  columnCount = COLUMNS.length,
  centerColumn = 8,
): void {
  row.height = isHeader ? HEADER_ROW_HEIGHT : DATA_ROW_HEIGHT;
  row.alignment = { vertical: "middle", wrapText: false };
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: !isHeader && columnNumber === centerColumn ? "center" : "left",
      wrapText: false,
    };
    if (isHeader) cell.font = { bold: true, color: { argb: "FF1E293B" } };
    if (columnNumber > columnCount) cell.value = null;
  });
}

/** The single source of truth for every sheet in every export file. */
export function addFormattedSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  students: readonly BookingStudent[],
  slots: readonly BookingSlotOverview[],
  evaluatorId?: string,
  groups: readonly ExportGroup[] = [],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = COLUMNS;

  // Rows 1 and 2 stay completely empty; the header lives in row 3.
  const header = sheet.getRow(HEADER_ROW);
  header.values = COLUMNS.map((column) => String(column.header ?? ""));
  styleRow(header, true);

  const plans = planBookingRows(students, slots, evaluatorId, groups);
  let rowNumber = FIRST_DATA_ROW;
  let blockId: string | null = null;
  let blockStart = 0;
  let blockEnd = 0;

  const closeBlock = () => {
    if (blockId === null || blockEnd <= blockStart) return;
    for (const column of BOOKING_COLUMNS) {
      sheet.getRow(blockStart).getCell(column).alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      sheet.mergeCells(blockStart, column, blockEnd, column);
    }
    sheet.getRow(blockEnd).eachCell({ includeEmpty: false }, (cell) => {
      cell.border = {
        ...cell.border,
        bottom: { style: "medium", color: { argb: BORDER_COLOR } },
      };
    });
  };

  for (const plan of plans) {
    if (plan.kind === "gap") {
      closeBlock();
      blockId = null;
      // Untouched row: no values, no fill, no border.
      rowNumber += 1;
      continue;
    }
    if (plan.blockId !== blockId) {
      closeBlock();
      blockId = plan.blockId;
      blockStart = rowNumber;
    }
    const row = sheet.getRow(rowNumber);
    row.values = [
      plan.group,
      plan.student,
      plan.rollNo,
      plan.email,
      plan.slotDate,
      plan.slotTime,
      plan.evaluator,
      plan.seat,
      "",
      "",
    ];
    styleRow(row, false);
    blockEnd = rowNumber;
    rowNumber += 1;
  }
  closeBlock();

  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 0 }];
  return sheet;
}

/** Small summary sheet: totals plus one line per group found in this file. */
function addSummarySheet(
  workbook: ExcelJS.Workbook,
  plans: readonly BookingRowPlan[],
  sheetName: string,
): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = SUMMARY_COLUMNS;
  const header = sheet.getRow(HEADER_ROW);
  header.values = SUMMARY_COLUMNS.map((column) => String(column.header ?? ""));
  styleRow(header, true, SUMMARY_COLUMNS.length, 2);

  const bookingRows = plans.filter(
    (plan): plan is Extract<BookingRowPlan, { kind: "booking" }> => plan.kind === "booking",
  );
  const blocks = new Map<string, Extract<BookingRowPlan, { kind: "booking" }>>();
  for (const plan of bookingRows) if (!blocks.has(plan.blockId)) blocks.set(plan.blockId, plan);

  const groups = new Map<string, number>();
  for (const block of blocks.values()) {
    if (block.isGroup && block.group) {
      groups.set(block.group, Math.max(groups.get(block.group) ?? 0, block.memberCount));
    }
  }

  const rows: Array<[string, string | number]> = [
    ["Bookings", blocks.size],
    ["Students listed", bookingRows.length],
    ["Group members", [...groups.values()].reduce((sum, count) => sum + count, 0)],
    ...[...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, count]): [string, number] => [`${group} (group members)`, count]),
  ];

  let rowNumber = FIRST_DATA_ROW;
  for (const [metric, count] of rows) {
    const row = sheet.getRow(rowNumber);
    row.values = [safeText(metric), count];
    styleRow(row, false, SUMMARY_COLUMNS.length, 2);
    rowNumber += 1;
  }
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 0 }];
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
  /** Current project-group rosters keyed by booking id. */
  groups?: readonly ExportGroup[];
};

export async function buildBookingWorkbook(
  overview: PeriodBookingOverview,
  options: BookingWorkbookOptions = {},
): Promise<ArrayBuffer> {
  const workbook = newWorkbook();
  const groups = options.groups ?? [];
  addFormattedSheet(
    workbook,
    "Bookings",
    overview.students,
    overview.slots,
    options.evaluatorId,
    groups,
  );

  const usedNames = new Set(["Bookings", "Summary"]);
  if (!options.evaluatorId && options.includeEvaluatorSheets !== false) {
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
      addFormattedSheet(workbook, name, overview.students, overview.slots, evaluator.id, groups);
    }
  }

  addSummarySheet(
    workbook,
    planBookingRows(overview.students, overview.slots, options.evaluatorId, groups),
    "Summary",
  );
  return toBuffer(workbook);
}

/** One workbook per evaluator, zipped; files share the exact same formatting. */
export async function buildEvaluatorZip(
  overview: PeriodBookingOverview,
  filePrefix: string,
  groups: readonly ExportGroup[] = [],
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const evaluator of overview.evaluators) {
    const workbook = newWorkbook();
    addFormattedSheet(
      workbook,
      "Bookings",
      overview.students,
      overview.slots,
      evaluator.id,
      groups,
    );
    addSummarySheet(
      workbook,
      planBookingRows(overview.students, overview.slots, evaluator.id, groups),
      "Summary",
    );
    const buffer = await toBuffer(workbook);
    zip.file(`${filePrefix}-${evaluatorFileSlug(evaluator.name)}.xlsx`, buffer);
  }
  const zipped = await zip.generateAsync({ type: "arraybuffer" });
  return zipped;
}
