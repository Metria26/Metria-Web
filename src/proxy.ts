import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/**
 * Next.js 16 request proxy (formerly middleware): refreshes the Supabase
 * session and gates /app/* routes (plan.md F3).
 */
export default async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  return updateSession(request, response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
