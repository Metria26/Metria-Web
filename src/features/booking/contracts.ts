import { z } from "zod";
import { restructureDaySchema } from "./restructure";

/**
 * Zod contracts for evaluation booking server boundaries (T-A006, features
 * 3.1/3.2). FormData arrives as strings — coerce before checks. Messages are
 * i18n keys; raw Postgres details never reach the client.
 */

export const periodInputSchema = z
  .object({
    offeringId: z.string().uuid("offeringRequired"),
    sectionId: z.string().uuid("sectionRequired"),
    title: z.string().trim().min(3, "titleMin").max(120, "titleMax"),
    startsAt: z.string().min(1, "startsRequired"),
    endsAt: z.string().min(1, "endsRequired"),
    cutoffHours: z.coerce.number().int("cutoffInteger").min(0, "cutoffMin").max(168, "cutoffMax"),
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: "endsAfterStarts",
    path: ["endsAt"],
  });
export type PeriodInput = z.infer<typeof periodInputSchema>;

export const slotInputSchema = z
  .object({
    periodId: z.string().uuid("periodRequired"),
    startsAt: z.string().min(1, "startsRequired"),
    endsAt: z.string().min(1, "endsRequired"),
    capacity: z.coerce
      .number()
      .int("capacityInteger")
      .min(1, "capacityMin")
      .max(500, "capacityMax"),
    location: z.string().trim().max(120, "locationMax").optional().default(""),
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: "endsAfterStarts",
    path: ["endsAt"],
  });
export type SlotInput = z.infer<typeof slotInputSchema>;

export const bookingInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  slotId: z.string().uuid("slotRequired"),
});

export const cancelBookingInputSchema = z.object({
  bookingId: z.string().uuid("bookingRequired"),
  periodId: z.string().uuid("periodRequired"),
});

/** "Switch slot": move the caller's active booking to a free slot (D-k RPC). */
export const switchBookingInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  targetSlotId: z.string().uuid("slotRequired"),
});

/** Staff capacity edit; the RPC refuses going below current active bookings. */
export const slotCapacityInputSchema = z.object({
  slotId: z.string().uuid("slotRequired"),
  capacity: z.coerce.number().int("capacityInteger").min(1, "capacityMin").max(500, "capacityMax"),
});

/** An evaluator is a plain record: no account, no login. Order is explicit. */
export const evaluatorInputSchema = z.object({
  id: z.string().uuid("invalidInput").optional(),
  name: z.string().trim().min(1, "evaluatorNameRequired").max(120, "evaluatorNameMax"),
  email: z.string().trim().max(254, "emailMax").optional(),
  phone: z.string().trim().max(60, "evaluatorContactMax").optional(),
  contactNote: z.string().trim().max(500, "evaluatorNoteMax").optional(),
  position: z.coerce.number().int("invalidInput").min(0, "invalidInput").max(999, "invalidInput"),
});
export type EvaluatorInput = z.infer<typeof evaluatorInputSchema>;

/** The evaluator list arrives as a JSON string from the client editor. */
export const evaluatorsInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  evaluators: z.string().min(1, "evaluatorRequired"),
});

export const reassignEvaluatorInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  bookingId: z.string().uuid("bookingRequired"),
  evaluatorId: z.string().uuid("evaluatorRequired"),
});

export const bulkReassignInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  fromEvaluatorId: z.string().uuid("evaluatorRequired"),
  toEvaluatorId: z.string().uuid("evaluatorRequired"),
});

export const removeEvaluatorInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  evaluatorId: z.string().uuid("evaluatorRequired"),
  replacementId: z.string().uuid().optional(),
});

/** Staff: rebalance every active booking across the whole evaluator roster. */
export const redistributeInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
});

export const deleteBookingInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  bookingId: z.string().uuid("bookingRequired"),
});

/** Admin slot restructure: the exact previewed plan is sent back for apply. */
export const restructureApplyInputSchema = z.object({
  periodId: z.string().uuid("periodRequired"),
  slotMinutes: z.coerce.number().int().min(1).max(240),
  capacity: z.coerce.number().int().min(1).max(500),
  keepEvaluator: z.coerce.boolean(),
  fillAfterLast: z.coerce.boolean(),
  days: z.array(restructureDaySchema).min(1),
  plan: z.array(
    z.object({
      dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      bookingId: z.string().uuid(),
      newSlotKey: z.string().min(1),
      newSeat: z.coerce.number().int().positive(),
      evaluatorId: z.string().uuid().nullable(),
    }),
  ),
});

/** Success may carry a non-blocking warning (e.g. duplicate evaluator in a slot). */
export type ActionResult =
  { ok: true; warning?: string } | { ok: false; error: string; detail?: string };
