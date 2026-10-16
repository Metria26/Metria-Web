import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Bookings",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
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

  // RLS scopes periods to staffed offerings (staff) or enrolled sections.
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

  // The doc schema has no evaluation_periods→sections FK: join labels in JS.
  const offeringIds = [...new Set((periods ?? []).map((period) => period.offering_id))];
  const sectionIds = [...new Set((periods ?? []).map((period) => period.section_id))];
  const [offeringsRes, sectionsRes] = await Promise.all([
    offeringIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses(code)")
          .in("id", offeringIds)
      : Promise.resolve({
          data: [] as { id: string; offering_code: string; courses: { code: string } | null }[],
        }),
    sectionIds.length > 0
      ? supabase.from("sections").select("id, section_code").in("id", sectionIds)
      : Promise.resolve({ data: [] as { id: string; section_code: string }[] }),
  ]);
  // PostgREST embeds are typed as relation | relation[] (no cardinality
  // inference): cast to the one-to-one shape the FK guarantees.
  const offeringRows = (offeringsRes.data ?? []) as unknown as {
    id: string;
    offering_code: string;
    courses: { code: string } | null;
  }[];
  const offeringLabels = new Map(offeringRows.map((offering) => [offering.id, offering]));
  const sectionLabels = new Map(
    (sectionsRes.data ?? []).map((section) => [section.id, section.section_code]),
  );

  const rows = (periods ?? []) as PeriodRow[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {staffedOfferingIds.length > 0 ? (
          <Link
            href="/app/bookings/new"
            className="text-sm text-primary hover:underline"
            data-testid="new-period-link"
          >
            {t("newPeriod")}
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("noPeriods")} description={t("noPeriodsHint")} />
      ) : (
        <ul className="grid gap-2" data-testid="booking-periods">
          {rows.map((period) => {
            const offering = offeringLabels.get(period.offering_id);
            const courseCode = offering?.courses?.code ?? offering?.offering_code ?? "";
            const sectionCode = sectionLabels.get(period.section_id) ?? "";
            return (
              <li
                key={period.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                data-testid="booking-period"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">{period.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {courseCode}
                    {sectionCode ? ` · ${sectionCode}` : ""} ·{" "}
                    {t("window", {
                      start: windowFormat.format(new Date(period.starts_at)),
                      end: windowFormat.format(new Date(period.ends_at)),
                    })}
                  </span>
                </span>
                <Link
                  href={`/app/bookings/${period.id}`}
                  className="text-sm text-primary hover:underline"
                  data-testid="booking-period-link"
                >
                  {t("view")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
