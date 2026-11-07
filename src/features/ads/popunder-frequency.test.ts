import { describe, expect, it } from "vitest";
import {
  AD_VISITOR_COOKIE,
  POPUNDER_MAX_OPENS,
  POPUNDER_WINDOW_MS,
  parseVisitorCookie,
  popunderAllowedAt,
  prunePopunderShows,
  serializeVisitorState,
  visitorForContext,
  withPopunderShown,
} from "./visitor";

/**
 * ADR-013: the first-party popunder cap allows four successful opens per 24
 * hours. These tests pin the window/pruning math and the backward-compatible
 * cookie shape; the component test covers browser injection and open tracking.
 */

const NOW = 1_800_000_000_000;

describe("visitor cookie popunder state", () => {
  it("defaults popunder history for the old cookie shape", () => {
    const state = parseVisitorCookie(JSON.stringify({ id: "v1", popStyleShownAt: NOW }));
    expect(state).toEqual({ id: "v1", popStyleShownAt: NOW, popunderShownAt: [] });
  });

  it("drops non-numeric and negative timestamps", () => {
    const state = parseVisitorCookie(
      JSON.stringify({
        id: "v1",
        popStyleShownAt: null,
        popunderShownAt: [NOW, "nope", -1, Number.NaN, null],
      }),
    );
    expect(state?.popunderShownAt).toEqual([NOW]);
  });

  it("accepts a percent-encoded cookie", () => {
    const encoded = encodeURIComponent(
      serializeVisitorState({
        id: "v1",
        popStyleShownAt: null,
        popunderShownAt: [NOW],
      }),
    );
    expect(parseVisitorCookie(encoded)?.popunderShownAt).toEqual([NOW]);
  });

  it("round-trips the cap history", () => {
    const state = { id: "v1", popStyleShownAt: null, popunderShownAt: [NOW - 1, NOW] };
    expect(parseVisitorCookie(serializeVisitorState(state))).toEqual(state);
  });

  it("creates fresh visitors with an empty history", () => {
    expect(visitorForContext(null, () => "new-id")).toEqual({
      id: "new-id",
      popStyleShownAt: null,
      popunderShownAt: [],
    });
  });

  it("keeps the cookie name stable", () => {
    expect(AD_VISITOR_COOKIE).toBe("metria_ad_visitor");
  });
});

describe("popunder frequency window", () => {
  it("allows the fourth open and blocks the fifth", () => {
    const three = [NOW - 3, NOW - 2, NOW - 1];
    expect(popunderAllowedAt(three, NOW)).toBe(true);
    expect(popunderAllowedAt([...three, NOW], NOW)).toBe(false);
  });

  it("frees a slot once an open falls outside the 24-hour window", () => {
    const recent = [NOW - 3, NOW - 2, NOW - 1, NOW];
    expect(popunderAllowedAt(recent, NOW)).toBe(false);
    expect(popunderAllowedAt(recent, NOW + POPUNDER_WINDOW_MS)).toBe(true);
  });

  it("prunes expired and future timestamps", () => {
    expect(prunePopunderShows([NOW - POPUNDER_WINDOW_MS, NOW - 1, NOW + 1], NOW)).toEqual([
      NOW - 1,
    ]);
  });

  it("keeps only the newest four entries", () => {
    const entries = [NOW - 5, NOW - 4, NOW - 3, NOW - 2, NOW - 1];
    expect(prunePopunderShows(entries, NOW)).toEqual([NOW - 4, NOW - 3, NOW - 2, NOW - 1]);
    expect(POPUNDER_MAX_OPENS).toBe(4);
  });

  it("records an open and preserves the rest of the visitor state", () => {
    const next = withPopunderShown(
      { id: "v1", popStyleShownAt: NOW - 10, popunderShownAt: [NOW - 1] },
      NOW,
    );
    expect(next).toEqual({
      id: "v1",
      popStyleShownAt: NOW - 10,
      popunderShownAt: [NOW - 1, NOW],
    });
  });
});
