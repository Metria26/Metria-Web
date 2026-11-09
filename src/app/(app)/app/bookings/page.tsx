import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { deletePeriodAction } from "@/features/booking/actions";
import { ConfirmDeleteDialogButton } from "@/components/ui/confirm-delete-dialog";
import { formatDateTime } from "@/lib/time-format";

export const metadata: Metadata = {
  title: "Bookings",
};

export const instant = false;

type PeriodRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  cutoff_hours: number;
  offering_id: string;
  section_id: string;
};

export default async function BookingsPage() {
  await connection();
  const t = await getTranslations("Booking");
  const supabase = await createClient();

  const { data: periods } = await supabase
    .from("evaluation_periods")
    .select("id, title, starts_at, ends_at, cutoff_hours, offering_id, section_id")
    .order("starts_at", { ascending: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let staffedOfferingIds: string[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profile) {
      const { data: staffRows } = await supabase
        .from("offering_staff")
        .select("offering_id")
        .eq("profile_id", profile.id);
      staffedOfferingIds = (staffRows ?? []).map((row) => row.offering_id);
    }
  }

  const offeringIds = [...new Set((periods ?? []).map((period) => period.offering_id))];
  const sectionIds = [...new Set((periods ?? []).map((period) => period.section_id))];
  const [offeringsRes, sectionsRes] = await Promise.all([
    offeringIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses(code, title)")
          .in("id", offeringIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            offering_code: string;
            courses: { code: string; title: string } | null;
          }[],
        }),
    sectionIds.length > 0
      ? supabase.from("sections").select("id, section_code").in("id", sectionIds)
      : Promise.resolve({ data: [] as { id: string; section_code: string }[] }),
  ]);

  const offeringRows = (offeringsRes.data ?? []) as unknown as {
    id: string;
    offering_code: string;
    courses: { code: string; title: string } | null;
  }[];
  const offeringLabels = new Map(offeringRows.map((offering) => [offering.id, offering]));
  const sectionLabels = new Map(
    (sectionsRes.data ?? []).map((section) => [section.id, section.section_code]),
  );

  const rows = (periods ?? []) as PeriodRow[];

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto py-2">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("hubHint")}</p>
        </div>
        {staffedOfferingIds.length > 0 ? (
          <Link
            href="/app/bookings/new"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
            data-testid="new-period-link"
          >
            + {t("newPeriod")}
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("noPeriods")} description={t("noPeriodsHint")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="booking-periods">
          {rows.map((period) => {
            const offering = offeringLabels.get(period.offering_id);
            const courseCode = offering?.courses?.code ?? offering?.offering_code ?? "";
            const courseTitle = offering?.courses?.title ?? "";
            const sectionCode = sectionLabels.get(period.section_id) ?? "";
            const canDelete = staffedOfferingIds.includes(period.offering_id);
            return (
              <div
                key={period.id}
                className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
                data-testid="booking-period"
              >
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      {courseCode} {sectionCode ? `· Sec ${sectionCode}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                      {t("cutoffChip", { hours: period.cutoff_hours })}
                    </span>
                  </div>
                  <Link
                    href={`/app/bookings/${period.id}`}
                    data-testid="booking-period-link"
                    className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <h2 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      {period.title}
                    </h2>
                    {courseTitle ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{courseTitle}</p>
                    ) : null}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-2 pt-3 border-t flex items-center gap-1.5">
                    <span>🕒</span>
                    <span>
                      {t("window", {
                        start: formatDateTime(period.starts_at),
                        end: formatDateTime(period.ends_at),
                      })}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t flex items-center justify-between gap-2 text-xs font-semibold text-primary">
                  <Link
                    href={`/app/bookings/${period.id}`}
                    className="inline-flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {t("viewSlot")}
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </Link>
                  {canDelete ? (
                    <ConfirmDeleteDialogButton
                      label={t("actions.delete")}
                      confirmMessage={t("confirm.deletePeriod", { title: period.title })}
                      requireTyping={period.title}
                      hiddenFields={{ periodId: period.id }}
                      action={deletePeriodAction}
                      testId={`delete-period-${period.id.slice(0, 8)}`}
                      buttonClass="inline-flex h-7 items-center rounded-md border border-destructive/40 bg-background px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
