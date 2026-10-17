import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadPeriodBookingOverview } from "@/features/booking/overview";
import { cancelState, remainingSeats } from "@/features/booking/rules";
import { BookButton, CancelButton, SlotForm } from "@/features/booking/ui/forms";
import { AdSlot } from "@/features/ads/ui/ad-slot";

export const metadata: Metadata = {
  title: "Evaluation period",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

const slotFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * T-A006 period detail (features 3.1/3.2). Students see per-slot availability
 * and their own booking; offering staff additionally see booked students and
 * can add slots. Data comes from one definer RPC (students must not read peer
 * booking rows — peer visibility is T-A007).
 */
export default async function BookingPeriodPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  await connection();
  const t = await getTranslations("Booking");
  const supabase = await createClient();

  const overview = await loadPeriodBookingOverview(supabase, periodId);
  if (!overview) notFound();

  const { period, can_manage: canManage, slots, students } = overview;
  const hasBookingInPeriod = slots.some((slot) => slot.my_booking_id !== null);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-1">
        <Link
          href="/app/bookings"
          className="text-sm text-primary hover:underline"
          data-testid="back-to-bookings"
        >
          {t("backToList")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="period-title">
          {period.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {period.course_code} · {period.offering_code} ·{" "}
          {t("sectionCode", { code: period.section_code })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("window", {
            start: slotFormat.format(new Date(period.starts_at)),
            end: slotFormat.format(new Date(period.ends_at)),
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("cutoffNote", { hours: period.cutoff_hours })}
        </p>
      </div>

      {/* T-B003: reserved ad geometry (booking-top) as its own section — never
          adjacent to Book/Cancel actions; normal gap-8 spacing separates them. */}
      <AdSlot pageType="booking" slotKey="booking-top" withSponsor />

      <section className="grid gap-3" aria-labelledby="slots-heading">
        <h2 id="slots-heading" className="text-lg font-semibold">
          {t("slots")}
        </h2>
        {slots.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-slots">
            {t("noSlots")}
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="booking-slots">
            {slots.map((slot) => {
              const open = remainingSeats(slot.booked, slot.capacity);
              const closed = cancelState(slot.starts_at, period.cutoff_hours);
              const slotStudents = students.filter((student) => student.slot_id === slot.id);
              return (
                <li
                  key={slot.id}
                  className="grid gap-2 rounded-lg border bg-card px-4 py-3"
                  data-testid="booking-slot"
                  data-slot-id={slot.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {slotFormat.format(new Date(slot.starts_at))} –{" "}
                        {slotFormat.format(new Date(slot.ends_at))}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {slot.location ? `${slot.location} · ` : ""}
                        {t("availability", { open, capacity: slot.capacity })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {slot.my_booking_id ? (
                        <>
                          <span
                            className="text-sm font-medium text-primary"
                            data-testid="my-booking"
                          >
                            {t("booked")}
                          </span>
                          <CancelButton
                            bookingId={slot.my_booking_id}
                            periodId={period.id}
                            disabled={closed !== "open"}
                            closedReason={closed === "open" ? undefined : closed}
                          />
                        </>
                      ) : hasBookingInPeriod ? (
                        <span
                          className="text-sm text-muted-foreground"
                          data-testid="booked-in-period"
                        >
                          {t("bookedInPeriod")}
                        </span>
                      ) : (
                        <>
                          {open === 0 ? (
                            <span className="text-sm text-muted-foreground" data-testid="slot-full">
                              {t("full")}
                            </span>
                          ) : null}
                          <BookButton periodId={period.id} slotId={slot.id} disabled={open === 0} />
                        </>
                      )}
                    </span>
                  </div>
                  {canManage ? (
                    <div className="grid gap-1 border-t pt-2" data-testid="slot-students">
                      <span className="text-xs font-medium">{t("students")}</span>
                      {slotStudents.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("noStudents")}</span>
                      ) : (
                        <ul className="grid gap-0.5">
                          {slotStudents.map((student, index) => (
                            <li
                              key={`${student.slot_id}-${index}`}
                              className="text-xs text-muted-foreground"
                            >
                              {student.student_name} · {t(`statuses.${student.status}`)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="grid gap-3" aria-labelledby="manage-slots-heading">
          <h2 id="manage-slots-heading" className="text-lg font-semibold">
            {t("addSlot")}
          </h2>
          <SlotForm periodId={period.id} />
        </section>
      ) : null}
    </div>
  );
}
