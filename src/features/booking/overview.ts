import { z } from "zod";

/**
 * T-A006 app-side contract for private.period_booking_overview() (see the
 * evaluation_booking migration). Students receive per-slot availability counts
 * and their own booking only; offering staff also receive booked student names
 * (never emails). The payload is parsed here so contract drift fails loudly.
 */

/** Evaluator details are staff-only except for the caller's own booking. */
export const bookingEvaluatorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  contact_note: z.string().nullable(),
  position: z.coerce.number(),
});
export type BookingEvaluator = z.infer<typeof bookingEvaluatorSchema>;

export const myBookingEvaluatorSchema = bookingEvaluatorSchema.omit({ position: true });

export const bookingSeatSchema = z.object({
  id: z.string().uuid(),
  seat_number: z.coerce.number(),
  evaluator_id: z.string().uuid().nullable(),
  evaluator_name: z.string().nullable(),
  booking_id: z.string().uuid().nullable(),
  student_name: z.string().nullable(),
  student_email: z.string().nullable(),
  status: z.string().nullable(),
});
export type BookingSeat = z.infer<typeof bookingSeatSchema>;

export const bookingSlotOverviewSchema = z.object({
  id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  capacity: z.coerce.number(),
  location: z.string().nullable(),
  booked: z.coerce.number(),
  my_booking_id: z.string().uuid().nullable(),
  /** Never populated for slots the student has not booked. */
  my_evaluator: myBookingEvaluatorSchema.nullable(),
  /** Staff-only; empty array for students. */
  seats: z.array(bookingSeatSchema),
});

export const bookingPeriodSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  offering_id: z.string().uuid(),
  section_id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  cutoff_hours: z.coerce.number(),
  offering_code: z.string(),
  course_code: z.string(),
  section_code: z.string(),
});

export const bookingStudentSchema = z.object({
  slot_id: z.string().uuid(),
  slot_starts_at: z.string(),
  student_name: z.string(),
  /** Staff-only (registry delta 2026-11-08): students never receive emails. */
  student_email: z.string().optional(),
  booked_at: z.string().optional(),
  status: z.string(),
  booking_id: z.string().uuid().optional(),
  seat_number: z.coerce.number().optional(),
  evaluator_id: z.string().uuid().nullable().optional(),
  evaluator_name: z.string().nullable().optional(),
});

export const periodBookingOverviewSchema = z.object({
  period: bookingPeriodSchema,
  can_manage: z.boolean(),
  /** Staff-only; always [] for students so evaluators stay hidden pre-booking. */
  evaluators: z.array(bookingEvaluatorSchema),
  slots: z.array(bookingSlotOverviewSchema),
  students: z.array(bookingStudentSchema),
});

export type PeriodBookingOverview = z.infer<typeof periodBookingOverviewSchema>;
export type BookingSlotOverview = z.infer<typeof bookingSlotOverviewSchema>;
export type BookingStudent = z.infer<typeof bookingStudentSchema>;

type RpcEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type RpcTransport = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcEnvelope>;
};

/**
 * Loads the period overview for the caller. Returns null for non-participants
 * (the RPC answers 'not_found' instead of leaking existence) so pages can
 * render the 404 state; any other error is thrown for the error boundary.
 */
export async function loadPeriodBookingOverview(
  supabase: unknown,
  periodId: string,
): Promise<PeriodBookingOverview | null> {
  const { data, error } = await (supabase as RpcTransport).rpc("period_booking_overview", {
    p_period_id: periodId,
  });
  if (error) {
    if (String(error.message).includes("not_found")) return null;
    throw new Error(error.message);
  }
  return periodBookingOverviewSchema.parse(data);
}
