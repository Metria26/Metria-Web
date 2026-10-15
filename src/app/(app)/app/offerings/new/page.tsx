import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { CourseForm, OfferingForm } from "@/features/academics/ui/forms";

export const metadata: Metadata = {
  title: "New offering",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

type OptionRow = { id: string; label: string };

export default async function NewOfferingPage() {
  // Per-user dynamic data behind auth — request-time only (blocking-prerender
  // current-time insight: supabase session math runs Date.now()).
  await connection();
  const t = await getTranslations("Offerings");
  const supabase = await createClient();

  // Member-read RLS scopes every list to the caller's tenant.
  const [courses, terms, departments] = await Promise.all([
    supabase.from("courses").select("id, code, title").order("code"),
    supabase.from("terms").select("id, name").order("starts_on", { ascending: false }),
    supabase.from("departments").select("id, name").order("name"),
  ]);

  const courseOptions = ((courses.data ?? []) as { id: string; code: string; title: string }[]).map(
    (row) => ({ id: row.id, label: `${row.code} — ${row.title}` }),
  ) satisfies OptionRow[];
  const termOptions = ((terms.data ?? []) as { id: string; name: string }[]).map((row) => ({
    id: row.id,
    label: row.name,
  }));
  const departmentOptions = ((departments.data ?? []) as { id: string; name: string }[]).map(
    (row) => ({ id: row.id, label: row.name }),
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("newOffering")}</h1>
        <p className="text-sm text-muted-foreground">{t("newOfferingHint")}</p>
      </div>

      <section className="grid gap-3" aria-labelledby="course-heading">
        <h2 id="course-heading" className="text-lg font-semibold">
          {t("sections.createCourse")}
        </h2>
        <CourseForm departments={departmentOptions} />
      </section>

      <section className="grid gap-3" aria-labelledby="offering-heading">
        <h2 id="offering-heading" className="text-lg font-semibold">
          {t("sections.createOffering")}
        </h2>
        {courseOptions.length === 0 || termOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="offering-form-hint">
            {t("offeringNeedsCourseTerm")}
          </p>
        ) : null}
        <OfferingForm courses={courseOptions} terms={termOptions} />
      </section>
    </div>
  );
}
