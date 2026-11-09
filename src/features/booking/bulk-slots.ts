import { z } from "zod";

/**
 * Pure planner for the "Generate slots" bulk form (registry delta 2026-11-08).
 * THE DATABASE IS AUTHORITATIVE: private.create_slots_bulk() re-validates
 * everything server-side (overlap, period bounds, permissions). This module
 * only powers the live client preview and the form contract so the UI shows
 * exactly what the RPC will create.
 *
 * Date/time inputs are wall times in Asia/Karachi — Pakistan Standard Time is
 * a fixed UTC+05 offset with no daylight saving, so the conversion is the
 * constant `+05:00` ISO suffix and can never drift by an hour (DST-free,
 * verified by unit test against the same boundaries the RPC checks).
 */

export const KARACHI_UTC_OFFSET = "+05:00";

/** Maximum number of slots one bulk request may create (mirrors the RPC cap). */
export const MAX_BULK_SLOTS = 500;

/** Wall time in Karachi → UTC instant (PKT is fixed UTC+05, no DST). */
export function karachiWallClockToInstant(date: string, time: string): Date {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${normalizedTime}${KARACHI_UTC_OFFSET}`);
}

const optionalTime = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "timeRequired")
    .optional(),
);

export const bulkSlotsInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateRequired"),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateRequired"),
  dailyStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "timeRequired"),
  dailyEnd: optionalTime,
  slotsPerDay: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce
      .number()
      .int("invalidNumber")
      .min(1, "invalidNumber")
      .max(200, "invalidNumber")
      .optional(),
  ),
  slotMinutes: z.coerce
    .number({ message: "invalidNumber" })
    .int("invalidNumber")
    .min(1, "slotMinutes")
    .max(480, "invalidNumber"),
  gapMinutes: z.coerce
    .number({ message: "invalidNumber" })
    .int("invalidNumber")
    .min(0, "invalidNumber")
    .max(240, "invalidNumber")
    .default(0),
  capacity: z.coerce
    .number({ message: "invalidNumber" })
    .int("invalidNumber")
    .min(1, "capacityMin")
    .max(500, "invalidNumber"),
  location: z.string().trim().max(120, "locationMax").optional().default(""),
});
// Cross-field rules (end after start, end-or-count, date order, the 500-slot
// cap) are enforced by planBulkSlots() so the form preview and the server
// action show the same message; the RPC re-checks everything authoritatively.

export type BulkSlotsInput = z.infer<typeof bulkSlotsInputSchema>;

export type PlannedSlot = { startsAt: Date; endsAt: Date };

export type BulkPlanFailure =
  | {
      ok: false;
      error:
        "endAfterStart" | "endOrCountRequired" | "fromAfterTo" | "tooManySlots" | "noSlotsFitDay";
    }
  | { ok: true; days: string[]; perDayCount: number; total: number; slots: PlannedSlot[] };

/** Inclusive list of ISO dates between two ISO dates (bounded, UTC-stable). */
export function dateRangeInclusive(fromDate: string, toDate: string, cap = 500): string[] {
  const out: string[] = [];
  const cursor = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end)) return out;
  for (let time = cursor; out.length < cap && time <= end; time += 86_400_000) {
    out.push(new Date(time).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Builds the exact schedule (Karachi wall time → UTC instants) the RPC will
 * insert: `slotMinutes` chunks with an optional gap over each day, bounded by
 * `dailyEnd` or counted with `slotsPerDay`. Pure — no I/O, unit-testable.
 */
export function planBulkSlots(
  input: Pick<
    BulkSlotsInput,
    "fromDate" | "toDate" | "dailyStart" | "dailyEnd" | "slotsPerDay" | "slotMinutes" | "gapMinutes"
  >,
): BulkPlanFailure {
  if (input.fromDate > input.toDate) return { ok: false, error: "fromAfterTo" };
  if (input.slotsPerDay == null && (input.dailyEnd == null || input.dailyEnd === "")) {
    return { ok: false, error: "endOrCountRequired" };
  }
  if (input.dailyEnd != null && input.dailyEnd !== "" && input.dailyEnd <= input.dailyStart) {
    return { ok: false, error: "endAfterStart" };
  }

  const slotSeconds = input.slotMinutes * 60;
  const strideSeconds = slotSeconds + input.gapMinutes * 60;

  let perDayCount: number;
  if (input.slotsPerDay != null) {
    perDayCount = input.slotsPerDay;
  } else {
    const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const windowSeconds = (toMinutes(input.dailyEnd as string) - toMinutes(input.dailyStart)) * 60;
    perDayCount = Math.floor((windowSeconds - slotSeconds) / strideSeconds) + 1;
    if (perDayCount < 1) return { ok: false, error: "noSlotsFitDay" };
  }

  const days = dateRangeInclusive(input.fromDate, input.toDate);
  const total = days.length * perDayCount;
  if (total > MAX_BULK_SLOTS) return { ok: false, error: "tooManySlots" };
  if (total < 1) return { ok: false, error: "noSlotsFitDay" };

  const slots: PlannedSlot[] = [];
  for (const day of days) {
    const dayStart = karachiWallClockToInstant(day, input.dailyStart.slice(0, 5)).getTime();
    for (let index = 0; index < perDayCount; index += 1) {
      const startsAt = new Date(dayStart + index * strideSeconds * 1000);
      slots.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + slotSeconds * 1000),
      });
    }
  }
  return { ok: true, days, perDayCount, total, slots };
}
