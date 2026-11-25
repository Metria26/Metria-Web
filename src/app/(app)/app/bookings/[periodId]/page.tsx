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
  BulkReassignForm,
  BulkSlotForm,
  CancelButton,
  CapacityForm,
  EvaluatorManageForm,
  RemoveEvaluatorForm,
  SlotForm,
  SwitchButton,
} from "@/features/booking/ui/forms";
import { EvaluatorSchedule, SeatSchedule } from "@/features/booking/ui/evaluator-schedule";
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
    border: "border-2 border-success/70",
    badge: "bg-success/15 text-success-foreground",
  },
  almost_full: {
    border: "border-2 border-warning/70",
    badge: "bg-warning/20 text-warning-foreground",
  },
  full: {
    border: "border-2 border-muted/50 bg-muted/20 opacity-80",
    badge: "bg-muted text-muted-foreground",
  },
  cutoff_passed: {
    border: "border-2 border-muted/50 bg-muted/20 opacity-80",
    badge: "bg-muted text-muted-foreground",
  },
};

/**
 * Shared glassmorphism surfaces. Translucent backgrounds + backdrop blur keep
 * the frosted look in both themes; white rings and soft shadows add depth.
 */
const glassCard =
  "relative overflow-hidden rounded-2xl border border-white/25 bg-card/75 shadow-lg shadow-primary/5 ring-1 ring-white/10 backdrop-blur-xl dark:border-white/10 dark:bg-card/60";
