import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { loadRolesAdminData, requireAdmin } from "@/features/admin/management/data";
import { RolesAdminView } from "@/features/admin/management/ui/roles-admin-view";

export const metadata = {
  title: "Roles administration",
  robots: { index: false, follow: false },
};

export const instant = false;

export default async function RolesAdminPage() {
  await connection();
  const ctx = await requireAdmin();
  if (!ctx) redirect("/app");

  const data = await loadRolesAdminData(ctx);
  const t = await getTranslations("AdminRoles");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" data-testid="admin-roles-page">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("capability")}</p>
      <RolesAdminView data={data} />
    </div>
  );
}
