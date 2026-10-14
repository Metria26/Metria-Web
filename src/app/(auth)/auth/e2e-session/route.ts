import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/supabase/session";

/**
 * Test-only password sign-in for Playwright (E2E_MODE=1). Returns 404 unless
 * the flag is set; production deployments never enable it. Google sign-in
 * cannot be automated end-to-end, so shell tests use this route with a
 * fixture user created via the local Supabase admin API.
 */
export async function GET(request: Request) {
  if (process.env.E2E_MODE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const password = url.searchParams.get("password");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!email || !password) {
    return NextResponse.redirect(new URL("/auth/sign-in", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.redirect(new URL("/auth/sign-in", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
