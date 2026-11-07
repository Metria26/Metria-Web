/**
 * Counts actual Adsterra popunder opens for the first-party frequency cap
 * (ADR-013). The reviewed popunder script opens its sponsored page with
 * `window.open(url, "_blank")`, so wrapping that call gives a closer count
 * than recording script loads or page views.
 *
 * The wrapper never changes focus and never blocks an open. Adsterra's own
 * dashboard cap remains the impression limiter; this tracker only decides
 * whether the script is injected again on later page loads.
 */

import { recordPopunderOpen } from "./popunder-cookie";

export const POPUNDER_OPEN_TRACKER_KEY = "__metria_popunder_open_tracker";

type TrackedWindow = Window & { __metria_popunder_open_tracker?: boolean };

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
      if (opened && target === "_blank") recordPopunderOpen(now());
      return opened;
    } as Window["open"];
    tracked[POPUNDER_OPEN_TRACKER_KEY] = true;
  } catch {
    // Some hardened browsers make window.open non-writable. Leave the script
    // alone; Adsterra's dashboard frequency cap remains in effect.
  }
}
