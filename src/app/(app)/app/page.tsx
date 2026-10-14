import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <EmptyState
        title={t("emptyTitle")}
        description={t("body")}
        action={{ href: "/", label: t("action") }}
      />
    </div>
  );
}
