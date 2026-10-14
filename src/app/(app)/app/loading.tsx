import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function Loading() {
  const t = await getTranslations("Shell");

  return (
    <div role="status" aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" aria-hidden />
      <Skeleton className="h-48 w-full" aria-hidden />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 w-full" aria-hidden />
        <Skeleton className="h-28 w-full" aria-hidden />
      </div>
    </div>
  );
}
