/**
 * Browser-side helpers for the first-party popunder frequency cap (ADR-013).
 *
 * The cap stores only a random visitor id and recent successful popunder open
 * timestamps in the existing `metria_ad_visitor` cookie. It is read after the
 * ad-consent gate has mounted the popunder component, so no cookie is written
 * before consent.
 */

import {
  AD_VISITOR_COOKIE,
  AD_VISITOR_COOKIE_MAX_AGE_SECONDS,
  parseVisitorCookie,
  popunderAllowedAt,
  serializeVisitorState,
  visitorForContext,
  withPopunderShown,
  type AdVisitorState,
} from "./visitor";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

export function readVisitorStateFromDocument(): AdVisitorState | null {
  return parseVisitorCookie(readCookie(AD_VISITOR_COOKIE));
}

/** True when this browser may load the popunder script again. */
export function popunderAllowedNow(now: number = Date.now()): boolean {
  const state = readVisitorStateFromDocument();
  return state ? popunderAllowedAt(state.popunderShownAt, now) : true;
}

/** Records one successful popunder open; called by the window.open tracker. */
export function recordPopunderOpen(now: number = Date.now(), randomUuid?: () => string): void {
  if (typeof document === "undefined") return;
  const state = visitorForContext(readCookie(AD_VISITOR_COOKIE), randomUuid);
  const serialized = encodeURIComponent(serializeVisitorState(withPopunderShown(state, now)));
  try {
    document.cookie = `${AD_VISITOR_COOKIE}=${serialized}; Path=/; Max-Age=${AD_VISITOR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // Cookie storage can be unavailable (private mode/quota). The ad network's
    // own frequency cap remains in effect; never break the page over this.
  }
}
