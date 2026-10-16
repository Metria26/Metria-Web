import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { PeriodForm } from "@/features/booking/ui/forms";

export const metadata: Metadata = {
  title: "New period",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

export default async function NewBookingPeriodPage() {
  await connection();
  const t = await getTranslations("Booking");
  const supabase = await createClient();

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
      // offering_staff_manage (T-A003) gates this read to tenant managers.
      const { data: staffRows } = await supabase
        .from("offering_staff")
        .select("offering_id")
        .eq("profile_id", profile.id);
      staffedOfferingIds = [...new Set((staffRows ?? []).map((row) => row.offering_id))];
    }
  }

  const [offeringsRes, sectionsRes] = await Promise.all([
    staffedOfferingIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses(code)")
          .in("id", staffedOfferingIds)
      : Promise.resolve({
          data: [] as { id: string; offering_code: string; courses: { code: string } | null }[],
        }),
    staffedOfferingIds.length > 0
      ? supabase
          .from("sections")
          .select("id, section_code, offering_id")
          .in("offering_id", staffedOfferingIds)
      : Promise.resolve({
          data: [] as { id: string; section_code: string; offering_id: string }[],
        }),
  ]);

  // PostgREST embeds are typed as relation | relation[] (no cardinality
  // inference): cast to the one-to-one shape the FK guarantees.
  const offeringRows = (offeringsRes.data ?? []) as unknown as {
    id: string;
    offering_code: string;
    courses: { code: string } | null;
  }[];
  const offerings = offeringRows.map((offering) => ({
    id: offering.id,
    label: `${offering.courses?.code ?? offering.offering_code} · ${offering.offering_code}`,
  }));
  const sections = (sectionsRes.data ?? []).map((section) => ({
    id: section.id,
    label: section.section_code,
    offeringId: section.offering_id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-1">
        <Link
          href="/app/bookings"
          className="text-sm text-primary hover:underline"
          data-testid="back-to-bookings"
        >
          {t("backToList")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("newPeriod")}</h1>
      </div>
      {offerings.length === 0 ? (
        <div data-testid="no-staffed-offerings">
          <EmptyState title={t("notStaffTitle")} description={t("notStaffHint")} />
        </div>
      ) : (
        <PeriodForm offerings={offerings} sections={sections} />
      )}
    </div>
  );
}
