/**
 * Adsterra unit registry (SS11, plan.md §11).
 *
 * These are PUBLIC ad codes, not secrets — but they still live in code (not the
 * database) per ADR-008: provider script URLs stay reviewed constants. Only the
 * three approved units exist here. Popunder and Smartlink are intentionally
 * absent and must never be added (task §3.4).
 *
 * The existing resolver/adapters cannot express per-unit scripts (one URL per
 * network) and the anonymous public layer is deferred in code, so the Adsterra
 * components in this folder reuse the SAME gates through `public-surface.ts`
 * instead of going through `AdSlot` (plan.md §11 findings).
 *
 * Public mounts are limited to the reviewed path allowlists below. The
 * authenticated app shell mounts the same units from `(app)/app/layout.tsx`
 * through `app-surface.ts` (private layer), on every /app page. `/auth/*` and
 * `/admin/*` use different layouts and never mount them.
 */

export const ADSTERRA_SCRIPT_HOST = "https://bauval.org";

export type AdsterraUnitKey = "native_banner" | "social_bar" | "banner_468";

export type AdsterraUnit = {
  key: AdsterraUnitKey;
  /** Adsterra dashboard unit id (for data attributes and documentation). */
  unitId: string;
  scriptUrl: string;
  /** Native units inject into a container with this id. */
  containerId?: string;
  width?: number;
  height?: number;
  /** Paths where this unit may render. Exact match, no prefix matching. */
  allowedPaths: readonly string[];
};

export const ADSTERRA_UNITS = {
  native_banner: {
    key: "native_banner",
    unitId: "31803282",
    scriptUrl: `${ADSTERRA_SCRIPT_HOST}/21/ce7743f7a63e3303a8a5bca86be972a9`,
    containerId: "container-ce7743f7a63e3303a8a5bca86be972a9",
    allowedPaths: ["/", "/privacy", "/terms", "/about", "/contact"],
  },
  social_bar: {
    key: "social_bar",
    unitId: "31803283",
    scriptUrl: `${ADSTERRA_SCRIPT_HOST}/14/0d0d523604c826337be77b00f55115b5`,
    allowedPaths: ["/"],
  },
  banner_468: {
    key: "banner_468",
    unitId: "31803284",
    scriptUrl: `${ADSTERRA_SCRIPT_HOST}/22/166ca6f5db0d4f74e14b5e11e470ec29`,
    // The 468x60 unit uses an `atOptions` block plus an iframe loader.
    width: 468,
    height: 60,
    allowedPaths: ["/"],
  },
} as const satisfies Record<AdsterraUnitKey, AdsterraUnit>;

/** atOptions key for the 468x60 iframe unit (public ad code). */
export const ADSTERRA_BANNER_468_KEY = "166ca6f5db0d4f74e14b5e11e470ec29";

/**
 * Hard path allowlist for PUBLIC mounts. The components on public pages are
 * only mounted on approved paths, and this guard is the second line of defence
 * for accidental public mounts. The authenticated app shell is scoped by its
 * layout instead (`(app)/app/layout.tsx`); /auth/*, /admin/* and error pages
 * never import these components.
 */
export function isAdsterraPathAllowed(unitKey: AdsterraUnitKey, pathname: string): boolean {
  const unit = ADSTERRA_UNITS[unitKey];
  const normalized = pathname === "" ? "/" : pathname.replace(/\/+$/, "") || "/";
  const allowed: readonly string[] = unit.allowedPaths;
  return allowed.includes(normalized);
}

/** postMessage source id used by the banner fill watchdog (parent + frame). */
export const BANNER_468_MESSAGE_SOURCE = "adsterra-banner-468";

/** How long the watchdog waits for Adsterra to inject a creative. */
export const BANNER_468_FILL_TIMEOUT_MS = 8000;

/**
 * Runs inside the srcdoc iframe. Adsterra renders a blank body when it has no
 * fill (or the request is blocked), so the parent has no way to tell success
 * from an empty slot. Watch for an injected creative and report either state;
 * the parent collapses the whole slot on `empty` instead of leaving a white box.
 */
const BANNER_468_WATCHDOG = `
(function () {
  var source = ${JSON.stringify(BANNER_468_MESSAGE_SOURCE)};
  var reported = false;
  function send(status) {
    if (reported) return;
    reported = true;
    try { parent.postMessage({ source: source, status: status }, "*"); } catch (e) {}
  }
  function hasVisibleCreative() {
    var nodes = document.body ? document.body.querySelectorAll("iframe, img, ins, a") : [];
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.tagName === "IMG" && (!el.complete || el.naturalWidth === 0)) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width >= 10 && rect.height >= 10) return true;
    }
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var j = 0; j < all.length; j += 1) {
      var tag = all[j].tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") continue;
      var box = all[j].getBoundingClientRect();
      if (box.width >= 50 && box.height >= 20) return true;
    }
    return false;
  }
  var started = Date.now();
  var timer = setInterval(function () {
    if (hasVisibleCreative()) {
      clearInterval(timer);
      send("filled");
    } else if (Date.now() - started >= ${BANNER_468_FILL_TIMEOUT_MS}) {
      clearInterval(timer);
      send("empty");
    }
  }, 500);
})();
`;

/**
 * Source for the 468x60 unit. Adsterra's loader uses document.write, which does
 * not work when a script is injected into the live document, so it runs inside
 * a sandboxed `srcDoc` iframe (task §4.1). The watchdog reports whether the
 * unit actually painted. Exported for unit tests.
 */
export function buildBanner468SrcDoc(): string {
  const unit = ADSTERRA_UNITS.banner_468;
  const options = JSON.stringify({
    key: ADSTERRA_BANNER_468_KEY,
    format: "iframe",
    height: unit.height,
    width: unit.width,
    params: {},
  });
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>",
    "</head>",
    "<body>",
    `<script>${BANNER_468_WATCHDOG}</script>`,
    `<script>atOptions=${options};</script>`,
    `<script src="${unit.scriptUrl}"></script>`,
    "</body>",
    "</html>",
  ].join("");
}
