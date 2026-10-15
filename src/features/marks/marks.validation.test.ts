import { describe, expect, it } from "vitest";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  importPreviewRequestSchema,
  markInputSchema,
} from "./contracts";
import {
  classifyRows,
  errorsToCsv,
  isValidEmail,
  rowHashInput,
  withinCsvLimits,
} from "./import-logic";
import { cellStatus, classify, gradeFor, round2, weightedTotal } from "./marksheet";

const ASSESSMENT_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "idem-key-1234567890";

describe("markInputSchema", () => {
  it("coerces a numeric score to a number", () => {
    const result = markInputSchema.safeParse({
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      score: "12.5",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.score).toBe(12.5);
  });

  it("treats an empty score as null (clear back to pending)", () => {
    const result = markInputSchema.safeParse({
      assessmentId: ASSESSMENT_ID,
      studentId: STUDENT_ID,
      score: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.score).toBe(null);
  });

  it("rejects negative or non-numeric scores", () => {
    for (const score of ["-1", "abc", "NaN", "Infinity"]) {
      expect(
        markInputSchema.safeParse({ assessmentId: ASSESSMENT_ID, studentId: STUDENT_ID, score })
          .success,
      ).toBe(false);
    }
  });

  it("rejects non-uuid ids", () => {
    expect(
      markInputSchema.safeParse({ assessmentId: "nope", studentId: STUDENT_ID, score: "5" })
        .success,
    ).toBe(false);
  });
});

describe("importPreviewRequestSchema", () => {
  it("accepts a minimal request and defaults overwrite", () => {
    const result = importPreviewRequestSchema.safeParse({
      assessmentId: ASSESSMENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      rows: [{ email: "a@lhr.nu.edu.pk", score: "10" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.overwrite).toBe(false);
  });

  it("rejects a non-conforming idempotency key", () => {
    const result = importPreviewRequestSchema.safeParse({
      assessmentId: ASSESSMENT_ID,
      idempotencyKey: "bad key!",
      rows: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than CSV_MAX_ROWS rows", () => {
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => ({
      email: `s${i}@lhr.nu.edu.pk`,
      score: "1",
    }));
    expect(
      importPreviewRequestSchema.safeParse({
        assessmentId: ASSESSMENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        rows,
      }).success,
    ).toBe(false);
  });
});

describe("withinCsvLimits", () => {
  it("accepts exactly at the boundary", () => {
    expect(withinCsvLimits(CSV_MAX_BYTES, CSV_MAX_ROWS)).toBe(true);
  });

  it("rejects one byte or one row over", () => {
    expect(withinCsvLimits(CSV_MAX_BYTES + 1, 1)).toBe(false);
    expect(withinCsvLimits(1, CSV_MAX_ROWS + 1)).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a university-style address", () => {
    expect(isValidEmail("student.dev@lhr.nu.edu.pk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const email of ["", "plain", "a@b", "a b@c.d", "@x.y", "a@.y"]) {
      expect(isValidEmail(email)).toBe(false);
    }
  });
});

describe("classifyRows cascade", () => {
  const total = 20;
  const resolveEnrolled = (email: string) => ({ profileId: `p-${email}`, enrolled: true });

  it("marks a resolvable row ready and counts it", () => {
    const { rows, counts } = classifyRows([{ email: "a@x.edu", score: "15" }], {
      assessmentTotal: total,
      resolve: resolveEnrolled,
      markExists: () => false,
    });
    expect(rows[0]).toMatchObject({
      status: "ready",
      errorCode: null,
      existing: false,
      proposedScore: 15,
    });
    expect(counts).toMatchObject({ ready: 1, invalid: 0, not_found: 0, duplicate: 0, existing: 0 });
  });

  it("flags ready rows that already have a mark as existing", () => {
    const { rows, counts } = classifyRows([{ email: "a@x.edu", score: "15" }], {
      assessmentTotal: total,
      resolve: resolveEnrolled,
      markExists: () => true,
    });
    expect(rows[0]).toMatchObject({ status: "ready", errorCode: "exists", existing: true });
    expect(counts.existing).toBe(1);
    expect(counts.ready).toBe(1);
  });

  it("rejects bad emails before score checks", () => {
    const { rows, counts } = classifyRows([{ email: "not-an-email", score: "abc" }], {
      assessmentTotal: total,
      resolve: resolveEnrolled,
      markExists: () => false,
    });
    expect(rows[0]).toMatchObject({ status: "invalid", errorCode: "email_invalid" });
    expect(counts.invalid).toBe(1);
  });

  it("rejects empty, non-numeric, and negative scores", () => {
    const { rows } = classifyRows(
      [
        { email: "a@x.edu", score: "" },
        { email: "b@x.edu", score: "twelve" },
        { email: "c@x.edu", score: "-3" },
      ],
      { assessmentTotal: total, resolve: resolveEnrolled, markExists: () => false },
    );
    for (const row of rows) {
      expect(row.status).toBe("invalid");
      expect(row.errorCode).toBe("score_invalid");
    }
  });

  it("rejects scores above the assessment total", () => {
    const { rows } = classifyRows([{ email: "a@x.edu", score: "20.01" }], {
      assessmentTotal: total,
      resolve: resolveEnrolled,
      markExists: () => false,
    });
    expect(rows[0]).toMatchObject({ status: "invalid", errorCode: "score_out_of_range" });
  });

  it("keeps the first occurrence of a duplicated email and dups the rest", () => {
    const { rows, counts } = classifyRows(
      [
        { email: "a@x.edu", score: "10" },
        { email: " A@X.EDU ", score: "12" },
      ],
      { assessmentTotal: total, resolve: resolveEnrolled, markExists: () => false },
    );
    expect(rows[0]).toMatchObject({ status: "ready" });
    expect(rows[1]).toMatchObject({ status: "duplicate", errorCode: "duplicate_email" });
    expect(counts).toMatchObject({ ready: 1, duplicate: 1 });
  });

  it("separates unknown students from unenrolled ones", () => {
    const { rows, counts } = classifyRows(
      [
        { email: "ghost@x.edu", score: "10" },
        { email: "outsider@x.edu", score: "10" },
      ],
      {
        assessmentTotal: total,
        resolve: (email) =>
          email === "ghost@x.edu" ? undefined : { profileId: "p2", enrolled: false },
        markExists: () => false,
      },
    );
    expect(rows[0]).toMatchObject({ status: "not_found", errorCode: "student_not_found" });
    expect(rows[1]).toMatchObject({ status: "not_found", errorCode: "not_enrolled" });
    expect(counts.not_found).toBe(2);
  });
});

describe("errorsToCsv", () => {
  it("writes a header and escapes commas/quotes", () => {
    const csv = errorsToCsv([
      { row: 1, email: "plain@x.edu", status: "invalid", code: "score_invalid" },
      { row: 2, email: 'comma,"quoted@x.edu', status: "duplicate", code: "duplicate_email" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("row,email,status,reason");
    expect(lines[1]).toBe("1,plain@x.edu,invalid,score_invalid");
    expect(lines[2]).toBe('2,"comma,""quoted@x.edu",duplicate,duplicate_email');
  });
});

describe("rowHashInput", () => {
  it("normalizes email and includes the row number", () => {
    expect(rowHashInput(3, "  A@X.EDU ", " 12 ")).toBe("a@x.edu|12|3");
  });
});

describe("marksheet math (parity with private.offering_marksheet)", () => {
  const assessments = [
    { id: "a1", total: 10, weight: 40 },
    { id: "a2", total: 50, weight: 60 },
  ];

  it("computes the weighted total only over graded assessments", () => {
    const { total, gradedWeight } = weightedTotal(assessments, { a1: 8, a2: null });
    expect(total).toBe(32); // 8/10 × 40
    expect(gradedWeight).toBe(40);
  });

  it("sums multiple graded assessments with rounding", () => {
    const { total, gradedWeight } = weightedTotal(assessments, { a1: 7.5, a2: 40 });
    expect(total).toBe(78); // 7.5/10×40 + 40/50×60 = 30 + 48
    expect(gradedWeight).toBe(100);
  });

  it("returns zero when nothing is graded", () => {
    expect(weightedTotal(assessments, { a1: null, a2: undefined })).toEqual({
      total: 0,
      gradedWeight: 0,
    });
  });

  it("picks the highest band still reached, including exact boundaries", () => {
    const bands = [
      { min: 85, grade: "A" },
      { min: 70, grade: "B" },
      { min: 50, grade: "C" },
    ];
    expect(gradeFor(bands, 90)).toBe("A");
    expect(gradeFor(bands, 85)).toBe("A");
    expect(gradeFor(bands, 84.99)).toBe("B");
    expect(gradeFor(bands, 49)).toBe(null);
  });

  it("returns null without a grading scale", () => {
    expect(gradeFor(null, 95)).toBe(null);
    expect(gradeFor([], 95)).toBe(null);
  });

  it("classifies missing vs pending vs graded cells", () => {
    const buckets = classify(assessments, { a1: { score: null } });
    expect(buckets).toEqual({ missing: ["a2"], pending: ["a1"], graded: [] });
  });

  it("derives a cell status per the same rules", () => {
    expect(cellStatus(undefined)).toBe("missing");
    expect(cellStatus({ score: null })).toBe("pending");
    expect(cellStatus({ score: 0 })).toBe("graded");
  });

  it("rounds to two decimals", () => {
    expect(round2(33.335)).toBe(33.34);
    expect(round2(1 / 3)).toBe(0.33);
  });
});
