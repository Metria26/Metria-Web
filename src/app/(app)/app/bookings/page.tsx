import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Bookings",
};

export const instant = false;

const windowFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
  timeStyle: "short",
});

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
          <p className="text-sm text-muted-foreground mt-1">
            Browse evaluation windows, presentation slots, and sign-ups.
          </p>
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
            return (
              <Link
                key={period.id}
                href={`/app/bookings/${period.id}`}
                className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
                data-testid="booking-period"
              >
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      {courseCode} {sectionCode ? `· Sec ${sectionCode}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">
                      Cutoff: {period.cutoff_hours}h prior
                    </span>
                  </div>
                  <div>
                    <h2 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      {period.title}
                    </h2>
                    {courseTitle ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{courseTitle}</p>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 pt-3 border-t flex items-center gap-1.5">
                    <span>🕒</span>
                    <span>
                      {t("window", {
                        start: windowFormat.format(new Date(period.starts_at)),
                        end: windowFormat.format(new Date(period.ends_at)),
                      })}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs font-semibold text-primary">
                  <span>View Evaluation Slots</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
