import { z } from "zod";
import { rpcTransport } from "@/lib/supabase/rpc";
import { formatSlotTime, karachiDateKey, toUniversityDateTimeInput } from "@/lib/time-format";
import { groupSlotsByDay } from "./slot-view";

/**
 * Admin-only slot restructure: the page previews this pure plan, then the SQL
 * RPC re-applies the exact same plan transactionally. Nothing here writes.
 */

export const restructureDataSchema = z.object({
  period: z.object({
    id: z.string().uuid(),
    title: z.string(),
    slotMinutes: z.coerce.number().int().positive(),
    capacity: z.coerce.number().int().positive(),
  }),
  slots: z.array(
    z.object({
      id: z.string().uuid(),
      starts_at: z.string(),
      ends_at: z.string(),
      capacity: z.coerce.number(),
      location: z.string().nullable(),
    }),
  ),
  students: z.array(
    z.object({
      bookingId: z.string().uuid(),
      studentId: z.string().uuid(),
      studentName: z.string(),
      rollNo: z.string().nullable(),
      email: z.string().nullable(),
      slotId: z.string().uuid(),
      slotStartsAt: z.string(),
      seatNumber: z.coerce.number().nullable(),
      evaluatorId: z.string().uuid().nullable(),
      evaluatorName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  evaluators: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      position: z.coerce.number(),
    }),
  ),
});

export type RestructureData = z.infer<typeof restructureDataSchema>;

export const restructureDaySchema = z.object({
  key: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  breakStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  breakEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  location: z.string().nullable().optional(),
  // apply RPC needs the reviewed newSlots/seatEvaluators in the same payload.
  newSlots: z.array(z.unknown()).optional(),
});
export type RestructureDayInput = z.infer<typeof restructureDaySchema>;

export type RestructureOptions = {
  slotMinutes: number;
  capacity: number;
  keepEvaluator: boolean;
  fillAfterLast: boolean;
  days: RestructureDayInput[];
};

export type RestructureSeatEvaluator = { seat: number; evaluatorId: string | null };

export type RestructureNewSlot = {
  key: string;
  dayKey: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatEvaluators: RestructureSeatEvaluator[];
};

export type RestructureRow = {
  dayKey: string;
  bookingId: string;
  studentName: string;
  rollNo: string | null;
  email: string | null;
  oldStartsAt: string;
  oldSlotLabel: string;
  oldSeat: number | null;
  newSlotKey: string;
  newStartsAt: string;
  newSlotLabel: string;
  newSeat: number;
  evaluatorId: string | null;
  evaluatorName: string | null;
  changed: boolean;
  timeChanged: boolean;
};

export type RestructureDayPreview = {
  input: RestructureDayInput;
  rows: RestructureRow[];
  newSlots: RestructureNewSlot[];
  error: string | null;
};

export type RestructurePreview = {
  days: RestructureDayPreview[];
  slotsBefore: number;
  slotsAfter: number;
  studentsMoved: number;
  canApply: boolean;
};

