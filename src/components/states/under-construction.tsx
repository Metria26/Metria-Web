import Link from "next/link";
import { Construction } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Shared placeholder for student-facing routes that are not built yet.
 *
 * Temporary routes (keep this list in sync when a real page ships):
 *   - /app/calendar
 *   - /app/messages
 *   - /app/profile
 *
 * To remove: delete the route's page.tsx (or replace its body) and drop the
 * entry above. Nothing else depends on this component.
 */
export async function UnderConstruction({ pageName }: { pageName: string }) {
  const t = await getTranslations("UnderConstruction");

  return (
    <section
      data-testid="under-construction"
      aria-labelledby="under-construction-title"
      className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card px-6 py-12 text-center shadow-sm sm:px-10"
    >
      <span
        className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Construction className="size-7" />
      </span>
      <h1
        id="under-construction-title"
        className="text-xl font-semibold tracking-tight sm:text-2xl"
      >
        {t("title", { pageName })}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground sm:text-base">{t("body")}</p>
      <Link
        href="/app"
        className="mt-1 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t("back")}
      </Link>
    </section>
  );
}
