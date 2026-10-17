import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * T-B003 (R2): security headers on every route.
 * - Content-Security-Policy-Report-Only starts as monitoring only (docs
 *   security checklist): script-src stays 'self' (no third-party provider is
 *   approved yet — ADR-008), img-src allows https: for admin-managed sponsor
 *   creatives, connect-src pins the Supabase origin, and violations post to
 *   /api/csp-report. With auth pages having zero ad markup (R3) and the
 *   allowlist empty, enforcement can flip later without markup changes.
 * - Permissions-Policy disables powerful features (ad code has no business
 *   calling them; interest-cohort/topics explicitly off).
 * - Referrer-Policy: strict-origin-when-cross-origin — outbound sponsor links
 *   carry at most the origin (security checklist "strict referrer policy").
 */

const connectSrc = ["'self'", process.env.NEXT_PUBLIC_SUPABASE_URL]
  .filter((entry): entry is string => Boolean(entry))
  .join(" ");

const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  // unsafe-eval matches Next dev tooling only — foreign script hosts still
  // violate 'self' and keep reporting; enforcement drops it later.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-src 'self'",
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
  /* config options here */
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
