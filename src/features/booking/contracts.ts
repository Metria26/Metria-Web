import { z } from "zod";

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

export type ActionResult = { ok: true } | { ok: false; error: string };
