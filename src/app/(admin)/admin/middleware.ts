import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

export async function Middleware(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.redirect(new URL("/app/auth/sign-in", req.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!profile) {
    return Response.redirect(new URL("/app/auth/access-denied", req.url));
  }

  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("profile_id", profile.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (!adminRow) {
    return Response.redirect(new URL("/app", req.url));
  }

  return Response.next();
}
