import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Offerings",
};

export const instant = false;

type OfferingRow = {
  id: string;
  offering_code: string;
  term_id: string;
  courses: { code: string; title: string } | null;
};

export default async function OfferingsPage() {
  await connection();
  const t = await getTranslations("Offerings");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userProfile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  const { data: adminRow } = userProfile
    ? await supabase
        .from("platform_admins")
        .select("id")
        .eq("profile_id", userProfile.id)
        .is("revoked_at", null)
        .maybeSingle()
    : { data: null };

  const isAdmin = !!adminRow;

  let offeringQuery = supabase
    .from("course_offerings")
    .select("id, offering_code, term_id, courses ( code, title )")
    .order("created_at", { ascending: false });

  if (!isAdmin && userProfile) {
    // Check if user is staff (TA/Teacher)
    const { data: staffRows } = await supabase
      .from("offering_staff")
      .select("offering_id")
      .eq("profile_id", userProfile.id);
    const staffOfferingIds = (staffRows ?? []).map((r) => r.offering_id);

    if (staffOfferingIds.length > 0) {
      offeringQuery = offeringQuery.in("id", staffOfferingIds);
    } else {
      // Student: check enrollments
      const { data: myEnrollments } = await supabase
        .from("enrollments")
        .select("section_id")
        .eq("profile_id", userProfile.id);
      const sectionIds = (myEnrollments ?? []).map((e) => e.section_id);

      let enrolledOfferingIds: string[] = [];
      if (sectionIds.length > 0) {
        const { data: secs } = await supabase
          .from("sections")
          .select("offering_id")
          .in("id", sectionIds);
        enrolledOfferingIds = (secs ?? []).map((s) => s.offering_id);
      }

      if (enrolledOfferingIds.length > 0) {
        offeringQuery = offeringQuery.in("id", enrolledOfferingIds);
      } else {
        offeringQuery = offeringQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    }
  }

  const [offeringsRes, termsRes] = await Promise.all([
    offeringQuery,
    supabase.from("terms").select("id, name"),
  ]);

  const termsById = new Map(
    ((termsRes.data ?? []) as { id: string; name: string }[]).map((term) => [term.id, term.name]),
  );
  const offerings = ((offeringsRes.data ?? []) as unknown as OfferingRow[]).map((offering) => ({
    ...offering,
    termName: offering.term_id ? (termsById.get(offering.term_id) ?? null) : null,
  }));

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto py-2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Courses and offerings managed by you.
          </p>
        </div>
        <Link
          href="/app/offerings/new"
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="new-offering-link"
        >
          + {t("newOffering")}
        </Link>
      </div>

      {offerings.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.body")}
          action={{ href: "/app/offerings/new", label: t("newOffering") }}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="offerings-list">
          {offerings.map((offering) => (
            <li key={offering.id}>
              <Link
                href={`/app/offerings/${offering.id}`}
                className="flex items-center justify-between rounded-xl border bg-card p-5 transition-all hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
                data-testid="offering-item"
              >
                <span className="grid gap-1">
                  <span className="font-semibold text-base">
                    {offering.courses
                      ? `${offering.courses.code} — ${offering.courses.title}`
                      : offering.offering_code}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {offering.offering_code}
                    {offering.termName ? ` · ${offering.termName}` : ""}
                  </span>
                </span>
                <span aria-hidden className="text-muted-foreground text-lg">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
