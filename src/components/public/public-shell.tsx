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
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
          >
            {productName.slice(0, 1).toUpperCase()}
          </span>
          {productName}
        </Link>
        <nav aria-label={t("label")} className="flex items-center gap-4 text-sm">
          <Link
            href="/about"
            className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            {t("about")}
          </Link>
          <Link
            href="/contact"
            className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            {t("contact")}
          </Link>
          {/* Plain anchor: /app may redirect to /auth, so start a fresh document. */}
          <a
            href="/app"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("openApp")}
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </nav>
      </div>
    </header>
  );
}

export async function PublicFooter() {
  const t = await getTranslations("Public.footer");
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
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
