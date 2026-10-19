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
 * Hard path allowlist. The components are only mounted on approved pages, and
 * this guard is the second line of defence: even if a future edit mounts one on
 * `/app`, `/auth/*`, `/admin/*` or an error page, no script is injected.
 */
export function isAdsterraPathAllowed(unitKey: AdsterraUnitKey, pathname: string): boolean {
  const unit = ADSTERRA_UNITS[unitKey];
  const normalized = pathname === "" ? "/" : pathname.replace(/\/+$/, "") || "/";
  const allowed: readonly string[] = unit.allowedPaths;
  return allowed.includes(normalized);
}

/**
 * Source for the 468x60 unit. Adsterra's loader uses document.write, which does
 * not work when a script is injected into the live document, so it runs inside
 * a sandboxed `srcDoc` iframe (task §4.1). Exported for unit tests.
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
    `<script>atOptions=${options};</script>`,
    `<script src="${unit.scriptUrl}"></script>`,
    "</body>",
    "</html>",
  ].join("");
}
