/**
 * Counts actual Adsterra popunder opens for the first-party frequency cap
 * (ADR-013). The reviewed popunder script opens its sponsored page with
 * `window.open(url, "_blank")`, so wrapping that call gives a closer count
 * than recording script loads or page views.
 *
 * The wrapper also tries to keep focus on the current page: it blurs the new
 * tab and refocuses the opener, then retries shortly afterwards. Browsers may
 * ignore programmatic focus changes, so this is best-effort; Adsterra support
 * remains the reliable fix. It never blocks an open, and Adsterra's dashboard
 * cap remains the impression limiter.
 */

import { recordPopunderOpen } from "./popunder-cookie";

export const POPUNDER_OPEN_TRACKER_KEY = "__metria_popunder_open_tracker";

const FOCUS_RETRY_DELAYS_MS = [0, 250];

type TrackedWindow = Window & { __metria_popunder_open_tracker?: boolean };

function keepFocusOnCurrentPage(win: Window, opened: Window): void {
  try {
    opened.blur();
  } catch {
    // Cross-origin/hardened windows may reject blur(); focus() still runs.
  }
  try {
    win.focus();
  } catch {
    // Focus changes are best-effort and browser-dependent.
  }
  for (const delay of FOCUS_RETRY_DELAYS_MS) {
    setTimeout(() => {
      try {
        opened.blur();
      } catch {
        // Ignore windows that no longer allow blur().
      }
      try {
        win.focus();
      } catch {
        // Ignore browsers that deny focus after the user gesture ends.
      }
    }, delay);
  }
}

export function installPopunderOpenTracker(
  win: Window = window,
  now: () => number = Date.now,
): void {
  const tracked = win as TrackedWindow;
  if (tracked[POPUNDER_OPEN_TRACKER_KEY]) return;

  const originalOpen = win.open;
  if (typeof originalOpen !== "function") return;

  try {
    win.open = function (url?: string | URL, target?: string, features?: string) {
      const opened = originalOpen.call(win, url, target, features);
      if (opened && target === "_blank") {
        recordPopunderOpen(now());
        keepFocusOnCurrentPage(win, opened);
      }
      return opened;
    } as Window["open"];
    tracked[POPUNDER_OPEN_TRACKER_KEY] = true;
  } catch {
    // Some hardened browsers make window.open non-writable. Leave the script
    // alone; Adsterra's dashboard frequency cap remains in effect.
  }
}
