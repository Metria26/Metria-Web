import { connection, NextResponse, type NextRequest } from "next/server";
import { loadPrivateAdSurface } from "@/features/ads/app-surface";
import {
  isMonetagVignettePathAllowed,
  monetagVignetteAllowed,
  monetagVignetteSurface,
} from "@/features/ads/monetag-vignette-rules";
import { loadPublicAdSurface } from "@/features/ads/public-surface";

/**
 * Browser-side gate for the Monetag Vignette Banner.
 *
 * The root layout stays static; this request-scoped endpoint is called only
 * after the client has an allowed pathname and ads consent. It reuses the
 * existing public/private surface loaders so the master flag, global kill,
 * layer switch, network kill and consent are evaluated by the same code as
 * Adsterra. The response is a boolean only and is never cached.
 */

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie",
} as const;

function pathnameFrom(request: NextRequest): string {
  const raw = request.nextUrl.searchParams.get("path");
  if (!raw || raw.length > 2048 || !raw.startsWith("/")) return "/";
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Never resolve a tenant or read a cookie during prerender/build.
  await connection();

  const pathname = pathnameFrom(request);
  if (!isMonetagVignettePathAllowed(pathname)) {
    return NextResponse.json({ allowed: false }, { headers: NO_STORE_HEADERS });
  }

  const surface =
    monetagVignetteSurface(pathname) === "private"
      ? await loadPrivateAdSurface()
      : await loadPublicAdSurface();
  const allowed = monetagVignetteAllowed({
    pathname,
    surfaceOpen: surface.open,
    consentGranted: surface.consentGranted,
  });

  return NextResponse.json({ allowed }, { headers: NO_STORE_HEADERS });
}
