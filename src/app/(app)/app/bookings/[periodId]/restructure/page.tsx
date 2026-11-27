import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  canRestructurePeriod,
  defaultDayInputs,
  loadRestructureData,
} from "@/features/booking/restructure";
import { RestructureForm } from "@/features/booking/ui/restructure-form";

export const metadata: Metadata = {
  title: "Restructure evaluation slots",
};

export const instant = false;

/** Admin/owner only: preview and transactionally apply a new slot layout. */
export default async function RestructureSlotsPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  await connection();
  const t = await getTranslations("Booking.restructure");
  const supabase = await createClient();

  if (!(await canRestructurePeriod(supabase, periodId))) notFound();
  const data = await loadRestructureData(supabase, periodId);
  if (!data) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 py-2">
      <div className="grid gap-2">
        <Link
          href={`/app/bookings/${periodId}`}
          className="w-fit text-sm font-medium text-primary hover:underline"
        >
          ← {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle", { title: data.period.title })}
        </p>
      </div>
      <RestructureForm data={data} defaultDays={defaultDayInputs(data)} />
    </div>
  );
}
