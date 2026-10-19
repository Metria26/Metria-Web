import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { productName } from "@/lib/brand";

/**
 * Public chrome for landing + legal pages (SS11). Kept out of the root layout
 * on purpose: authenticated shells (`/app`, `/auth`, `/admin`) must never pick
 * up public navigation or ad-adjacent markup.
 */

export async function PublicHeader() {
  const t = await getTranslations("Public.nav");
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {productName}
        </Link>
        <nav aria-label={t("label")} className="flex items-center gap-4 text-sm">
          <Link href="/about" className="text-muted-foreground hover:text-foreground">
            {t("about")}
          </Link>
          <Link href="/contact" className="text-muted-foreground hover:text-foreground">
            {t("contact")}
          </Link>
          <Link
            href="/app"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 font-medium hover:bg-muted"
          >
            {t("openApp")}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  );
}

export async function PublicFooter() {
  const t = await getTranslations("Public.footer");
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <p>
          {t("copyright", { product: productName, year: new Date().getFullYear() })}
        </p>
        <nav aria-label={t("label")} className="flex flex-wrap gap-4">
          <Link href="/about" className="hover:text-foreground">
            {t("about")}
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            {t("contact")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("privacy")}
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            {t("terms")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
