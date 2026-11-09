import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadPeriodBookingOverview } from "@/features/booking/overview";
import { groupSlotsByDay, slotStatus, type SlotCardStatus } from "@/features/booking/slot-view";
import { cancelState, remainingSeats } from "@/features/booking/rules";
import {
  BookButton,
  BulkSlotForm,
  CancelButton,
  CapacityForm,
  SlotForm,
  SwitchButton,
} from "@/features/booking/ui/forms";
import { PeriodBookingsTable } from "@/features/booking/ui/period-manage";
import { deletePeriodAction, deleteSlotAction } from "@/features/booking/actions";
import { ConfirmDeleteDialogButton } from "@/components/ui/confirm-delete-dialog";
import { formatDayHeading, formatSlotTime } from "@/lib/time-format";
import { AdSlot } from "@/features/ads/ui/ad-slot";

export const metadata: Metadata = {
  title: "Evaluation period",
};

export const instant = false;

/** Status → border/badge classes; AA-contrast pairs from the design tokens. */
const statusClasses: Record<SlotCardStatus, { border: string; badge: string }> = {
  booked_by_me: {
    border: "border-2 border-primary",
    badge: "bg-primary/15 text-primary",
  },
  free: {
    border: "border border-success",
    badge: "bg-success/15 text-success-foreground",
  },
  almost_full: {
    border: "border border-warning",
    badge: "bg-warning/20 text-warning-foreground",
  },
  full: {
    border: "border border-muted bg-muted/30 opacity-80",
    badge: "bg-muted text-muted-foreground",
  },
  cutoff_passed: {
    border: "border border-muted bg-muted/30 opacity-80",
    badge: "bg-muted text-muted-foreground",
  },
};

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
  const dayGroups = groupSlotsByDay(slots);

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto py-2">
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
                    start: formatSlotTime(period.starts_at),
                    end: formatSlotTime(period.ends_at),
                  })}
                </span>
              </p>
              <p className="text-xs text-muted-foreground/80">
                {t("cutoffNote", { hours: period.cutoff_hours })}
              </p>
            </div>
          </div>

          {canManage ? (
            <ConfirmDeleteDialogButton
              label={t("actions.deletePeriod")}
              confirmMessage={t("confirm.deletePeriod", { title: period.title })}
              requireTyping={period.title}
              hiddenFields={{ periodId: period.id }}
              action={deletePeriodAction}
              testId="delete-period"
            />
          ) : null}
        </div>
      </div>

      <AdSlot pageType="booking" slotKey="booking-top" withSponsor />

      {/* Slots Section — rectangular cards grouped by Asia/Karachi day */}
      <section className="grid gap-4" aria-labelledby="slots-heading">
        <div className="flex items-center justify-between">
          <h2 id="slots-heading" className="text-xl font-semibold tracking-tight">
            {t("slots")}
          </h2>
          <span className="text-xs text-muted-foreground font-medium">
            {t("slotsAvailable", { count: slots.length })}
          </span>
        </div>

        {slots.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground" data-testid="no-slots">
              {t("noSlots")}
            </p>
          </div>
        ) : (
          <div className="grid gap-6" data-testid="booking-slot-days">
            {dayGroups.map((group, groupIndex) => (
              <details
                key={group.key}
                open
                className="grid gap-3 rounded-xl"
                data-testid={`slot-day-${groupIndex}`}
              >
                <summary className="cursor-pointer select-none rounded-lg border bg-muted/40 px-3 py-2 text-sm font-semibold">
                  {formatDayHeading(`${group.key}T06:00:00+05:00`)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({group.slots.length})
                  </span>
                </summary>
                <div
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  data-testid="booking-slots"
                >
                  {group.slots.map((slot) => {
                    const open = remainingSeats(slot.booked, slot.capacity);
                    const closed = cancelState(slot.starts_at, period.cutoff_hours);
                    const status = slotStatus(slot, { cutoffHours: period.cutoff_hours });
                    const classes = statusClasses[status];
                    const slotStudents = students.filter((student) => student.slot_id === slot.id);

                    return (
                      <div
                        key={slot.id}
                        className={`grid content-start gap-2 rounded-xl bg-card p-4 shadow-sm transition-all hover:shadow-md ${classes.border}`}
                        data-testid="booking-slot"
                        data-slot-id={slot.id}
                        data-slot-status={status}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className="font-semibold text-sm whitespace-nowrap"
                            data-testid="slot-time"
                          >
                            {formatSlotTime(slot.starts_at)} - {formatSlotTime(slot.ends_at)}
                          </span>
                          <span
                            className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes.badge}`}
                            data-testid="slot-status"
                          >
                            {t(`statuses.${status}`)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span data-testid="slot-capacity">
                            {slot.booked}/{slot.capacity}
                          </span>
                          {slot.location ? (
                            <span className="truncate">📍 {slot.location}</span>
                          ) : null}
                        </div>

                        {/* Student actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          {slot.my_booking_id ? (
                            <span
                              data-testid="my-booking"
                              className="grid justify-items-start gap-1"
                            >
                              <CancelButton
                                bookingId={slot.my_booking_id}
                                periodId={period.id}
                                disabled={closed !== "open"}
                                closedReason={closed === "open" ? undefined : closed}
                              />
                            </span>
                          ) : canManage ? null : hasBookingInPeriod ? (
                            open > 0 && status !== "cutoff_passed" ? (
                              <SwitchButton periodId={period.id} slotId={slot.id} />
                            ) : (
                              <span className="text-xs text-muted-foreground italic">
                                {t("bookedInPeriod")}
                              </span>
                            )
                          ) : (
                            open > 0 &&
                            status !== "cutoff_passed" && (
                              <BookButton
                                periodId={period.id}
                                slotId={slot.id}
                                disabled={open === 0}
                              />
                            )
                          )}
                        </div>

                        {/* Staff panel: capacity edit + delete + roster */}
                        {canManage ? (
                          <div
                            className="mt-1 border-t pt-2 grid gap-2"
                            data-testid="slot-students"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {t("students")} ({slotStudents.length})
                              </span>
                              <ConfirmDeleteDialogButton
                                label={t("actions.deleteSlot")}
                                confirmMessage={t("confirm.deleteSlot", {
                                  time: `${formatSlotTime(slot.starts_at)} - ${formatSlotTime(slot.ends_at)}`,
                                  bookings: slotStudents.filter(
                                    (student) => student.status === "active",
                                  ).length,
                                })}
                                hiddenFields={{ slotId: slot.id, periodId: period.id }}
                                action={deleteSlotAction}
                                testId={`delete-slot-${slot.id.slice(0, 8)}`}
                              />
                            </div>
                            {slotStudents.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">
                                {t("noStudents")}
                              </span>
                            ) : (
                              <ul className="grid gap-1 bg-muted/30 rounded-lg p-2">
                                {slotStudents.map((student, index) => (
                                  <li
                                    key={`${student.slot_id}-${index}`}
                                    className="text-xs flex items-center justify-between gap-2 py-0.5"
                                  >
                                    <span className="font-medium truncate">
                                      {student.student_name}
                                    </span>
                                    <span className="whitespace-nowrap text-muted-foreground">
                                      {(student.student_email ?? "").split("@")[0]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <CapacityForm
                              slotId={slot.id}
                              capacity={slot.capacity}
                              booked={slot.booked}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {canManage ? (
        <>
          {/* Staff roster: all bookings, filters + counts + CSV */}
          <section
            className="grid gap-4 rounded-xl border bg-card p-6 shadow-sm"
            aria-labelledby="staff-bookings-heading"
          >
            <h2 id="staff-bookings-heading" className="text-lg font-semibold">
              {t("staff.title")}
            </h2>
            <PeriodBookingsTable slots={slots} students={students} />
          </section>

          {/* Staff: bulk generation + single slot */}
          <section
            className="grid gap-6 rounded-xl border bg-card p-6 shadow-sm"
            aria-labelledby="manage-slots-heading"
          >
            <div className="grid gap-2">
              <h2 id="manage-slots-heading" className="text-lg font-semibold">
                {t("bulk.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("bulk.hint")}</p>
              <BulkSlotForm periodId={period.id} />
            </div>
            <div className="grid gap-2 border-t pt-4">
              <h3 className="text-base font-semibold">{t("addSlot")}</h3>
              <SlotForm periodId={period.id} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
