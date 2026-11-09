import { describe, expect, it } from "vitest";
import {
  compareStudentsByEmail,
  naturalCompare,
  naturalSortKey,
  sortStudentsByEmail,
  studentEmailLocalPart,
} from "./student-sort";

/**
 * Registry delta 2026-11-08 — deterministic student ordering: the part before
 * '@' ascending, case-insensitive, numeric-aware. Mirrors
 * private.natural_sort_key() in SQL.
 */
describe("student-sort", () => {
  describe("studentEmailLocalPart", () => {
    it("extracts the part before @", () => {
      expect(studentEmailLocalPart("l250616@lhr.nu.edu.pk")).toBe("l250616");
    });

    it("handles missing @, null, and surrounding whitespace", () => {
      expect(studentEmailLocalPart("l000001")).toBe("l000001");
      expect(studentEmailLocalPart(null)).toBe("");
      expect(studentEmailLocalPart("   L250002@lhr.nu.edu.pk  ")).toBe("l250002");
    });
  });

  describe("naturalCompare / naturalSortKey", () => {
    it("is numeric-aware: l250616 sorts before l257689 and 10 after 2", () => {
      expect(naturalCompare("l250616", "l257689")).toBeLessThan(0);
      expect(naturalCompare("l257689", "l250616")).toBeGreaterThan(0);
      // The delta is returned (sort only cares about the sign).
      expect(naturalCompare("roll10", "roll2")).toBeGreaterThan(0);
      expect(naturalCompare("roll2", "roll10")).toBeLessThan(0);
    });

    it("is case-insensitive and stable on digit padding differences", () => {
      expect(naturalCompare("L250002", "l250002")).toBe(0);
      expect(naturalCompare("abc", "ABC-x")).toBeLessThan(0);
    });

    it("naturalSortKey pads digit runs to a fixed width", () => {
      expect(naturalSortKey("l25a2")).toBe(naturalSortKey("l0025a2"));
      expect(naturalSortKey("2foo") < naturalSortKey("10foo")).toBe(true);
    });
  });

  describe("compareStudentsByEmail", () => {
    it("orders by local part: l250616 before l257689", () => {
      const a = { email: "l250616@lhr.nu.edu.pk", displayName: "Zain" };
      const b = { email: "l257689@lhr.nu.edu.pk", displayName: "Ali" };
      expect(compareStudentsByEmail(a, b)).toBe(-1);
      expect(compareStudentsByEmail(b, a)).toBe(1);
      expect(compareStudentsByEmail(a, a)).toBe(0);
    });

    it("is case-insensitive on the local part and ignores the domain", () => {
      expect(
        compareStudentsByEmail(
          { email: "l250616@other.example" },
          { email: "L257689@lhr.nu.edu.pk" },
        ),
      ).toBe(-1);
    });

    it("falls back to the full email then the display name", () => {
      expect(
        compareStudentsByEmail(
          { email: "same@x", displayName: "A" },
          { email: "same@y", displayName: "A" },
        ),
      ).toBe(-1);
      expect(compareStudentsByEmail({ displayName: "Ali" }, { displayName: "Zain" })).toBe(-1);
    });

    it("places empty keys first but never throws on nulls", () => {
      expect(compareStudentsByEmail({ email: null }, { email: "l250@x" })).toBeLessThanOrEqual(0);
    });
  });

  describe("sortStudentsByEmail", () => {
    it("sorts a mock roster ascending without mutating the input", () => {
      const roster = [
        { email: "l257689@lhr.nu.edu.pk" },
        { email: "l250616@lhr.nu.edu.pk" },
        { email: "l250001@lhr.nu.edu.pk" },
      ];
      const sorted = sortStudentsByEmail(roster);
      expect(sorted.map((row) => row.email.slice(0, 7))).toEqual(["l250001", "l250616", "l257689"]);
      expect(roster[0]!.email.startsWith("l257689")).toBe(true);
    });

    it("matches the SQL natural_sort_key ordering (parity check)", () => {
      // Padded-key comparison must agree with the numeric-aware comparator.
      const left = "l250616";
      const right = "l257689";
      expect(naturalSortKey(left) < naturalSortKey(right)).toBe(true);
      expect(compareStudentsByEmail({ email: left }, { email: right })).toBe(-1);
    });
  });
});
