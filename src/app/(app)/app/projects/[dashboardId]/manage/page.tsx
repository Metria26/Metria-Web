import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardForm } from "@/features/projects/ui/dashboard-form";
import { FormBuilder, type FieldRow } from "@/features/projects/ui/form-builder";

export const metadata: Metadata = {
  title: "Manage project dashboard",
};

export const instant = false;

export default async function ManageProjectDashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  await connection();
  const { dashboardId } = await params;
  const t = await getTranslations("Projects");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  const { data: dashboard } = await supabase
    .from("project_dashboards")
    .select(
      "id, title, description, instructions, status, opens_at, deadline_at, late_allowed, allow_edit_after_submission, allow_member_changes_after_submission, require_member_change_approval, allow_individual, allow_student_groups, min_members, max_members, group_id_prefix, offering_id",
    )
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dashboard) notFound();

  const { data: staffRow } = profile
    ? await supabase
        .from("offering_staff")
        .select("id")
        .eq("offering_id", dashboard.offering_id)
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null };
  if (!staffRow) notFound(); // students never reach TA settings

  const { data: offering } = await supabase
    .from("course_offerings")
    .select("id, offering_code, courses(code, title)")
    .eq("id", dashboard.offering_id)
    .maybeSingle();

  const { data: sectionsRes } = await supabase
    .from("sections")
    .select("id, section_code, offering_id")
    .eq("offering_id", dashboard.offering_id);

  const offeringRow = (offering ?? null) as {
    id: string;
    offering_code: string;
    courses: { code: string; title: string } | null;
  } | null;
  const offeringLabel = offeringRow
    ? `${offeringRow.courses?.code ?? ""} ${offeringRow.courses?.title ?? ""} (${offeringRow.offering_code})`.trim()
    : "";

  const { data: fieldsRes } = await supabase
    .from("project_dashboard_fields")
    .select(
      "id, position, label, description, field_type, required, placeholder, options, is_system, enabled",
    )
    .eq("dashboard_id", dashboard.id)
    .is("deleted_at", null)
    .order("position");
  const fields = ((fieldsRes ?? []) as FieldRow[]).map((field) => ({
    ...field,
    options: field.options ?? [],
  }));

  const toLocal = (value: string | null) =>
    value ? new Date(value).toISOString().slice(0, 16) : "";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <nav className="mb-4 text-sm">
        <Link href={`/app/projects/${dashboard.id}`} className="underline-offset-4 hover:underline">
          ← {dashboard.title}
        </Link>
      </nav>
      <h1 className="text-2xl font-bold" data-testid="manage-title">
        {t("manage.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{offeringLabel}</p>

      <section className="mt-8 grid gap-6">
        <h2 className="text-lg font-semibold">{t("manage.settingsHeading")}</h2>
        <DashboardForm
          mode="edit"
          dashboardId={dashboard.id}
          offerings={[{ id: dashboard.offering_id, label: offeringLabel || dashboard.offering_id }]}
          sections={(
            (sectionsRes ?? []) as unknown as {
              id: string;
              section_code: string;
              offering_id: string;
            }[]
          ).map((row) => ({ id: row.id, label: row.section_code, offeringId: row.offering_id }))}
          defaults={{
            title: dashboard.title,
            description: dashboard.description,
            instructions: dashboard.instructions,
            opensAt: toLocal(dashboard.opens_at),
            deadlineAt: toLocal(dashboard.deadline_at),
            lateAllowed: dashboard.late_allowed,
            allowEditAfterSubmission: dashboard.allow_edit_after_submission,
            allowMemberChangesAfterSubmission: dashboard.allow_member_changes_after_submission,
            requireMemberChangeApproval: dashboard.require_member_change_approval,
            allowIndividual: dashboard.allow_individual,
            allowStudentGroups: dashboard.allow_student_groups,
            minMembers: dashboard.min_members,
            maxMembers: dashboard.max_members,
            groupIdPrefix: dashboard.group_id_prefix,
          }}
        />
      </section>

      <section className="mt-10 grid gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t("manage.formHeading")}</h2>
          <p className="text-sm text-muted-foreground">{t("manage.formSubtitle")}</p>
        </div>
        <FormBuilder dashboardId={dashboard.id} fields={fields} />
      </section>
    </main>
  );
}
