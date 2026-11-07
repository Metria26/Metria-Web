import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * T-B003 (R2): security headers on every route.
 * - Content-Security-Policy-Report-Only starts as monitoring only (docs
 *   security checklist): script-src allows 'self' plus the reviewed provider
 *   hosts below; no unreviewed third-party provider is allowed (ADR-008).
 *   img-src allows https: for admin-managed sponsor creatives, connect-src
 *   pins the Supabase origin and reviewed ad hosts, and violations post to
 *   /api/csp-report. With auth pages having zero ad markup (R3), enforcement
 *   can flip later without markup changes.
 * - SS11 (Adsterra): the reviewed provider hosts https://bauval.org and
 *   https://abscloud.org (popunder, ADR-013) are added to script-src, frame-src
 *   and connect-src only. Adsterra creatives load further resources from
 *   rotating CDNs that cannot be enumerated statically, so the policy stays
 *   Report-Only and /api/csp-report is the monitoring channel. The reviewed
 *   units render on public pages and, behind the private surface gate, in the
 *   authenticated /app shell. /auth/* and /admin/* stay ad-free.
 * - Monetag Vignette: the reviewed loader host n6wxm.com and the
 *   ad/CDN hosts referenced by the current vignette bundle are allowlisted in
 *   script-src, connect-src, img-src and frame-src. The bundle is third-party
 *   code that can rotate its delivery hosts, so Report-Only remains the
 *   monitoring channel before enforcement.
 * - Permissions-Policy disables powerful features (ad code has no business
 *   calling them; interest-cohort/topics explicitly off).
 * - Referrer-Policy: strict-origin-when-cross-origin — outbound sponsor links
 *   carry at most the origin (security checklist "strict referrer policy").
 */

/** SS11: reviewed Adsterra script hosts (public ad codes, not secrets). */
const ADSTERRA_ORIGIN = "https://bauval.org";
const ADSTERRA_POPUNDER_ORIGIN = "https://abscloud.org";
const ADSTERRA_ORIGINS = `${ADSTERRA_ORIGIN} ${ADSTERRA_POPUNDER_ORIGIN}`;

/**
 * Monetag Vignette loader + the ad/CDN hosts its current bundle
 * references. Public ad hosts, not secrets. The bundle is reviewed as a
 * provider loader (like Adsterra), not through the generic ADR-008 adapter
 * allowlist.
 */
const MONETAG_ORIGINS = [
  "https://n6wxm.com",
  "https://*.n6wxm.com",
  "https://onclickgenius.com",
  "https://*.onclickgenius.com",
  "https://onclicksuper.com",
  "https://*.onclicksuper.com",
  "https://superonclick.com",
  "https://*.superonclick.com",
  "https://commercialvalue.org",
  "https://*.commercialvalue.org",
  "https://tzegilo.com",
  "https://*.tzegilo.com",
  "https://moneymakercdn.com",
  "https://*.moneymakercdn.com",
  "https://befirstcdn.com",
  "https://*.befirstcdn.com",
  "https://cdn.popcash.net",
  "https://inpage-push.com",
  "https://*.inpage-push.com",
  "https://my.rtmark.net",
  "https://*.rtmark.net",
  "https://obqj2.com",
  "https://*.obqj2.com",
  "https://fbcdn2.com",
  "https://*.fbcdn2.com",
  "https://fleraprt.com",
  "https://*.fleraprt.com",
  "https://bobapsoabauns.com",
  "https://*.bobapsoabauns.com",
  "https://ucdnondemandptimecdn.com",
  "https://*.ucdnondemandptimecdn.com",
  "https://acacdn.com",
  "https://*.acacdn.com",
  "https://acdcdn.com",
  "https://*.acdcdn.com",
  "https://achcdn.com",
  "https://*.achcdn.com",
  "https://acscdn.com",
  "https://*.acscdn.com",
  "https://asacdn.com",
  "https://*.asacdn.com",
  "https://mc.yandex.ru",
  "https://telegram.org",
  "https://*.telegram.org",
  "https://fonts.googleapis.com",
].join(" ");

const connectSrc = [
  "'self'",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  ADSTERRA_ORIGIN,
  ADSTERRA_POPUNDER_ORIGIN,
  MONETAG_ORIGINS,
]
  .filter((entry): entry is string => Boolean(entry))
  .join(" ");

const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  // unsafe-eval matches Next dev tooling only — foreign script hosts still
  // violate 'self' and keep reporting; enforcement drops it later.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ADSTERRA_ORIGINS} ${MONETAG_ORIGINS}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${MONETAG_ORIGINS}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  `frame-src 'self' ${ADSTERRA_ORIGINS} ${MONETAG_ORIGINS}`,
  "media-src 'self'",
  "form-action 'self'",
  "report-uri /api/csp-report",
].join("; ");

const permissionsPolicy = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "gamepad=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()",
].join(", ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
          { key: "Permissions-Policy", value: permissionsPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
