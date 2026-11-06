import { connection } from "next/server";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicFooter, PublicHeader } from "@/components/public/public-shell";
import { loadPublicAdSurface } from "@/features/ads/public-surface";
import { publicPopunderAllowed, publicUnitAllowed } from "@/features/ads/public-surface-rules";
import { AdsterraNativeBanner } from "@/features/ads/adsterra/native-banner";
import { AdsterraPopunder } from "@/features/ads/adsterra/popunder";
import { isAdsterraPathAllowed } from "@/features/ads/adsterra/config";

/**
 * Shared shell for the public legal/trust pages (SS11, task §5). Native and
 * popunder units may appear here (no Social Bar, no banner), and only when the
 * same public gates pass, including the independent popunder switch. These
 * pages have no consent banner, so popunder only serves visitors who already
 * granted ad consent elsewhere. `instant = false` (set by each page) documents
 * that the request-time ad/consent shell blocks navigation.
 */

export async function legalPageMetadata(titleKey: string): Promise<Metadata> {
  const t = await getTranslations("Public.pages");
  return { title: t(`${titleKey}.title`) };
}

export async function PublicPageLayout({
  pathname,
  titleKey,
  children,
}: {
  pathname: string;
  titleKey: string;
  children: React.ReactNode;
}) {
  await connection();
  const t = await getTranslations("Public.pages");
  const surface = await loadPublicAdSurface();
  const showNative = publicUnitAllowed(surface, pathname, (path) =>
    isAdsterraPathAllowed("native_banner", path),
  );
  const showPopunder = publicPopunderAllowed(surface, pathname, (path) =>
    isAdsterraPathAllowed("popunder", path),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:px-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t(`${titleKey}.title`)}
        </h1>
        <div className="mt-6 space-y-4 text-muted-foreground">{children}</div>
        {showNative ? (
          <div className="mt-12">
            <AdsterraNativeBanner />
          </div>
        ) : null}
      </main>
      <PublicFooter />
      {showPopunder ? <AdsterraPopunder /> : null}
    </div>
  );
}
