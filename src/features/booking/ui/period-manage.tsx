"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  BookingEvaluator,
  BookingSlotOverview,
  BookingStudent,
} from "@/features/booking/overview";
import { formatShortDay, formatSlotTime, formatDateTime } from "@/lib/time-format";
import { studentEmailLocalPart, compareStudentsByEmail } from "@/lib/student-sort";
import { ConfirmDeleteDialogButton } from "@/components/ui/confirm-delete-dialog";
import { deleteBookingAction } from "@/features/booking/actions";
import { ReassignForm } from "./forms";

/**
 * Staff-only roster of every booking in a period (T-A students are never sent
 * this data — the RPC only returns it to offering staff). Slots are already
 * SQL-ordered by slot time then natural email; the local sort keeps the table
 * stable against payload reshuffles and matches the RPC ordering rule.
 */
export function PeriodBookingsTable({
  periodId,
  slots,
  students,
  evaluators,
}: {
  periodId: string;
  slots: BookingSlotOverview[];
  students: BookingStudent[];
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking.staff");
  const tBooking = useTranslations("Booking");
  const [dayFilter, setDayFilter] = useState("");
  const [slotFilter, setSlotFilter] = useState("");

  const dayOptions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const slot of slots) {
      const key = formatShortDay(slot.starts_at);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].map(([value, count]) => ({ value, count }));
  }, [slots]);

  const slotOptions = useMemo(
    () =>
      slots.map((slot) => ({
        id: slot.id,
        label: `${formatSlotTime(slot.starts_at)} – ${formatSlotTime(slot.ends_at)}`,
      })),
    [slots],
  );

  const rows = useMemo(() => {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    return [...students]
      .filter((student) => byId.has(student.slot_id))
      .filter((student) => {
        if (!slotFilter) return true;
        return student.slot_id === slotFilter;
      })
      .filter((student) => {
        if (!dayFilter) return true;
        const slot = byId.get(student.slot_id);
        return slot ? formatShortDay(slot.starts_at) === dayFilter : true;
      })
      .sort((a, b) => {
        const aStart = byId.get(a.slot_id)?.starts_at ?? "";
        const bStart = byId.get(b.slot_id)?.starts_at ?? "";
        if (aStart !== bStart) return aStart < bStart ? -1 : 1;
        return compareStudentsByEmail(
          { email: a.student_email ?? "", displayName: a.student_name },
          { email: b.student_email ?? "", displayName: b.student_name },
        );
      });
  }, [students, slots, dayFilter, slotFilter]);

  const activeBookedCount = students.filter((student) => student.status === "active").length;
  const freeSlots = slots.filter((slot) => slot.booked < slot.capacity).length;

  return (
    <div className="grid gap-3" data-testid="period-bookings-table">
      {/* Count summary (total slots / booked / free) */}
      <ul className="flex flex-wrap gap-2 text-xs" data-testid="bookings-count-summary">
        <li className="rounded-full border px-2.5 py-1 font-medium">
          {t("totalSlots", { count: slots.length })}
        </li>
        <li className="rounded-full border border-success/60 px-2.5 py-1 font-medium">
          {t("bookedStudents", { count: activeBookedCount })}
        </li>
        <li className="rounded-full border px-2.5 py-1 font-medium">
          {t("freeSlots", { count: freeSlots })}
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <label className="grid gap-1 text-xs font-medium">
          {t("filterDay")}
          <select
            value={dayFilter}
            onChange={(event) => setDayFilter(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            data-testid="filter-day"
          >
            <option value="">{t("allDays")}</option>
            {dayOptions.map((day) => (
              <option key={day.value} value={day.value}>
                {day.value}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("filterSlot")}
          <select
            value={slotFilter}
            onChange={(event) => setSlotFilter(event.target.value)}
            className="h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            data-testid="filter-slot"
          >
            <option value="">{t("allSlots")}</option>
            {slotOptions.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label}
              </option>
            ))}
          </select>
        </label>
        <a
          href={`/api/bookings/${periodId}/export`}
          download
          className="ml-auto inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="export-bookings-csv"
        >
          {t("exportCsv")}
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[56rem] table-auto text-left text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-semibold">{t("colSlot")}</th>
              <th className="px-3 py-3 font-semibold">{t("colStudent")}</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">{t("colEmail")}</th>
              <th className="px-3 py-3 font-semibold">{t("colEvaluator")}</th>
              <th className="hidden px-3 py-2 font-semibold lg:table-cell">{t("colBookedAt")}</th>
              <th className="px-3 py-3 font-semibold">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-muted-foreground"
                  data-testid="no-staff-bookings"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const slot = slots.find((candidate) => candidate.id === row.slot_id);
                return (
                  <tr
                    key={`${row.booking_id ?? row.slot_id}-${index}`}
                    className="border-t align-top"
                  >
                    <td className="min-w-0 px-3 py-3 align-top">
                      <span className="block whitespace-nowrap font-medium">
                        {slot
                          ? `${formatSlotTime(slot.starts_at)} – ${formatSlotTime(slot.ends_at)}`
                          : ""}
                      </span>
                      <span className="block whitespace-nowrap text-muted-foreground sm:hidden">
                        {formatShortDay(slot?.starts_at ?? "")}
                      </span>
                    </td>
                    <td className="min-w-0 px-3 py-3 align-top">
                      <span className="block break-words font-medium">{row.student_name}</span>
                      <span className="block whitespace-nowrap text-muted-foreground sm:hidden">
                        {studentEmailLocalPart(row.student_email ?? "")}
                      </span>
                    </td>
                    <td className="hidden min-w-0 break-all px-3 py-3 align-top sm:table-cell">
                      {row.student_email}
                    </td>
                    <td className="min-w-0 px-3 py-3 align-top">
                      <span className="block break-words font-medium">
                        {row.evaluator_name ?? tBooking("schedule.noEvaluator")}
                      </span>
                      {row.seat_number != null ? (
                        <span className="block text-muted-foreground">#{row.seat_number}</span>
                      ) : null}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 align-top lg:table-cell">
                      {row.booked_at ? formatDateTime(row.booked_at) : ""}
                    </td>
                    <td className="min-w-0 px-3 py-3 align-top">
                      {row.booking_id ? (
                        <div className="flex flex-wrap items-start gap-2">
                          <ReassignForm
                            periodId={periodId}
                            bookingId={row.booking_id}
                            evaluators={evaluators}
                            compact
                          />
                          <ConfirmDeleteDialogButton
                            label={tBooking("actions.deleteBooking")}
                            confirmMessage={tBooking("confirm.deleteBooking", {
                              student: row.student_name,
                              time: slot ? formatSlotTime(slot.starts_at) : "",
                            })}
                            hiddenFields={{ periodId, bookingId: row.booking_id }}
                            action={deleteBookingAction}
                            testId={`delete-booking-${row.booking_id.slice(0, 8)}`}
                            buttonClass="inline-flex h-8 items-center rounded-lg border border-destructive/40 bg-background px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("orderingNote")}</p>
    </div>
  );
}
