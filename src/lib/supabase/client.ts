import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

/** Browser-side Supabase client (anon key only; never the service role). */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
