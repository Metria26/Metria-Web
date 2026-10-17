/**
 * CSP report sanitizer (T-B003, R2): Report-Only violations arrive at
 * /api/csp-report as JSON; only allowlisted fields leave the parser, capped in
 * length, with the document reduced to its path and remote blocked URIs
 * reduced to their host. No cookies, headers, user agents or query strings are
 * ever logged (security checklist: logs exclude student information — the
 * path itself may carry an id, so reports are dev/ops signal only and are not
 * persisted anywhere).
 */

const MAX_FIELD = 200;

export type CspViolation = {
  documentPath: string;
  blockedUri: string;
  effectiveDirective: string;
  violatedDirective: string;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_FIELD);
}

function documentPath(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(raw, "https://csp-reports.invalid").pathname.slice(0, MAX_FIELD);
  } catch {
    return null;
  }
}

function blockedUri(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(raw).host.slice(0, MAX_FIELD);
  } catch {
    // "inline", "eval", "blob", or any non-URL literal — keep as typed.
    return raw.toLowerCase().slice(0, MAX_FIELD);
  }
}

function pickReport(body: unknown): Record<string, unknown> | null {
  if (Array.isArray(body)) {
    const [first] = body;
    return pickReport(first);
  }
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const nested = record["csp-report"];
  if (typeof nested === "object" && nested !== null) {
    return nested as Record<string, unknown>;
  }
  return record;
}

export function extractCspReport(body: unknown): CspViolation | null {
  const report = pickReport(body);
  if (!report) return null;
  const path = documentPath(report["document-uri"] ?? report.document_uri);
  if (!path) return null;
  return {
    documentPath: path,
    blockedUri: blockedUri(report["blocked-uri"] ?? report.blocked_uri) ?? "unknown",
    effectiveDirective:
      clean(report["effective-directive"] ?? report.effective_directive) ?? "unknown",
    violatedDirective:
      clean(report["violated-directive"] ?? report.violated_directive) ?? "unknown",
  };
}
