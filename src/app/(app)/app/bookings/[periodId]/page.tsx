import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadPeriodBookingOverview } from "@/features/booking/overview";
import { cancelState, remainingSeats } from "@/features/booking/rules";
import { BookButton, CancelButton, SlotForm } from "@/features/booking/ui/forms";
import { deletePeriodAction, deleteSlotAction } from "@/features/booking/actions";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { AdSlot } from "@/features/ads/ui/ad-slot";

export const metadata: Metadata = {
  title: "Evaluation period",
};

export const instant = false;

const slotFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

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
    <div className="flex flex-col gap-8 max-w-4xl mx-auto py-2">
      {/* Header Card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <Link
              href="/app/bookings"
              className="text-sm font-medium text-primary hover:underline w-fit"
              data-testid="back-to-bookings"
            >
              ← {t("backToList")}
            </Link>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {period.course_code} · {period.offering_code}
              </span>
              <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {t("sectionCode", { code: period.section_code })}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-1" data-testid="period-title">
              {period.title}
            </h1>
            <div className="text-sm text-muted-foreground grid gap-1 mt-2">
              <p className="flex items-center gap-1.5">
                <span>🕒</span>
                <span>
                  {t("window", {
                    start: slotFormat.format(new Date(period.starts_at)),
                    end: slotFormat.format(new Date(period.ends_at)),
                  })}
                </span>
              </p>
              <p className="text-xs text-muted-foreground/80">
                {t("cutoffNote", { hours: period.cutoff_hours })}
              </p>
            </div>
          </div>

          {canManage ? (
            <form action={deletePeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <ConfirmDeleteButton
                label={t("actions.deletePeriod")}
                confirmMessage={t("confirm.deletePeriod")}
                testId="delete-period"
              />
            </form>
          ) : null}
        </div>
      </div>

      <AdSlot pageType="booking" slotKey="booking-top" withSponsor />

      {/* Slots Section */}
      <section className="grid gap-4" aria-labelledby="slots-heading">
        <div className="flex items-center justify-between">
          <h2 id="slots-heading" className="text-xl font-semibold tracking-tight">
            {t("slots")}
          </h2>
          <span className="text-xs text-muted-foreground font-medium">
            {slots.length} time slot{slots.length === 1 ? "" : "s"} available
          </span>
        </div>

        {slots.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground" data-testid="no-slots">
              {t("noSlots")}
            </p>
          </div>
        ) : (
          <div className="grid gap-3" data-testid="booking-slots">
            {slots.map((slot) => {
              const open = remainingSeats(slot.booked, slot.capacity);
              const closed = cancelState(slot.starts_at, period.cutoff_hours);
              const slotStudents = students.filter((student) => student.slot_id === slot.id);
              const percentBooked = Math.round((slot.booked / slot.capacity) * 100);

              return (
                <div
                  key={slot.id}
                  className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
                  data-testid="booking-slot"
                  data-slot-id={slot.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="grid gap-1.5 flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-base">
                          {slotFormat.format(new Date(slot.starts_at))} –{" "}
                          {slotFormat.format(new Date(slot.ends_at))}
                        </span>
                        {slot.location ? (
                          <span className="inline-flex items-center rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                            📍 {slot.location}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{t("availability", { open, capacity: slot.capacity })}</span>
                        <div className="w-24 bg-muted rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-primary h-full transition-all"
                            style={{ width: `${Math.min(percentBooked, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {slot.my_booking_id ? (
                        <>
                          <span
                            className="inline-flex items-center rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                            data-testid="my-booking"
                          >
                            ✓ {t("booked")}
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
                          className="text-xs font-medium text-muted-foreground italic"
                          data-testid="booked-in-period"
                        >
                          {t("bookedInPeriod")}
                        </span>
                      ) : (
                        <>
                          {open === 0 ? (
                            <span
                              className="text-xs font-medium text-destructive"
                              data-testid="slot-full"
                            >
                              {t("full")}
                            </span>
                          ) : null}
                          <BookButton periodId={period.id} slotId={slot.id} disabled={open === 0} />
                        </>
                      )}
                    </div>
                  </div>

                  {canManage ? (
                    <div className="mt-4 pt-4 border-t grid gap-3" data-testid="slot-students">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("students")} ({slotStudents.length})
                        </span>
                        <form action={deleteSlotAction}>
                          <input type="hidden" name="slotId" value={slot.id} />
                          <input type="hidden" name="periodId" value={period.id} />
                          <ConfirmDeleteButton
                            label={t("actions.deleteSlot")}
                            confirmMessage={t("confirm.deleteSlot")}
                            testId="delete-slot"
                          />
                        </form>
                      </div>

                      {slotStudents.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">
                          {t("noStudents")}
                        </span>
                      ) : (
                        <ul className="grid gap-1 bg-muted/30 rounded-lg p-3">
                          {slotStudents.map((student, index) => (
                            <li
                              key={`${student.slot_id}-${index}`}
                              className="text-xs flex items-center justify-between py-1 border-b last:border-0 border-muted"
                            >
                              <span className="font-medium">{student.student_name}</span>
                              <span className="text-muted-foreground">
                                {t(`statuses.${student.status}`)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canManage ? (
        <section
          className="grid gap-4 rounded-xl border bg-card p-6 shadow-sm"
          aria-labelledby="manage-slots-heading"
        >
          <h2 id="manage-slots-heading" className="text-lg font-semibold">
            {t("addSlot")}
          </h2>
          <SlotForm periodId={period.id} />
        </section>
      ) : null}
    </div>
  );
}
