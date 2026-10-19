import { getTranslations } from "next-intl/server";
import { PublicPageLayout, legalPageMetadata } from "@/components/public/public-page";
import { productName } from "@/lib/brand";

export async function generateMetadata() {
  return legalPageMetadata("privacy");
}

export const instant = false;

export default async function PrivacyPage() {
  const t = await getTranslations("Public.pages.privacy");
  return (
    <PublicPageLayout pathname="/privacy" titleKey="privacy">
      <p>{t("updated")}</p>
      <p>{t("intro", { product: productName })}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("collectTitle")}</h2>
      <p>{t("collect")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("adsTitle")}</h2>
      <p>{t("ads")}</p>
      <p>{t("adsNetworks")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("consentTitle")}</h2>
      <p>{t("consent")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("appTitle")}</h2>
      <p>{t("app")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("contactTitle")}</h2>
      <p>{t("contact")}</p>
    </PublicPageLayout>
  );
}
