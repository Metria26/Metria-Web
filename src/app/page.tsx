import { connection } from "next/server";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicFooter, PublicHeader } from "@/components/public/public-shell";
import { productName } from "@/lib/brand";
import { CONSENT_COOKIE, policyVersionFromEnv } from "@/features/ads/consent";
import { loadPublicAdSurface } from "@/features/ads/public-surface";
import { publicUnitAllowed } from "@/features/ads/public-surface-rules";
import { ConsentBanner } from "@/features/ads/ui/consent-banner";
import { AdsterraBanner468 } from "@/features/ads/adsterra/banner-468";
import { AdsterraNativeBanner } from "@/features/ads/adsterra/native-banner";
import { AdsterraSocialBar } from "@/features/ads/adsterra/social-bar";
import { isAdsterraPathAllowed } from "@/features/ads/adsterra/config";

/**
 * Public landing page (SS11). Ads are opt-in: every Adsterra component mounts
 * only when the public surface is open (master flag + no kill + public layer +
 * adsterra network enabled), the visitor consented, and the unit's reviewed
 * path allowlist matches. With the shipped defaults (`ads.enabled=false`,
 * `ads.global_kill=true`) the page renders zero ad markup.
 *
 * `connection()` keeps this route request-time: the tenant lookup uses the
 * service role and must never run during `next build`. `instant = false`
 * documents that the dynamic ad/consent shell blocks navigation (Next 16
 * cacheComponents).
 */
export const instant = false;

export default async function Home() {
  await connection();
  const t = await getTranslations("Home");
  const surface = await loadPublicAdSurface();
  const cookieStore = await cookies();
  const initialConsentCookie = cookieStore.get(CONSENT_COOKIE)?.value ?? null;

  const adsAllowed = (unit: "banner_468" | "native_banner" | "social_bar") =>
    publicUnitAllowed(surface, "/", (path) => isAdsterraPathAllowed(unit, path));

  const showBanner = adsAllowed("banner_468");
  const showNative = adsAllowed("native_banner");
  const showSocialBar = adsAllowed("social_bar");

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-16 text-center md:px-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{productName}</h1>
          <p className="max-w-md text-balance text-muted-foreground sm:text-lg">{t("tagline")}</p>
          <Button render={<Link href="/app" />} nativeButton={false} size="lg">
            {t("ctaOpenApp")}
            <ArrowRight aria-hidden />
          </Button>
        </section>

        {showBanner ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-8 md:px-6">
            <AdsterraBanner468 />
          </div>
        ) : null}

        <section className="mx-auto w-full max-w-3xl px-4 pb-16 md:px-6">
          <h2 className="text-xl font-semibold tracking-tight">{t("whatTitle")}</h2>
          <div className="mt-4 space-y-4 text-muted-foreground">
            <p>{t("whatBody")}</p>
            <p>{t("whatBody2")}</p>
          </div>

          <h2 className="mt-10 text-xl font-semibold tracking-tight">{t("whoTitle")}</h2>
          <p className="mt-4 text-muted-foreground">{t("whoBody")}</p>

          <h2 className="mt-10 text-xl font-semibold tracking-tight">{t("featuresTitle")}</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>{t("featureMarks")}</li>
            <li>{t("featureBooking")}</li>
            <li>{t("featureAnnouncements")}</li>
            <li>{t("featureAnalytics")}</li>
          </ul>

          <h2 className="mt-10 text-xl font-semibold tracking-tight">{t("trustTitle")}</h2>
          <p className="mt-4 text-muted-foreground">{t("trustBody")}</p>
        </section>

        {showNative ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-16 md:px-6">
            <AdsterraNativeBanner />
          </div>
        ) : null}
      </main>
      <PublicFooter />
      {surface.open ? (
        <ConsentBanner
          policyVersion={policyVersionFromEnv()}
          initialConsentCookie={initialConsentCookie}
        />
      ) : null}
      {showSocialBar ? <AdsterraSocialBar /> : null}
    </div>
  );
}
