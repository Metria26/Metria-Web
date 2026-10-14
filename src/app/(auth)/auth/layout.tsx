import type { Metadata } from "next";
import Link from "next/link";
import { productName } from "@/lib/brand";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Auth shell: centered card, noindex, zero ad scripts (R3; plan.md F3). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12">
      <main id="main" data-testid="auth-main" className="w-full max-w-sm">
        {children}
      </main>
      <Link
        href="/"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
      >
        {productName}
      </Link>
    </div>
  );
}
