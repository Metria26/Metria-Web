import { getTranslations } from "next-intl/server";
import { PublicPageLayout, legalPageMetadata } from "@/components/public/public-page";
import { productName } from "@/lib/brand";

export async function generateMetadata() {
  return legalPageMetadata("about");
}

export const instant = false;

export default async function AboutPage() {
  const t = await getTranslations("Public.pages.about");
  return (
    <PublicPageLayout pathname="/about" titleKey="about">
      <p>{t("intro", { product: productName })}</p>
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("missionTitle")}</h2>
      <p>{t("mission")}</p>
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("audienceTitle")}</h2>
      <p>{t("audience")}</p>
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("privacyTitle")}</h2>
      <p>{t("privacy")}</p>
    </PublicPageLayout>
  );
}
