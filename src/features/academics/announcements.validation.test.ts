import { describe, expect, it } from "vitest";
import { announcementInputSchema } from "@/features/academics/contracts";
import { sanitizeAnnouncementHtml } from "@/features/academics/sanitize";
import { studentDashboardSchema } from "@/features/academics/dashboard";
import { offeringAnalyticsSchema } from "@/features/academics/analytics";

describe("sanitizeAnnouncementHtml (D8)", () => {
  it("keeps the allowlisted formatting tags", () => {
    const clean = sanitizeAnnouncementHtml(
      "<p>Read <strong>chapter 3</strong> and <em>review</em></p><ul><li>one</li></ul>",
    );
    expect(clean).toContain("<strong>chapter 3</strong>");
    expect(clean).toContain("<em>review</em>");
    expect(clean).toContain("<li>one</li>");
  });

  it("strips script tags and their contents", () => {
    const clean = sanitizeAnnouncementHtml('<p>hi</p><script>alert("xss")</script>');
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
  });

  it("drops event handler attributes", () => {
    const clean = sanitizeAnnouncementHtml('<p onclick="steal()">hi</p><img src="x" onerror="x">');
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("<img");
  });

  it("drops javascript: URLs but keeps https links", () => {
    const jsUrl = sanitizeAnnouncementHtml('<a href="javascript:alert(1)">x</a>');
    expect(jsUrl).not.toContain("javascript:");
    const safe = sanitizeAnnouncementHtml('<a href="https://example.com">x</a>');
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('rel="noopener noreferrer"');
    expect(safe).toContain('target="_blank"');
  });

  it("is idempotent (render-time sanitize cannot re-introduce anything)", () => {
    const once = sanitizeAnnouncementHtml("<p>a</p><script>bad()</script>");
    expect(sanitizeAnnouncementHtml(once)).toBe(once);
  });
});

describe("announcementInputSchema", () => {
  const valid = {
    sectionId: "aaaaaaaa-0000-4000-8000-000000000013",
    title: "Midterm update",
    bodyHtml: "<p>Bring calculators.</p>",
  };

  it("accepts a valid announcement", () => {
    expect(announcementInputSchema.safeParse(valid).success).toBe(true);
  });

  it("trims and rejects a title that is too short", () => {
    expect(announcementInputSchema.safeParse({ ...valid, title: " a " }).success).toBe(false);
  });

  it("rejects a missing body and a non-uuid section", () => {
    expect(announcementInputSchema.safeParse({ ...valid, bodyHtml: "" }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, sectionId: "nope" }).success).toBe(false);
  });
});

describe("studentDashboardSchema", () => {
  it("parses the RPC payload with all registered keys", () => {
    const parsed = studentDashboardSchema.parse({
      latest_marks: [
        {
          assessment_title: "Quiz A",
          assessment_type: "quiz",
          course_code: "A00501",
          course_title: "A005 Course",
          offering_id: "aaaaaaaa-0000-4000-8000-000000000012",
          score: "60.00",
          total: "100.00",
          recorded_at: "2026-10-16T12:00:00Z",
        },
      ],
      announcements: [],
      upcoming_assessments: [],
      evaluation_slots: [],
    });
    expect(parsed.latest_marks[0]?.score).toBe(60);
  });

  it("rejects a payload missing a registered key", () => {
    expect(studentDashboardSchema.safeParse({ latest_marks: [], announcements: [] }).success).toBe(
      false,
    );
  });
});

describe("offeringAnalyticsSchema (k>=5 handling)", () => {
  it("parses a suppressed assessment with nulled stats", () => {
    const parsed = offeringAnalyticsSchema.parse({
      offering_id: "aaaaaaaa-0000-4000-8000-000000000012",
      k: 5,
      assessments: [
        {
          assessment_id: "aaaaaaaa-0000-4000-8000-000000000021",
          title: "Quiz B",
          assessment_type: "quiz",
          total: 100,
          n: 3,
          suppressed: true,
          avg_percent: null,
          min_percent: null,
          max_percent: null,
          bucket_0_49: null,
          bucket_50_74: null,
          bucket_75_100: null,
          created_at: "2026-10-16T12:00:00Z",
        },
      ],
      sections: [
        {
          section_id: "aaaaaaaa-0000-4000-8000-000000000014",
          section_code: "B",
          n: 2,
          suppressed: true,
          avg_percent: null,
        },
      ],
    });
    expect(parsed.assessments[0]?.suppressed).toBe(true);
    expect(parsed.assessments[0]?.avg_percent).toBeNull();
  });
});
