import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import {
  deleteAnnouncementAction,
  deleteAssessmentAction,
  deleteEnrollmentAction,
  removeEnrollmentInviteAction,
} from "@/features/academics/actions";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { loadOfferingAnalytics } from "@/features/academics/analytics";
import { AssessmentForm, EnrollmentForm, SectionForm } from "@/features/academics/ui/forms";
import { AnnouncementForm as AnnouncementComposer } from "@/features/academics/ui/announcement-editor";
import { AnnouncementList } from "@/features/academics/ui/announcement-list";
import { EnrollmentImportPanel } from "@/features/academics/ui/enrollment-import-panel";
import { TaAnalytics } from "@/features/academics/ui/ta-analytics";

export const metadata: Metadata = {
  title: "Offering Hub",
};

export const instant = false;

type SectionRow = { id: string; section_code: string; capacity: number | null };
type AssessmentRow = {
  id: string;
  title: string;
  assessment_type: string;
  total: number;
  weight: number;
  visibility: string;
};
type EnrollmentRow = { id: string; section_id: string; profile_id: string; status: string };
type ProfileRow = { id: string; display_name: string; email: string };
type AnnouncementRow = {
  id: string;
  title: string;
  body_html: string;
  section_id: string;
  created_at: string;
};
type PendingInviteRow = {
  id: string;
  email: string;
  roll_input: string | null;
  section_id: string;
};

