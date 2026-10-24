import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";
import { loadStudentDashboard } from "@/features/academics/dashboard";
import { AdSlot } from "@/features/ads/ui/ad-slot";

export const metadata = {
  title: "Dashboard",
};

export const instant = false;

const displayDateFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
});

const slotDateFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
  timeStyle: "short",
});

type CourseOfferingRow = {
  id: string;
  offering_code: string;
  courses: { code: string; title: string } | null;
};

export default async function DashboardPage() {
  await connection();
  const t = await getTranslations("Dashboard");
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
    .select("id, offering_code, courses ( code, title )")
    .order("created_at", { ascending: false });

  if (!isAdmin && userProfile) {
    const { data: staffRows } = await supabase
      .from("offering_staff")
      .select("offering_id")
      .eq("profile_id", userProfile.id);
    const staffOfferingIds = (staffRows ?? []).map((r) => r.offering_id);

    if (staffOfferingIds.length > 0) {
      offeringQuery = offeringQuery.in("id", staffOfferingIds);
    } else {
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

  // Load dashboard data and user offerings concurrently
  const [dashboard, offeringsRes] = await Promise.all([
    loadStudentDashboard(supabase),
    offeringQuery,
  ]);

  const offerings = (offeringsRes.data ?? []) as unknown as CourseOfferingRow[];

  // Group announcements by course code
  const announcementsByCourse = new Map<string, typeof dashboard.announcements>();
  for (const ann of dashboard.announcements) {
    const list = announcementsByCourse.get(ann.course_code) ?? [];
    list.push(ann);
    announcementsByCourse.set(ann.course_code, list);
  }

  // Group marks by course code
  const marksByCourse = new Map<string, typeof dashboard.latest_marks>();
  for (const mark of dashboard.latest_marks) {
    const list = marksByCourse.get(mark.course_code) ?? [];
    list.push(mark);
    marksByCourse.set(mark.course_code, list);
  }

  // Group upcoming assessments by course code
  const assessmentsByCourse = new Map<string, typeof dashboard.upcoming_assessments>();
  for (const asm of dashboard.upcoming_assessments) {
    const list = assessmentsByCourse.get(asm.course_code) ?? [];
    list.push(asm);
    assessmentsByCourse.set(asm.course_code, list);
  }

  // Group evaluation slots by course code
  const slotsByCourse = new Map<string, typeof dashboard.evaluation_slots>();
  for (const slot of dashboard.evaluation_slots) {
    const list = slotsByCourse.get(slot.course_code) ?? [];
    list.push(slot);
    slotsByCourse.set(slot.course_code, list);
  }

  const isEmpty =
    dashboard.latest_marks.length === 0 &&
    dashboard.announcements.length === 0 &&
    dashboard.upcoming_assessments.length === 0 &&
    dashboard.evaluation_slots.length === 0 &&
    offerings.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <AdSlot pageType="dashboard" slotKey="dashboard-top" withSponsor />

      {isEmpty ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("body")}
          action={{ href: "/app/offerings", label: t("browseOfferings") }}
        />
      ) : null}

      {/* 1. TOP: ANNOUNCEMENTS (Prominent & Bigger) */}
      <section className="grid gap-4" aria-labelledby="announcements-heading">
        <div className="flex items-center justify-between">
          <h2
            id="announcements-heading"
            className="text-xl font-semibold tracking-tight flex items-center gap-2"
          >
            <span>📢</span> {t("announcements")}
          </h2>
          <span className="text-xs text-muted-foreground font-medium">
            Recent Course Broadcasts
          </span>
        </div>

        {dashboard.announcements.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
            <p
              className="text-sm text-muted-foreground"
              data-testid="dashboard-announcements-empty"
            >
              {t("noAnnouncements")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {dashboard.announcements.map((announcement) => (
              <div
                key={announcement.id}
                className="flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:border-primary/50"
              >
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      {announcement.course_code} · {announcement.section_code}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {displayDateFormat.format(new Date(announcement.created_at))}
                    </span>
                  </div>
                  <h3 className="font-semibold text-lg leading-snug">{announcement.title}</h3>
                  <div
                    className="text-sm text-muted-foreground prose prose-sm max-w-none line-clamp-3"
                    dangerouslySetInnerHTML={{ __html: announcement.body_html }}
                  />
                </div>
                <div className="mt-4 pt-4 border-t flex justify-end">
                  <Link
                    href={`/app/offerings/${announcement.offering_id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View Offering →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. SECOND: COURSES (Offering / Enrolled) */}
      <section className="grid gap-4" aria-labelledby="courses-heading">
        <div className="flex items-center justify-between">
          <h2
            id="courses-heading"
            className="text-xl font-semibold tracking-tight flex items-center gap-2"
          >
            <span>📚</span> Your Courses & Offerings
          </h2>
          <Link href="/app/offerings" className="text-xs font-medium text-primary hover:underline">
            View All Courses →
          </Link>
        </div>

        {offerings.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
            <p className="text-sm text-muted-foreground">No courses or offerings found.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((offering) => (
              <Link
                key={offering.id}
                href={`/app/offerings/${offering.id}`}
                className="group flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-primary hover:shadow-md"
              >
                <div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {offering.offering_code}
                  </span>
                  <h3 className="font-semibold text-base mt-1 group-hover:text-primary transition-colors">
                    {offering.courses
                      ? `${offering.courses.code} — ${offering.courses.title}`
                      : offering.offering_code}
                  </h3>
                </div>
                <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs font-medium text-primary">
                  <span>Manage Course</span>
                  <span>→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 3. THIRD: UPCOMING ASSESSMENTS & BOOKINGS (Wrt Course) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Assessments */}
        <section className="grid gap-4" aria-labelledby="upcoming-heading">
          <div className="flex items-center justify-between">
            <h2
              id="upcoming-heading"
              className="text-xl font-semibold tracking-tight flex items-center gap-2"
            >
              <span>📝</span> {t("upcoming")}
            </h2>
          </div>

          {dashboard.upcoming_assessments.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
              <p className="text-sm text-muted-foreground" data-testid="dashboard-upcoming-empty">
                {t("noUpcoming")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3" data-testid="dashboard-upcoming">
              {dashboard.upcoming_assessments.map((assessment) => (
                <div
                  key={assessment.id}
                  className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm"
                  data-testid="dashboard-upcoming-item"
                >
                  <div className="grid gap-0.5">
                    <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground w-fit mb-1">
                      {assessment.course_code}
                    </span>
                    <span className="font-medium text-base">{assessment.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`assessmentTypes.${assessment.assessment_type}`)} · Weight:{" "}
                      {assessment.weight}%
                    </span>
                  </div>
                  <Link
                    href={`/app/offerings/${assessment.offering_id}`}
                    className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    {t("viewOffering")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Evaluation Bookings */}
        <section className="grid gap-4" aria-labelledby="dashboard-bookings-heading">
          <div className="flex items-center justify-between">
            <h2
              id="dashboard-bookings-heading"
              className="text-xl font-semibold tracking-tight flex items-center gap-2"
            >
              <span>📅</span> {t("bookings")}
            </h2>
          </div>

          {dashboard.evaluation_slots.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
              <p className="text-sm text-muted-foreground" data-testid="dashboard-bookings-empty">
                {t("noBookings")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3" data-testid="dashboard-bookings">
              {dashboard.evaluation_slots.map((slot, index) => (
                <div
                  key={`${slot.slot_id}-${index}`}
                  className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm"
                  data-testid="dashboard-booking"
                >
                  <div className="grid gap-0.5">
                    <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground w-fit mb-1">
                      {slot.course_code}
                    </span>
                    <span className="font-medium text-base">{slot.period_title}</span>
                    <span className="text-xs text-muted-foreground">
                      {slotDateFormat.format(new Date(slot.starts_at))}
                      {slot.location ? ` · ${slot.location}` : ""}
                    </span>
                  </div>
                  <Link
                    href={`/app/bookings/${slot.period_id}`}
                    className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                    data-testid="dashboard-booking-link"
                  >
                    {t("viewBookings")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 4. FOURTH: MARKS (Wrt Course / TA & Student Consistency) */}
      <section className="grid gap-4" aria-labelledby="marks-heading">
        <div className="flex items-center justify-between">
          <h2
            id="marks-heading"
            className="text-xl font-semibold tracking-tight flex items-center gap-2"
          >
            <span>🎯</span> {t("latestMarks")}
          </h2>
        </div>

        {dashboard.latest_marks.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
            <p className="text-sm text-muted-foreground" data-testid="dashboard-marks-empty">
              {t("noMarks")}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="dashboard-marks">
            {dashboard.latest_marks.map((mark, index) => (
              <div
                key={`${mark.offering_id}-${mark.assessment_title}-${index}`}
                className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm"
                data-testid="dashboard-mark"
              >
                <div className="grid gap-0.5">
                  <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground w-fit mb-1">
                    {mark.course_code} · {mark.course_title}
                  </span>
                  <span className="font-medium text-base">{mark.assessment_title}</span>
                  <span className="text-xs text-muted-foreground">
                    {displayDateFormat.format(new Date(mark.recorded_at))}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-base font-semibold">
                    {mark.score != null ? `${mark.score} / ${mark.total}` : t("pending")}
                  </span>
                  <Link
                    href={`/app/offerings/${mark.offering_id}/marksheet`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {t("viewMarksheet")} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
