import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/shell/app-header";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Auth-gated shell: per-user dynamic (Supabase getUser does Date.now() session
// expiry math — unstable at prerender). connection() forces request-time
// rendering; instant=false documents that navigations into /app block on auth.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  // Server-side session check (plan.md F3): UI checks are cosmetic only.
  // The proxy already gates /app/*; this is the trusted defense in depth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="flex min-h-dvh w-full">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main
          id="main"
          data-testid="app-main"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 md:px-6 md:pb-10"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
