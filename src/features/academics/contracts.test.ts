import { describe, expect, it } from "vitest";
import {
  assessmentInputSchema,
  courseInputSchema,
  enrollmentInputSchema,
  offeringInputSchema,
  sectionInputSchema,
} from "./contracts";

const COURSE_ID = "11111111-1111-4111-8111-111111111111";
const TERM_ID = "22222222-2222-4222-8222-222222222222";
const OFFERING_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";

describe("courseInputSchema", () => {
  it("accepts a minimal valid course", () => {
    const result = courseInputSchema.safeParse({ code: "CS301", title: "Software Engineering I" });
    expect(result.success).toBe(true);
  });

  it("trims whitespace and defaults description", () => {
    const result = courseInputSchema.safeParse({
      code: " CS301 ",
      title: "  Software Engineering I  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("CS301");
      expect(result.data.description).toBe("");
    }
  });

  it("rejects codes with spaces or symbols", () => {
    expect(
      courseInputSchema.safeParse({ code: "CS 301!", title: "Software Engineering I" }).success,
    ).toBe(false);
  });

  it("rejects a short title", () => {
    expect(courseInputSchema.safeParse({ code: "CS301", title: "AB" }).success).toBe(false);
  });

  it("rejects a non-uuid departmentId", () => {
    expect(
      courseInputSchema.safeParse({
        code: "CS301",
        title: "Software Engineering I",
        departmentId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("offeringInputSchema", () => {
  it("accepts a valid offering", () => {
    const result = offeringInputSchema.safeParse({
      courseId: COURSE_ID,
      termId: TERM_ID,
      offeringCode: "CS301-F26",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing course or term", () => {
    expect(
      offeringInputSchema.safeParse({ termId: TERM_ID, offeringCode: "CS301-F26" }).success,
    ).toBe(false);
    expect(
      offeringInputSchema.safeParse({ courseId: COURSE_ID, offeringCode: "CS301-F26" }).success,
    ).toBe(false);
  });
});

describe("sectionInputSchema", () => {
  it("accepts a section without capacity", () => {
    const result = sectionInputSchema.safeParse({ offeringId: OFFERING_ID, sectionCode: "A" });
    expect(result.success).toBe(true);
  });

  it("coerces capacity from form strings", () => {
    const result = sectionInputSchema.safeParse({
      offeringId: OFFERING_ID,
      sectionCode: "A",
      capacity: "40",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBe(40);
  });

  it("rejects capacity below 1", () => {
    expect(
      sectionInputSchema.safeParse({ offeringId: OFFERING_ID, sectionCode: "A", capacity: "0" })
        .success,
    ).toBe(false);
  });
});

describe("assessmentInputSchema", () => {
  it("accepts a valid assessment with defaults", () => {
    const result = assessmentInputSchema.safeParse({
      offeringId: OFFERING_ID,
      title: "Quiz 1",
      assessmentType: "quiz",
      total: "10",
      weight: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(10);
      expect(result.data.weight).toBe(10);
      expect(result.data.visibility).toBe("private");
    }
  });

  it("accepts an offering-wide assessment (no section)", () => {
    const result = assessmentInputSchema.safeParse({
      offeringId: OFFERING_ID,
      title: "Midterm",
      assessmentType: "exam",
      total: 30,
      weight: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive total", () => {
    expect(
      assessmentInputSchema.safeParse({
        offeringId: OFFERING_ID,
        title: "Quiz 1",
        assessmentType: "quiz",
        total: 0,
        weight: 10,
      }).success,
    ).toBe(false);
  });

  it("rejects weight above 100", () => {
    expect(
      assessmentInputSchema.safeParse({
        offeringId: OFFERING_ID,
        title: "Quiz 1",
        assessmentType: "quiz",
        total: 10,
        weight: 101,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown assessment types", () => {
    expect(
      assessmentInputSchema.safeParse({
        offeringId: OFFERING_ID,
        title: "Quiz 1",
        assessmentType: "pop-quiz",
        total: 10,
        weight: 10,
      }).success,
    ).toBe(false);
  });
});

describe("enrollmentInputSchema", () => {
  it("accepts and lowercases a valid email", () => {
    const result = enrollmentInputSchema.safeParse({
      sectionId: SECTION_ID,
      studentEmail: " Student.Dev@LHR.NU.EDU.PK ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.studentEmail).toBe("student.dev@lhr.nu.edu.pk");
  });

  it("rejects malformed emails", () => {
    expect(
      enrollmentInputSchema.safeParse({ sectionId: SECTION_ID, studentEmail: "not-an-email" })
        .success,
    ).toBe(false);
  });
});
