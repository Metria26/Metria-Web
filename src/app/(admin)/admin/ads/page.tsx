import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { loadAdsAdminData, requireAdmin } from "@/features/ads/admin/data";
import { AdsAdminView } from "@/features/ads/admin/ui/ads-admin-view";

export const metadata = {
  title: "Ads administration",
  robots: { index: false, follow: false },
};

// Next16 cacheComponents: the session + platform-admin check must block this
// navigation — opt the segment out of instant-navigation validation.
export const instant = false;

/**
 * Platform ads console (AD3, plan §6). The proxy gates /admin behind a
 * session; requireAdmin() then applies the platform-admin gate
 * (private.is_platform_admin semantics) and sends everyone else to /app.
 * AD3 mirrors DEP-2's noindex requirement for private routes.
 */
export default async function AdsAdminPage() {
  await connection();
  const ctx = await requireAdmin();
  if (!ctx) redirect("/app");

  const data = await loadAdsAdminData(ctx);
  const t = await getTranslations("AdminAds");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" data-testid="admin-ads-page">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("capability")}</p>
      <AdsAdminView data={data} />
    </div>
  );
}