export async function loadRestructureData(
  supabase: unknown,
  periodId: string,
): Promise<RestructureData | null> {
  const { data, error } = await rpcTransport(supabase).rpc("restructure_period_data", {
    p_period_id: periodId,
  });
  if (error) {
    if (/not_found/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return restructureDataSchema.parse(data);
}

/** Staff bulk-slot form defaults: the settings an admin last applied. */
export async function loadPeriodSlotDefaults(
  supabase: unknown,
  periodId: string,
): Promise<{ slotMinutes: number; capacity: number }> {
  const { data, error } = await rpcTransport(supabase).rpc("period_slot_defaults", {
    p_period_id: periodId,
  });
  if (error) return { slotMinutes: 10, capacity: 3 };
  const parsed = z
    .object({ slotMinutes: z.coerce.number(), capacity: z.coerce.number() })
    .safeParse(data);
  return parsed.success ? parsed.data : { slotMinutes: 10, capacity: 3 };
}

export async function canRestructurePeriod(supabase: unknown, periodId: string): Promise<boolean> {
  const { data, error } = await rpcTransport(supabase).rpc("can_restructure_period", {
    p_period_id: periodId,
  });
  return !error && data === true;
}

/** Wall-clock part of the shared university-time datetime-local formatter. */
function localTime(iso: string): string {
  return toUniversityDateTimeInput(iso).slice(11, 16);
}

function dayIso(dayKey: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = Date.parse(`${dayKey}T${time}:00+05:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Start from each day's existing first slot and last slot end. */
export function defaultDayInputs(data: RestructureData): RestructureDayInput[] {
  return groupSlotsByDay(data.slots).map((group) => {
    const first = group.slots[0]!;
    const last = group.slots[group.slots.length - 1]!;
    // Leave room for one longer replacement slot at the tail of the day: the
    // old last slot end alone can be too early once capacity/duration change.
    const tail =
      Date.parse(`${group.key}T${localTime(last.ends_at)}:00+05:00`) +
      data.period.slotMinutes * 60_000;
    return {
      key: group.key,
      start: localTime(first.starts_at),
      end: Number.isNaN(tail) ? localTime(last.ends_at) : localTime(new Date(tail).toISOString()),
      breakStart: null,
      breakEnd: null,
      location: first.location,
    };
  });
}

function timeline(
  input: RestructureDayInput,
  slotMinutes: number,
  needed: number,
  fillAfterLast: boolean,
): { spans: { startsAt: number; endsAt: number }[]; overflow: boolean } {
  const start = dayIso(input.key, input.start);
  const end = dayIso(input.key, input.end);
  const breakStart = input.breakStart ? dayIso(input.key, input.breakStart) : null;
  const breakEnd = input.breakEnd ? dayIso(input.key, input.breakEnd) : null;
  if (start === null || end === null || end <= start || slotMinutes < 1) {
    return { spans: [], overflow: true };
  }
  const length = slotMinutes * 60_000;
  const spans: { startsAt: number; endsAt: number }[] = [];
  let cursor = start;
  while (cursor + length <= end) {
    if (!fillAfterLast && spans.length >= needed) break;
    if (breakStart !== null && breakEnd !== null && breakEnd > breakStart) {
      if (cursor < breakEnd && cursor + length > breakStart) {
        cursor = breakEnd;
        continue;
      }
    }
    spans.push({ startsAt: cursor, endsAt: cursor + length });
    cursor += length;
  }
  return { spans, overflow: !fillAfterLast ? spans.length < needed : needed > spans.length };
}

export function previewRestructure(
  data: RestructureData,
  options: RestructureOptions,
): RestructurePreview {
  const dayMap = new Map(options.days.map((day) => [day.key, day]));
  const evaluatorList = [...data.evaluators].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const sortedStudents = [...data.students].sort((a, b) => {
    const startDiff = Date.parse(a.slotStartsAt) - Date.parse(b.slotStartsAt);
    if (startDiff !== 0) return startDiff;
    const seatDiff = (a.seatNumber ?? 1_000_000) - (b.seatNumber ?? 1_000_000);
    if (seatDiff !== 0) return seatDiff;
    const createdDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return createdDiff !== 0 ? createdDiff : a.bookingId.localeCompare(b.bookingId);
  });
  const studentsByDay = new Map<string, typeof sortedStudents>();
  for (const student of sortedStudents) {
    const key = karachiDateKey(student.slotStartsAt);
    studentsByDay.set(key, [...(studentsByDay.get(key) ?? []), student]);
  }

  const dayPreviews: RestructureDayPreview[] = [];
  let evaluatorCursor = 0;
  let slotsAfter = 0;
  let studentsMoved = 0;

  for (const input of options.days) {
    const dayStudents = studentsByDay.get(input.key) ?? [];
    const neededSlots = Math.ceil(dayStudents.length / options.capacity);
    const { spans, overflow } = timeline(
      input,
      options.slotMinutes,
      neededSlots,
      options.fillAfterLast,
    );
    let error = overflow
      ? `Only ${spans.length} slot(s) fit before ${input.end}; ${dayStudents.length} student(s) need ${neededSlots}.`
      : null;

    const newSlots: RestructureNewSlot[] = spans.map((span, index) => {
      const seatEvaluators: RestructureSeatEvaluator[] = [];
      const used = new Set<string>();
      for (let seat = 1; seat <= options.capacity; seat += 1) {
        let evaluatorId: string | null = null;
        if (!options.keepEvaluator && evaluatorList.length > 0) {
          if (evaluatorList.length < options.capacity) {
            error ??= `Add at least ${options.capacity} evaluators to avoid repeats within one slot.`;
          } else {
            for (let step = 0; step < evaluatorList.length; step += 1) {
              const candidate = evaluatorList[(evaluatorCursor + step) % evaluatorList.length]!;
              if (!used.has(candidate.id)) {
                evaluatorId = candidate.id;
                break;
              }
            }
            used.add(evaluatorId!);
            evaluatorCursor = (evaluatorCursor + 1) % evaluatorList.length;
          }
        }
        seatEvaluators.push({ seat, evaluatorId });
      }
      return {
        key: `${input.key}-${index + 1}`,
        dayKey: input.key,
        startsAt: new Date(span.startsAt).toISOString(),
        endsAt: new Date(span.endsAt).toISOString(),
        capacity: options.capacity,
        seatEvaluators,
      };
    });

    const evaluatorByName = new Map(evaluatorList.map((item) => [item.id, item.name]));
    const perSlot = new Map<string, Set<string>>();
    const rows: RestructureRow[] = dayStudents.map((student, index) => {
      const slot = newSlots[Math.floor(index / options.capacity)];
      const seat = (index % options.capacity) + 1;
      const seatEvaluator = slot?.seatEvaluators.find((item) => item.seat === seat);
      const evaluatorId = options.keepEvaluator
        ? student.evaluatorId
        : (seatEvaluator?.evaluatorId ?? null);
      if (evaluatorId) {
        const used = perSlot.get(slot!.key) ?? new Set<string>();
        if (used.has(evaluatorId)) {
          error ??= "Two students in one slot would get the same evaluator. Choose rebalance.";
        }
        used.add(evaluatorId);
        perSlot.set(slot!.key, used);
      }
      if (slot && options.keepEvaluator) {
        seatEvaluator!.evaluatorId = evaluatorId;
      }
      const timeChanged = slot
        ? slot.startsAt !== new Date(student.slotStartsAt).toISOString()
        : true;
      const changed = timeChanged || student.seatNumber !== seat;
      if (changed) studentsMoved += 1;
      return {
        dayKey: input.key,
        bookingId: student.bookingId,
        studentName: student.studentName,
        rollNo: student.rollNo,
        email: student.email,
        oldStartsAt: student.slotStartsAt,
        oldSlotLabel: formatSlotTime(student.slotStartsAt),
        oldSeat: student.seatNumber,
        newSlotKey: slot?.key ?? "",
        newStartsAt: slot?.startsAt ?? "",
        newSlotLabel: slot ? formatSlotTime(slot.startsAt) : "—",
        newSeat: seat,
        evaluatorId,
        evaluatorName: evaluatorId
          ? (evaluatorByName.get(evaluatorId) ??
            (options.keepEvaluator ? student.evaluatorName : null))
          : null,
        changed,
        timeChanged,
      };
    });

    slotsAfter += newSlots.length;
    dayPreviews.push({ input, rows, newSlots, error });
  }

  for (const student of data.students) {
    if (!dayMap.has(karachiDateKey(student.slotStartsAt))) {
      const key = karachiDateKey(student.slotStartsAt);
      dayPreviews.push({
        input: {
          key,
          start: localTime(student.slotStartsAt),
          end: localTime(student.slotStartsAt),
          breakStart: null,
          breakEnd: null,
          location: null,
        },
        rows: [],
        newSlots: [],
        error: "This day is missing from the plan.",
      });
    }
  }

  return {
    days: dayPreviews,
    slotsBefore: data.slots.length,
    slotsAfter,
    studentsMoved,
    canApply: dayPreviews.length > 0 && dayPreviews.every((day) => day.error === null),
  };
}

/** Serializable payloads for the apply RPC (identical data the user reviewed). */
export function restructureRpcPayload(preview: RestructurePreview, options: RestructureOptions) {
  return {
    days: options.days.map((input) => {
      const day = preview.days.find((item) => item.input.key === input.key);
      return {
        ...input,
        newSlots: (day?.newSlots ?? []).map((slot) => ({
          key: slot.key,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          capacity: slot.capacity,
          seatEvaluators: slot.seatEvaluators,
        })),
      };
    }),
    plan: preview.days.flatMap((day) =>
      day.rows.map((row) => ({
        dayKey: row.dayKey,
        bookingId: row.bookingId,
        newSlotKey: row.newSlotKey,
        newSeat: row.newSeat,
        evaluatorId: row.evaluatorId,
      })),
    ),
  };
}

/** Mirror of the SQL undo guard: no bookings may be added since the snapshot. */
export function undoBookingGuard(
  snapshotBookingIds: readonly string[],
  currentBookingIds: readonly string[],
): { ok: boolean; code?: "restructure_has_new_bookings" } {
  const before = new Set(snapshotBookingIds);
  const now = new Set(currentBookingIds);
  if (before.size !== now.size || [...now].some((id) => !before.has(id))) {
    return { ok: false, code: "restructure_has_new_bookings" };
  }
  return { ok: true };
}

export type { RestructureDayInput as DayInput };
