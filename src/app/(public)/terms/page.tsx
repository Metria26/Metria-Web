import { getTranslations } from "next-intl/server";
import { PublicPageLayout, legalPageMetadata } from "@/components/public/public-page";
import { productName } from "@/lib/brand";

export async function generateMetadata() {
  return legalPageMetadata("terms");
}

export const instant = false;

export default async function TermsPage() {
  const t = await getTranslations("Public.pages.terms");
  return (
    <PublicPageLayout pathname="/terms" titleKey="terms">
      <p>{t("updated")}</p>
      <p>{t("intro", { product: productName })}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("accountsTitle")}</h2>
      <p>{t("accounts")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("useTitle")}</h2>
      <p>{t("use")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("contentTitle")}</h2>
      <p>{t("content")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("adsTitle")}</h2>
      <p>{t("ads")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("liabilityTitle")}</h2>
      <p>{t("liability")}</p>

      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("contactTitle")}</h2>
      <p>{t("contact")}</p>
    </PublicPageLayout>
  );
}
