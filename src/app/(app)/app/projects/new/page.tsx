import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardForm } from "@/features/projects/ui/dashboard-form";

export const metadata: Metadata = {
  title: "New project dashboard",
};

export const instant = false;

export default async function NewProjectDashboardPage() {
  await connection();
  const t = await getTranslations("Projects");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t("hub.signIn")}</p>
      </main>
    );
  }

  const { data: staffRows } = await supabase
    .from("offering_staff")
    .select("offering_id")
    .eq("profile_id", profile.id);
  const offeringIds = [...new Set((staffRows ?? []).map((row) => row.offering_id))];

  const [offeringsRes, sectionsRes] = await Promise.all([
    offeringIds.length > 0
      ? supabase
          .from("course_offerings")
          .select("id, offering_code, courses(code, title)")
          .in("id", offeringIds)
      : Promise.resolve({ data: [] as unknown[] }),
    offeringIds.length > 0
      ? supabase
          .from("sections")
          .select("id, section_code, offering_id")
          .in("offering_id", offeringIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const offerings = (
    (offeringsRes.data ?? []) as {
      id: string;
      offering_code: string;
      courses: { code: string; title: string } | null;
    }[]
  )
    .map((row) => ({
      id: row.id,
      label: `${row.courses?.code ?? ""} ${row.courses?.title ?? ""} (${row.offering_code})`.trim(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const sections = (
    (sectionsRes.data ?? []) as { id: string; section_code: string; offering_id: string }[]
  ).map((row) => ({ id: row.id, label: row.section_code, offeringId: row.offering_id }));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold" data-testid="new-dashboard-title">
        {t("new.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("new.subtitle")}</p>
      <div className="mt-6">
        {offerings.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("new.noOfferings")}
          </p>
        ) : (
          <DashboardForm offerings={offerings} sections={sections} mode="create" />
        )}
      </div>
    </main>
  );
}
