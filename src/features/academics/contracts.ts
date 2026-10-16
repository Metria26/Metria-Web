import { z } from "zod";

/**
 * Zod contracts for core-academics server boundaries (D3 / T-A003).
 * FormData arrives as strings — coerce before numeric checks.
 */

export const courseInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "codeMin")
    .max(20, "codeMax")
    .regex(/^[A-Za-z0-9-]+$/, "codeCharset"),
  title: z.string().trim().min(3, "titleMin").max(120, "titleMax"),
  description: z.string().trim().max(1000, "descriptionMax").optional().default(""),
  departmentId: z.string().uuid().optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

export const offeringInputSchema = z.object({
  courseId: z.string().uuid("courseRequired"),
  termId: z.string().uuid("termRequired"),
  offeringCode: z
    .string()
    .trim()
    .min(3, "codeMin")
    .max(30, "codeMax")
    .regex(/^[A-Za-z0-9-]+$/, "codeCharset"),
});
export type OfferingInput = z.infer<typeof offeringInputSchema>;

export const sectionInputSchema = z.object({
  offeringId: z.string().uuid("offeringRequired"),
  sectionCode: z
    .string()
    .trim()
    .min(1, "sectionCodeMin")
    .max(10, "sectionCodeMax")
    .regex(/^[A-Za-z0-9-]+$/, "codeCharset"),
  capacity: z.coerce.number().int().min(1, "capacityMin").max(1000, "capacityMax").optional(),
});
export type SectionInput = z.infer<typeof sectionInputSchema>;

export const assessmentInputSchema = z.object({
  offeringId: z.string().uuid("offeringRequired"),
  sectionId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "titleMin").max(120, "titleMax"),
  assessmentType: z.enum(["quiz", "exam", "assignment", "project", "other"]),
  total: z.coerce.number().positive("totalPositive").max(100000, "totalMax"),
  weight: z.coerce.number().min(0, "weightMin").max(100, "weightMax"),
  visibility: z.enum(["private", "students"]).default("private"),
});
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;

export const enrollmentInputSchema = z.object({
  sectionId: z.string().uuid("sectionRequired"),
  studentEmail: z.string().trim().toLowerCase().email("emailInvalid").max(254, "emailMax"),
});
export type EnrollmentInput = z.infer<typeof enrollmentInputSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };

export const announcementInputSchema = z.object({
  sectionId: z.string().uuid("sectionRequired"),
  title: z.string().trim().min(2, "titleMin").max(200, "titleMax"),
  bodyHtml: z.string().trim().min(1, "bodyMin").max(50000, "bodyMax"),
});
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;
