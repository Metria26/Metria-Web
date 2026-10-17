import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is viewing this request (T-B003): the ads rendering path needs the
 * tenant id before it can call any ad RPC. One React cache() per request means
 * the (app) layout (consent banner) and every <AdSlot> on the page share a
 * single session/profile lookup. Returns null outside an authenticated
 * session — callers treat that as "no ads surface" (fail closed). The public
 * (anonymous) layer resolves its tenant differently when Track A lands; that
 * path passes an explicit universityId into resolveAdSlots instead.
 */

export type AdViewer = {
  profileId: string;
  universityId: string;
};

export const loadAdViewer = cache(async (): Promise<AdViewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { profileId: data.id, universityId: data.university_id };
});
