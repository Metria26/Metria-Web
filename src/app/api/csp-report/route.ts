import { NextResponse } from "next/server";
import { extractCspReport } from "@/features/ads/csp";

/**
 * CSP Report-Only collector (T-B003, R2): accepts the browser's violation
 * report, logs a sanitized signal (see extractCspReport) and answers 204.
 * Nothing is persisted; malformed or oversized bodies are dropped. Once the
 * provider allowlist is approved (ADR-008) the same policy flips from
 * Report-Only to enforced without changing this route.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const report = extractCspReport(body);
    if (report) {
      console.warn("[csp-report]", JSON.stringify(report));
    }
  } catch {
    // Malformed reports are dropped silently.
  }
  return new NextResponse(null, { status: 204 });
}
