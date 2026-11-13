import { describe, expect, it } from "vitest";
import {
  createGroupInputSchema,
  dashboardInputSchema,
  isHttpUrl,
  reviewInputSchema,
  submitProjectInputSchema,
} from "./contracts";
import {
  mapRpcError,
  mapWriteError,
  memberChangeState,
  parseBulkMembers,
  studentContentAllowed,
} from "./rules";

describe("parseBulkMembers", () => {
  it("parses comma-separated name/reg lines", () => {
    const result = parseBulkMembers(
      "Ali Ahmed, 24L-1001\nHassan Khan, 24L-1002\nSara Malik, 24L-1003",
    );
    expect(result.members).toEqual([
      { name: "Ali Ahmed", regNo: "24L-1001" },
      { name: "Hassan Khan", regNo: "24L-1002" },
      { name: "Sara Malik", regNo: "24L-1003" },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("parses space-separated rows and skips blanks and comments", () => {
    const result = parseBulkMembers("# team list\n\nAli Ahmed 24L-1001\n   \n");
    expect(result.members).toEqual([{ name: "Ali Ahmed", regNo: "24L-1001" }]);
    expect(result.errors).toEqual([]);
  });

  it("flags missing registration numbers and duplicates", () => {
    const result = parseBulkMembers("Ali Ahmed\nAli Ahmed, 24L-1001\nAli Ahmed, 24L-1001");
    expect(result.members).toEqual([{ name: "Ali Ahmed", regNo: "24L-1001" }]);
    expect(result.errors).toEqual([
      { line: 1, code: "missingReg" },
      { line: 3, code: "duplicate" },
    ]);
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) URLs and rejects others", () => {
    expect(isHttpUrl("https://github.com/org/repo")).toBe(true);
    expect(isHttpUrl("http://example.com?a=1")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://files.example.com")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("studentContentAllowed", () => {
  const group = {
    submittedAt: "2026-11-01T00:00:00Z",
    status: "submitted" as const,
    archivedAt: null,
  };
  it("locks edits after submission unless the dashboard allows them", () => {
    expect(
      studentContentAllowed(group, { status: "published", allowEditAfterSubmission: false }),
    ).toBe(false);
    expect(
      studentContentAllowed(group, { status: "published", allowEditAfterSubmission: true }),
    ).toBe(true);
  });
  it("always allows revision_required resubmissions on published dashboards", () => {
    expect(
      studentContentAllowed(
        { ...group, status: "revision_required" },
        { status: "published", allowEditAfterSubmission: false },
      ),
    ).toBe(true);
  });
  it("blocks closed dashboards and archived groups", () => {
    expect(studentContentAllowed(group, { status: "closed", allowEditAfterSubmission: true })).toBe(
      false,
    );
    expect(
      studentContentAllowed(
        { ...group, archivedAt: "2026-11-02T00:00:00Z" },
        { status: "published", allowEditAfterSubmission: true },
      ),
    ).toBe(false);
  });
});

describe("memberChangeState", () => {
  const group = { submittedAt: null, status: "draft" as const, archivedAt: null };
  it("routes to the approval flow when the TA requires it", () => {
    expect(
      memberChangeState(group, {
        status: "published",
        allowEditAfterSubmission: false,
        allowMemberChangesAfterSubmission: true,
        requireMemberChangeApproval: true,
      }),
    ).toBe("approval");
  });
  it("locks member changes after submission without permission", () => {
    expect(
      memberChangeState(
        { ...group, submittedAt: "2026-11-01T00:00:00Z", status: "submitted" },
        {
          status: "published",
          allowEditAfterSubmission: false,
          allowMemberChangesAfterSubmission: false,
          requireMemberChangeApproval: false,
        },
      ),
    ).toBe("locked");
  });
});

describe("mapRpcError / mapWriteError", () => {
  it("maps stable codes", () => {
    expect(mapRpcError("duplicate_group_id")).toBe("duplicateGroupId");
    expect(mapRpcError("deadline_passed")).toBe("deadlinePassed");
    expect(mapRpcError("anything_else")).toBe("generic");
    expect(mapWriteError("42501")).toBe("notAuthorized");
    expect(mapWriteError("23505")).toBe("duplicate");
  });
});

describe("schemas", () => {
  it("rejects dashboards with max below min", () => {
    const result = dashboardInputSchema.safeParse({
      offeringId: "00000000-0000-0000-0000-000000000001",
      title: "FYP Dashboard",
      minMembers: 3,
      maxMembers: 2,
      groupIdPrefix: "COAL_P1",
    });
    expect(result.success).toBe(false);
  });

  it("requires a rejection reason for reject reviews", () => {
    const result = reviewInputSchema.safeParse({
      groupId: "00000000-0000-0000-0000-000000000002",
      reviewType: "reject",
      rejectionReason: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-http link URLs on submission", () => {
    const result = submitProjectInputSchema.safeParse({
      groupId: "00000000-0000-0000-0000-000000000003",
      responses: {},
      links: [{ title: "Repo", url: "javascript:alert(1)" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts roster profile ids on group members", () => {
    const result = createGroupInputSchema.safeParse({
      dashboardId: "11111111-1111-4111-8111-111111111111",
      projectTitle: "Smart Attendance",
      members: [
        {
          profileId: "22222222-2222-4222-8222-222222222222",
          name: "Ali Ahmed",
          regNo: "24L-1001",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