export default async function OfferingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ sectionId?: string; tab?: string }>;
}) {
  const { offeringId } = await params;
  const { sectionId, tab = "hub" } = await searchParams;

  await connection();
  const t = await getTranslations("Offerings");
  const supabase = await createClient();

  const [offeringRes, termsRes] = await Promise.all([
    supabase
      .from("course_offerings")
      .select("id, offering_code, term_id, courses ( code, title )")
      .eq("id", offeringId)
      .maybeSingle(),
    supabase.from("terms").select("id, name"),
  ]);

  if (!offeringRes.data) {
    notFound();
  }

  const offeringRow = offeringRes.data as unknown as {
    id: string;
    offering_code: string;
    term_id: string;
    courses: { code: string; title: string } | null;
  };
  const termName = ((termsRes.data ?? []) as { id: string; name: string }[]).find(
    (term) => term.id === offeringRow.term_id,
  )?.name;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };
  const { data: viewerStaffRows } = viewerProfile
    ? await supabase
        .from("offering_staff")
        .select("id")
        .eq("offering_id", offeringId)
        .eq("profile_id", viewerProfile.id)
    : { data: [] as { id: string }[] };
  const viewerIsStaff = (viewerStaffRows ?? []).length > 0;

  const sectionsRes = await supabase
    .from("sections")
    .select("id, section_code, capacity")
    .eq("offering_id", offeringId)
    .order("section_code");
  const sections = (sectionsRes.data ?? []) as SectionRow[];

  const [assessmentsRes, enrollmentsRes, profilesRes] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, title, assessment_type, total, weight, visibility")
      .eq("offering_id", offeringId)
      .order("created_at"),
    sections.length > 0
      ? supabase
          .from("enrollments")
          .select("id, section_id, profile_id, status")
          .in(
            "section_id",
            sections.map((section) => section.id),
          )
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, display_name, email"),
  ]);

  const assessments = (assessmentsRes.data ?? []) as AssessmentRow[];
  const enrollments = (enrollmentsRes.data ?? []) as EnrollmentRow[];
  const profiles = new Map(
    ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );

  const { data: viewerMarks } =
    viewerProfile && assessments.length > 0
      ? await supabase
          .from("marks")
          .select("id")
          .eq("student_id", viewerProfile.id)
          .in(
            "assessment_id",
            assessments.map((assessment) => assessment.id),
          )
          .limit(1)
      : { data: [] as { id: string }[] };
  const viewerHasMarks = (viewerMarks ?? []).length > 0;

  const sectionOptions = sections.map((section) => ({
    id: section.id,
    label: section.section_code,
  }));

  const announcementsRes =
    sections.length > 0
      ? await supabase
          .from("announcements")
          .select("id, title, body_html, section_id, created_at")
          .in(
            "section_id",
            sections.map((section) => section.id),
          )
          .order("created_at", { ascending: false })
      : { data: [] as AnnouncementRow[] };
  const announcements = (announcementsRes.data ?? []) as AnnouncementRow[];
  const sectionCodeById = new Map(sections.map((section) => [section.id, section.section_code]));
  const visibleAssessments = viewerIsStaff
    ? assessments
    : assessments.filter((assessment) => assessment.visibility === "students");

  const pendingInvitesRes =
    viewerIsStaff && sections.length > 0
      ? await supabase
          .from("enrollment_invites")
          .select("id, email, roll_input, section_id")
          .in(
            "section_id",
            sections.map((section) => section.id),
          )
          .eq("status", "pending")
          .order("created_at")
      : { data: [] as PendingInviteRow[] };
  const pendingInvites = (pendingInvitesRes.data ?? []) as PendingInviteRow[];

  let analytics: Awaited<ReturnType<typeof loadOfferingAnalytics>> | null = null;
  if (viewerIsStaff) {
    try {
      analytics = await loadOfferingAnalytics(supabase, offeringId);
    } catch {
      analytics = null;
    }
  }

  const selectedSection = sections.find((s) => s.id === sectionId);

  // STEP 2: SECTION SELECTION VIEW (if no sectionId selected)
  if (!sectionId || !selectedSection) {
    return (
      <div className="flex flex-col gap-8 max-w-3xl mx-auto py-4">
        <div className="grid gap-1">
          <Link
            href="/app/offerings"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="back-to-offerings"
          >
            ← {t("backToList")}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="offering-title">
            {offeringRow.courses
              ? `${offeringRow.courses.code} — ${offeringRow.courses.title}`
              : offeringRow.offering_code}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="offering-meta">
            {offeringRow.offering_code} {termName ? `· ${termName}` : ""}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Select Section</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Choose a section to manage course announcements, assessments, enrollments, and
            analytics.
          </p>

          {sections.length === 0 ? (
            <div className="space-y-4">
              <EmptyState title={t("empty.sectionsTitle")} description={t("empty.sectionsBody")} />
              {viewerIsStaff ? <SectionForm offeringId={offeringId} /> : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((section) => (
                <Link
                  key={section.id}
                  href={`/app/offerings/${offeringId}?sectionId=${section.id}`}
                  className="flex items-center justify-between rounded-xl border bg-background p-4 transition-all hover:border-primary hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div>
                    <span className="font-semibold text-base">{section.section_code}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {section.capacity != null
                        ? t("capacityLabel", { count: section.capacity })
                        : t("capacityUnlimited")}
                    </p>
                  </div>
                  <span className="text-primary font-medium text-sm">Select →</span>
                </Link>
              ))}
            </div>
          )}

          {viewerIsStaff && sections.length > 0 ? (
            <div className="mt-8 pt-6 border-t">
              <h3 className="text-sm font-semibold mb-3">Add Another Section</h3>
              <SectionForm offeringId={offeringId} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // STEP 4: SPECIFIC FEATURE VIEW OR STEP 3: FEATURE HUB
  return (
    <div className="flex flex-col gap-8">
      {/* Header with Offering & Selected Section */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/app/offerings/${offeringId}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Change Section
            </Link>
            <span className="text-muted-foreground">•</span>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Section: {selectedSection.section_code}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="offering-title">
            {offeringRow.courses
              ? `${offeringRow.courses.code} — ${offeringRow.courses.title}`
              : offeringRow.offering_code}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="offering-meta">
            {offeringRow.offering_code} {termName ? `· ${termName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {viewerHasMarks ? (
            <Link
              href={`/app/offerings/${offeringId}/marksheet`}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
              data-testid="marksheet-link"
            >
              {t("viewMarksheet")}
            </Link>
          ) : null}
        </div>
      </div>

      {/* Breadcrumb back to Hub if inside a specific feature */}
      {tab !== "hub" ? (
        <div>
          <Link
            href={`/app/offerings/${offeringId}?sectionId=${sectionId}`}
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            ← Back to Course Options Hub
          </Link>
        </div>
      ) : null}

      {/* STEP 3: FEATURE HUB (Grid of options) */}
      {tab === "hub" ? (
        <div className="grid gap-6">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Course Management Options</h2>
            <p className="text-sm text-muted-foreground">
              Select an option below to open its dedicated view for section{" "}
              {selectedSection.section_code}.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href={`/app/offerings/${offeringId}?sectionId=${sectionId}&tab=announcements`}
              className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
              data-testid="hub-announcements"
            >
              <div>
                <span className="text-2xl">📢</span>
                <h3 className="font-semibold text-lg mt-3 group-hover:text-primary transition-colors">
                  Announcements
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Post and manage announcements for students in this section.
                </p>
              </div>
              <span className="text-xs font-medium text-primary mt-4 inline-block">
                Open View →
              </span>
            </Link>

            <Link
              href={`/app/offerings/${offeringId}?sectionId=${sectionId}&tab=assessments`}
              className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
              data-testid="hub-assessments"
            >
              <div>
                <span className="text-2xl">📝</span>
                <h3 className="font-semibold text-lg mt-3 group-hover:text-primary transition-colors">
                  Assessments & Marks
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Create quizzes, assignments, exams, and enter student marks.
                </p>
              </div>
              <span className="text-xs font-medium text-primary mt-4 inline-block">
                Open View →
              </span>
            </Link>

            <Link
              href={`/app/offerings/${offeringId}?sectionId=${sectionId}&tab=students`}
              className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
              data-testid="hub-students"
            >
              <div>
                <span className="text-2xl">👥</span>
                <h3 className="font-semibold text-lg mt-3 group-hover:text-primary transition-colors">
                  Students & Enrollments
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Enroll students, import CSV rosters, and manage invites.
                </p>
              </div>
              <span className="text-xs font-medium text-primary mt-4 inline-block">
                Open View →
              </span>
            </Link>

            <Link
              href={`/app/offerings/${offeringId}?sectionId=${sectionId}&tab=analytics`}
              className="group flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary hover:shadow-md"
              data-testid="hub-analytics"
            >
              <div>
                <span className="text-2xl">📊</span>
                <h3 className="font-semibold text-lg mt-3 group-hover:text-primary transition-colors">
                  Analytics & Reports
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  View performance analytics, grade distributions, and statistics.
                </p>
              </div>
              <span className="text-xs font-medium text-primary mt-4 inline-block">
                Open View →
              </span>
            </Link>
          </div>
        </div>
      ) : null}

      {/* STEP 4: FOCUSED FEATURE VIEWS */}

      {/* 1. ANNOUNCEMENTS VIEW */}
      {tab === "announcements" ? (
        <div className="grid gap-6 max-w-3xl">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Announcements</h2>
            <p className="text-sm text-muted-foreground">
              Manage course communications for section {selectedSection.section_code}.
            </p>
          </div>

          {announcements.length === 0 ? (
            <EmptyState
              title={t("empty.announcementsTitle")}
              description={t("empty.announcementsBody")}
            />
          ) : (
            <AnnouncementList
              announcements={announcements.map((announcement) => ({
                id: announcement.id,
                title: announcement.title,
                bodyHtml: announcement.body_html,
                context: sectionCodeById.get(announcement.section_id),
                createdAt: announcement.created_at,
              }))}
              renderActions={
                viewerIsStaff
                  ? (announcement) => (
                      <form action={deleteAnnouncementAction}>
                        <input type="hidden" name="announcementId" value={announcement.id} />
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <ConfirmDeleteButton
                          label={t("actions.deleteAnnouncement")}
                          confirmMessage={t("confirm.deleteAnnouncement")}
                          testId="delete-announcement"
                        />
                      </form>
                    )
                  : undefined
              }
            />
          )}

          {viewerIsStaff && sectionOptions.length > 0 ? (
            <div className="mt-4 pt-6 border-t">
              <h3 className="text-sm font-semibold mb-3">Post New Announcement</h3>
              <AnnouncementComposer sections={sectionOptions} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 2. ASSESSMENTS & MARKS VIEW */}
      {tab === "assessments" ? (
        <div className="grid gap-6 max-w-3xl">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Assessments & Marks</h2>
            <p className="text-sm text-muted-foreground">
              Create and manage quizzes, exams, and grade entries.
            </p>
          </div>

          {visibleAssessments.length === 0 ? (
            <EmptyState
              title={t("empty.assessmentsTitle")}
              description={t("empty.assessmentsBody")}
            />
          ) : (
            <ul className="grid gap-2" data-testid="assessments-list">
              {visibleAssessments.map((assessment) => (
                <li
                  key={assessment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                  data-testid="assessment-item"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium">{assessment.title}</span>
                    <span className="text-sm text-muted-foreground" data-testid="assessment-meta">
                      {t(`assessmentTypes.${assessment.assessment_type}`)} · {assessment.total} ·{" "}
                      {assessment.weight}%
                    </span>
                  </span>
                  {viewerIsStaff ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/app/marks/${assessment.id}`}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                        data-testid="marks-link"
                      >
                        {t("enterMarks")}
                      </Link>
                      <form action={deleteAssessmentAction}>
                        <input type="hidden" name="assessmentId" value={assessment.id} />
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <ConfirmDeleteButton
                          label={t("actions.deleteAssessment")}
                          confirmMessage={t("confirm.deleteAssessment")}
                          testId="delete-assessment"
                        />
                      </form>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {viewerIsStaff ? (
            <div className="mt-4 pt-6 border-t">
              <h3 className="text-sm font-semibold mb-3">Create Assessment</h3>
              <AssessmentForm offeringId={offeringId} sections={sectionOptions} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 3. STUDENTS & ENROLLMENTS VIEW */}
      {tab === "students" ? (
        <div className="grid gap-6 max-w-3xl">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Students & Enrollments</h2>
            <p className="text-sm text-muted-foreground">
              Manage student rosters and section enrollments.
            </p>
          </div>

          {enrollments.length === 0 ? (
            <EmptyState title={t("empty.studentsTitle")} description={t("empty.studentsBody")} />
          ) : (
            <ul className="grid gap-2" data-testid="enrollments-list">
              {enrollments.map((enrollment) => {
                const profile = profiles.get(enrollment.profile_id);
                const section = sections.find(
                  (candidate) => candidate.id === enrollment.section_id,
                );
                return (
                  <li
                    key={enrollment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                    data-testid="enrollment-item"
                  >
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {profile?.display_name ?? t("unknownStudent")}
                      </span>
                      <span className="text-sm text-muted-foreground">{profile?.email}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {section?.section_code} · {enrollment.status}
                    </span>
                    {viewerIsStaff ? (
                      <form action={deleteEnrollmentAction}>
                        <input type="hidden" name="enrollmentId" value={enrollment.id} />
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <ConfirmDeleteButton
                          label={t("actions.removeStudent")}
                          confirmMessage={t("confirm.removeStudent")}
                          testId="delete-enrollment"
                        />
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {viewerIsStaff && pendingInvites.length > 0 ? (
            <div className="grid gap-2">
              <h3 className="text-base font-semibold">{t("enrollImport.pendingTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("enrollImport.pendingHintList")}</p>
              <ul className="grid gap-2" data-testid="pending-invites-list">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-card px-4 py-3"
                    data-testid="pending-invite-item"
                  >
                    <span className="grid gap-0.5">
                      <span className="font-medium">{invite.roll_input ?? invite.email}</span>
                      <span className="text-sm text-muted-foreground">
                        {invite.email}
                        {sectionCodeById.get(invite.section_id)
                          ? ` · ${sectionCodeById.get(invite.section_id)}`
                          : ""}
                      </span>
                    </span>
                    <form action={removeEnrollmentInviteAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                        data-testid="pending-invite-remove"
                      >
                        {t("enrollImport.remove")}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {viewerIsStaff && sectionOptions.length > 0 ? (
            <div className="mt-4 pt-6 border-t">
              <h3 className="text-sm font-semibold mb-3">CSV Roster Import</h3>
              <EnrollmentImportPanel sections={sectionOptions} />
            </div>
          ) : null}

          {viewerIsStaff ? (
            <div className="mt-4 pt-6 border-t">
              <h3 className="text-sm font-semibold mb-3">Enroll Single Student</h3>
              {sectionOptions.length > 0 ? (
                <EnrollmentForm sections={sectionOptions} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("enrollmentNeedsSection")}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 4. ANALYTICS & REPORTS VIEW */}
      {tab === "analytics" ? (
        <div className="grid gap-6 max-w-4xl">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Analytics & Reports</h2>
            <p className="text-sm text-muted-foreground">
              Course performance metrics and distribution statistics.
            </p>
          </div>

          {viewerIsStaff && analytics ? (
            <TaAnalytics analytics={analytics} />
          ) : (
            <EmptyState
              title="No analytics available"
              description="Analytics require staff permissions and populated student marks."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