const glassInner =
  "rounded-2xl border border-white/20 bg-background/60 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-background/40";

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

  const { period, can_manage: canManage, evaluators, slots, students } = overview;
  const hasBookingInPeriod = slots.some((slot) => slot.my_booking_id !== null);
  const myBookings = slots.filter((slot) => slot.my_booking_id !== null);
  const dayGroups = groupSlotsByDay(slots);

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto py-2">
      {/* Header Card */}
      <div className={`${glassCard} p-6`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-br from-primary/12 via-transparent to-transparent" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
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
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/bookings/${period.id}/export`}
                download
                className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                data-testid="download-bookings-csv"
              >
                {t("actions.downloadCsv")}
              </a>
              <ConfirmDeleteDialogButton
                label={t("actions.deletePeriod")}
                confirmMessage={t("confirm.deletePeriod", { title: period.title })}
                requireTyping={period.title}
                hiddenFields={{ periodId: period.id }}
                action={deletePeriodAction}
                testId="delete-period"
              />
            </div>
          ) : null}
        </div>
      </div>

      <AdSlot pageType="booking" slotKey="booking-top" withSponsor />

      {/* Student: evaluator is revealed only for slots the caller booked. Staff
          manage rosters elsewhere and never see this student prompt. */}
      {!canManage ? (
        <section
          className={`${glassCard} p-6`}
          aria-labelledby="my-evaluation-heading"
          data-testid="my-evaluation-panel"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-br from-primary/12 via-transparent to-transparent" />
          <div className="relative z-10 grid gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-lg text-primary shadow-inner"
                  aria-hidden
                >
                  🎓
                </span>
                <div className="grid min-w-0 gap-1">
                  <h2 id="my-evaluation-heading" className="text-xl font-semibold tracking-tight">
                    {t("myEvaluation.title")}
                  </h2>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {myBookings.length > 0
                      ? t("myEvaluation.assignedNote")
                      : t("myEvaluation.none")}
                  </p>
                </div>
              </div>
              {myBookings.length > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success-foreground">
                  <span className="size-1.5 rounded-full bg-success" aria-hidden />
                  {t("myEvaluation.confirmed")}
                </span>
              ) : null}
            </div>

            {myBookings.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {myBookings.map((slot) => {
                  const evaluator = slot.my_evaluator;
                  const initials = evaluator?.name
                    ? evaluator.name
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() ?? "")
                        .join("")
                    : "?";
                  const hasContact = Boolean(
                    evaluator?.email || evaluator?.phone || evaluator?.contact_note,
                  );

                  return (
                    <article
                      key={slot.id}
                      className={`${glassInner} grid content-start gap-4 p-5`}
                      data-testid="my-evaluation-booking"
                    >
                      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2 border-b border-white/15 pb-3 dark:border-white/10">
                        <div className="grid min-w-0 gap-0.5">
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("myEvaluation.slot")}
                          </span>
                          <span
                            className="whitespace-nowrap text-base font-semibold tabular-nums"
                            data-testid="my-evaluation-slot"
                          >
                            {formatSlotTime(slot.starts_at)} – {formatSlotTime(slot.ends_at)}
                          </span>
                        </div>
                        {slot.location ? (
                          <span className="max-w-full break-words rounded-lg border border-white/20 bg-background/50 px-2.5 py-1 text-xs text-muted-foreground">
                            📍 {slot.location}
                          </span>
                        ) : null}
                      </div>

                      <div className="grid min-w-0 gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {t("myEvaluation.yourEvaluator")}
                        </p>
                        {evaluator ? (
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-primary to-primary/60 text-sm font-bold text-primary-foreground shadow-md"
                              aria-hidden
                            >
                              {initials}
                            </div>
                            <div className="grid min-w-0 gap-0.5">
                              <p
                                className="truncate text-lg font-semibold"
                                data-testid="my-evaluator-name"
                                title={evaluator.name}
                              >
                                {evaluator.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("myEvaluation.evaluator")}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t("schedule.noEvaluator")}
                          </p>
                        )}
                      </div>

                      {evaluator && hasContact ? (
                        <div
                          className="grid min-w-0 gap-1.5 rounded-xl border border-white/15 bg-background/40 p-3 text-xs dark:border-white/10"
                          data-testid="my-evaluator-contact"
                        >
                          <p className="font-semibold uppercase tracking-wider text-muted-foreground">
                            {t("myEvaluation.contactDetails")}
                          </p>
                          {evaluator.email ? (
                            <p className="min-w-0 break-all" data-testid="my-evaluator-email">
                              <span className="font-medium">{t("myEvaluation.email")}: </span>
                              {evaluator.email}
                            </p>
                          ) : null}
                          {evaluator.phone ? (
                            <p className="min-w-0 break-words" data-testid="my-evaluator-phone">
                              <span className="font-medium">{t("myEvaluation.phone")}: </span>
                              {evaluator.phone}
                            </p>
                          ) : null}
                          {evaluator.contact_note ? (
                            <p className="min-w-0 break-words" data-testid="my-evaluator-note">
                              <span className="font-medium">{t("myEvaluation.note")}: </span>
                              {evaluator.contact_note}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="w-fit rounded-full border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                          {t("myEvaluation.noContact")}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-primary/20 bg-primary/5 p-6 text-center text-sm text-muted-foreground">
                {t("myEvaluation.hint")}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Slots Section — rectangular cards grouped by Asia/Karachi day */}
      <section className="grid gap-4 overflow-hidden" aria-labelledby="slots-heading">
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
                className="grid min-w-0 gap-3 rounded-2xl"
                data-testid={`slot-day-${groupIndex}`}
              >
                <summary className="cursor-pointer select-none rounded-xl border border-white/20 bg-background/60 px-3 py-2.5 text-sm font-semibold shadow-sm backdrop-blur-md dark:border-white/10">
                  {formatDayHeading(`${group.key}T06:00:00+05:00`)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({group.slots.length})
                  </span>
                </summary>
                <div
                  className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"
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
                        className={`grid min-w-0 content-start gap-3 rounded-2xl bg-card/75 p-4 shadow-sm ring-1 ring-white/15 backdrop-blur-md transition-shadow hover:shadow-md dark:ring-white/10 ${classes.border}`}
                        data-testid="booking-slot"
                        data-slot-id={slot.id}
                        data-slot-status={status}
                      >
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <span
                            className="min-w-0 break-words text-sm font-semibold tabular-nums"
                            data-testid="slot-time"
                          >
                            {formatSlotTime(slot.starts_at)} - {formatSlotTime(slot.ends_at)}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes.badge}`}
                            data-testid="slot-status"
                          >
                            {t(`statuses.${status}`)}
                          </span>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="shrink-0 tabular-nums" data-testid="slot-capacity">
                            {slot.booked}/{slot.capacity}
                          </span>
                          {slot.location ? (
                            <span className="min-w-0 break-all">📍 {slot.location}</span>
                          ) : null}
                        </div>

                        {/* Student actions */}
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                            className="mt-1 grid min-w-0 gap-2 border-t border-white/15 pt-3 dark:border-white/10"
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
                              <ul className="grid min-w-0 gap-1 rounded-xl border border-white/10 bg-background/50 p-2 dark:border-white/10">
                                {slotStudents.map((student, index) => (
                                  <li
                                    key={`${student.slot_id}-${index}`}
                                    className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs"
                                  >
                                    <span className="min-w-0 break-words font-medium">
                                      {student.student_name}
                                    </span>
                                    <span
                                      className="max-w-[45%] min-w-0 shrink-0 truncate text-muted-foreground"
                                      title={student.student_email ?? ""}
                                    >
                                      {(student.student_email ?? "").split("@")[0]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <CapacityForm
                              key={`${slot.id}-${slot.capacity}`}
                              slotId={slot.id}
                              capacity={slot.capacity}
                              booked={slot.booked}
                              evaluatorCount={evaluators.length}
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
          {/* Staff: TA-authored evaluator roster (no accounts, no hardcoding). */}
          <section className={`${glassCard} grid gap-4 p-6`} aria-labelledby="evaluators-heading">
            <div className="grid gap-1">
              <h2 id="evaluators-heading" className="text-lg font-semibold">
                {t("evaluators.title")} ({t("evaluators.count", { count: evaluators.length })})
              </h2>
            </div>
            <EvaluatorManageForm
              key={evaluators.map((item) => `${item.id}:${item.position}:${item.name}`).join("|")}
              periodId={period.id}
              evaluators={evaluators}
            />
          </section>

          {/* Staff: reassignment + deletion with explicit replacement. */}
          <section className={`${glassCard} grid gap-6 p-6`} aria-labelledby="reassign-heading">
            <div className="grid gap-2">
              <h2 id="reassign-heading" className="text-lg font-semibold">
                {t("reassign.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("reassign.hint")}</p>
              <BulkReassignForm periodId={period.id} evaluators={evaluators} />
            </div>
            <div className="grid min-w-0 gap-2 border-t border-white/15 pt-4 dark:border-white/10">
              <h3 className="text-base font-semibold">{t("evaluators.removeTitle")}</h3>
              <RemoveEvaluatorForm periodId={period.id} evaluators={evaluators} />
            </div>
          </section>

          {/* Staff: per-evaluator view and the full seat-by-seat assignment. */}
          <section className={`${glassCard} grid gap-6 p-6`} aria-labelledby="schedule-heading">
            <div className="grid gap-2">
              <h2 id="schedule-heading" className="text-lg font-semibold">
                {t("schedule.title")}
              </h2>
              <EvaluatorSchedule slots={slots} evaluators={evaluators} />
            </div>
            <div className="grid min-w-0 gap-2 border-t border-white/15 pt-4 dark:border-white/10">
              <h3 className="text-base font-semibold">{t("seats.title")}</h3>
              <SeatSchedule periodId={period.id} slots={slots} evaluators={evaluators} />
            </div>
          </section>

          {/* Staff roster: all bookings, filters + counts + CSV */}
          <section
            className={`${glassCard} grid gap-4 p-6`}
            aria-labelledby="staff-bookings-heading"
          >
            <h2 id="staff-bookings-heading" className="text-lg font-semibold">
              {t("staff.title")}
            </h2>
            <PeriodBookingsTable
              periodId={period.id}
              slots={slots}
              students={students}
              evaluators={evaluators}
            />
          </section>

          {/* Staff: bulk generation + single slot */}
          <section className={`${glassCard} grid gap-6 p-6`} aria-labelledby="manage-slots-heading">
            <div className="grid gap-2">
              <h2 id="manage-slots-heading" className="text-lg font-semibold">
                {t("bulk.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("bulk.hint")}</p>
              <BulkSlotForm periodId={period.id} evaluatorCount={evaluators.length} />
            </div>
            <div className="grid min-w-0 gap-2 border-t border-white/15 pt-4 dark:border-white/10">
              <h3 className="text-base font-semibold">{t("addSlot")}</h3>
              <SlotForm periodId={period.id} evaluatorCount={evaluators.length} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
