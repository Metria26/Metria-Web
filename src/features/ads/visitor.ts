/**
 * First-party ad visitor state (T-B002, D13/ADR-013): a random browser-storage
 * id, the last resolver pop-style timestamp, and the successful popunder open
 * timestamps used by the 4-per-24-hour cap. Cookie-based so the server resolver
 * can read it during SSR. No fingerprinting, no third-party storage.
 */

export const AD_VISITOR_COOKIE = "metria_ad_visitor";
export const AD_VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** ADR-013: successful popunder opens are capped at four per 24 hours. */
export const POPUNDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const POPUNDER_MAX_OPENS = 4;

export type AdVisitorState = {
  id: string;
  popStyleShownAt: number | null;
  popunderShownAt: number[];
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      return null;
    }
  }
}

function normalizePopunderShows(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
    )
    .sort((a, b) => a - b);
}

export function parseVisitorCookie(value: string | null | undefined): AdVisitorState | null {
  if (!value) return null;
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  const shownAt = record.popStyleShownAt;
  return {
    id: record.id,
    popStyleShownAt:
      typeof shownAt === "number" && Number.isFinite(shownAt) && shownAt >= 0 ? shownAt : null,
    popunderShownAt: normalizePopunderShows(record.popunderShownAt),
  };
}

export function serializeVisitorState(state: AdVisitorState): string {
  return JSON.stringify({
    id: state.id,
    popStyleShownAt: state.popStyleShownAt,
    popunderShownAt: state.popunderShownAt,
  });
}

function defaultRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Random first-party id; the generator is injectable so tests stay deterministic. */
export function newVisitorId(randomUuid: () => string = defaultRandomId): string {
  return randomUuid();
}

/** Existing state, or a fresh visitor with a new random id. */
export function visitorForContext(
  value: string | null | undefined,
  randomUuid?: () => string,
): AdVisitorState {
  return (
    parseVisitorCookie(value) ?? {
      id: newVisitorId(randomUuid),
      popStyleShownAt: null,
      popunderShownAt: [],
    }
  );
}

export function withPopStyleShown(state: AdVisitorState, now: number): AdVisitorState {
  return { ...state, popStyleShownAt: now };
}

/** Keeps only recent, non-future popunder opens and the newest capped batch. */
export function prunePopunderShows(timestamps: readonly number[], now: number): number[] {
  const cutoff = now - POPUNDER_WINDOW_MS;
  return timestamps
    .filter((entry) => Number.isFinite(entry) && entry > cutoff && entry <= now)
    .sort((a, b) => a - b)
    .slice(-POPUNDER_MAX_OPENS);
}

export function popunderAllowedAt(timestamps: readonly number[], now: number): boolean {
  return prunePopunderShows(timestamps, now).length < POPUNDER_MAX_OPENS;
}

export function withPopunderShown(state: AdVisitorState, now: number): AdVisitorState {
  return {
    ...state,
    popunderShownAt: prunePopunderShows([...state.popunderShownAt, now], now),
  };
}
