import { getTranslations } from "next-intl/server";
import { PublicPageLayout, legalPageMetadata } from "@/components/public/public-page";
import { productName } from "@/lib/brand";

export async function generateMetadata() {
  return legalPageMetadata("contact");
}

export const instant = false;

export default async function ContactPage() {
  const t = await getTranslations("Public.pages.contact");
  // Contact address comes from env (never hard-coded). BOOTSTRAP_ADMIN_EMAIL is
  // the only public, founder-owned address in the current contract; if it is
  // unset the page shows a clearly marked placeholder instead of a dead link.
  const contactEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || null;

  return (
    <PublicPageLayout pathname="/contact" titleKey="contact">
      <p>{t("intro", { product: productName })}</p>
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("emailTitle")}</h2>
      {contactEmail ? (
        <p>
          <a
            href={`mailto:${contactEmail}`}
            className="underline underline-offset-4 hover:text-foreground"
            data-testid="contact-email"
          >
            {contactEmail}
          </a>
        </p>
      ) : (
        <p data-testid="contact-email-placeholder">{t("emailPlaceholder")}</p>
      )}
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("issuesTitle")}</h2>
      <p>{t("issues")}</p>
      <h2 className="pt-4 text-lg font-semibold text-foreground">{t("adsTitle")}</h2>
      <p>{t("ads")}</p>
    </PublicPageLayout>
  );
}
