/**
 * First-party ad visitor state (T-B002, D13): a random browser-storage id plus
 * the last pop-style timestamp used by the 24h cap. Cookie-based so the server
 * resolver can read it during SSR. No fingerprinting, no third-party storage.
 */

export const AD_VISITOR_COOKIE = "metria_ad_visitor";
export const AD_VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export type AdVisitorState = {
  id: string;
  popStyleShownAt: number | null;
};

export function parseVisitorCookie(value: string | null | undefined): AdVisitorState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) return null;
    const shownAt = record.popStyleShownAt;
    return {
      id: record.id,
      popStyleShownAt:
        typeof shownAt === "number" && Number.isFinite(shownAt) && shownAt >= 0 ? shownAt : null,
    };
  } catch {
    return null;
  }
}

export function serializeVisitorState(state: AdVisitorState): string {
  return JSON.stringify({ id: state.id, popStyleShownAt: state.popStyleShownAt });
}

/** Random first-party id; the generator is injectable so tests stay deterministic. */
export function newVisitorId(randomUuid: () => string = () => crypto.randomUUID()): string {
  return randomUuid();
}

/** Existing state, or a fresh visitor with a new random id. */
export function visitorForContext(
  value: string | null | undefined,
  randomUuid?: () => string,
): AdVisitorState {
  return parseVisitorCookie(value) ?? { id: newVisitorId(randomUuid), popStyleShownAt: null };
}

export function withPopStyleShown(state: AdVisitorState, now: number): AdVisitorState {
  return { id: state.id, popStyleShownAt: now };
}
