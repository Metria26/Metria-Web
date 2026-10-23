import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("AdminLayout");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" data-testid="admin-layout">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      <nav className="mt-6 flex gap-4" aria-label="Admin navigation">
        <Link
          href="/admin/ads"
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("ads")}
        </Link>
        <Link
          href="/admin/memberships"
          className="inline-flex items-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("memberships")}
        </Link>
        <Link
          href="/admin/roles"
          className="inline-flex items-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("roles")}
        </Link>
      </nav>

      {children}
    </div>
  );
}
