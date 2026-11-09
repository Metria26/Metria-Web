"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { BookingSlotOverview, BookingStudent } from "@/features/booking/overview";
import { formatShortDay, formatSlotTime, formatDateTime } from "@/lib/time-format";
import { studentEmailLocalPart, compareStudentsByEmail } from "@/lib/student-sort";

/**
 * Staff-only roster of every booking in a period (T-A students are never sent
 * this data — the RPC only returns it to offering staff). Slots are already
 * SQL-ordered by slot time then natural email; the local sort keeps the table
 * stable against payload reshuffles and matches the RPC ordering rule.
 */
export function PeriodBookingsTable({
  slots,
  students,
}: {
  slots: BookingSlotOverview[];
  students: BookingStudent[];
}) {
  const t = useTranslations("Booking.staff");
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

  const exportCsv = () => {
    const header = [
      "slot_start_iso",
      "slot_time",
      "student_name",
      "student_email",
      "booked_at",
      "status",
    ];
    const lines = [
      header.join(","),
      ...rows.map((row) => {
        const slot = slots.find((candidate) => candidate.id === row.slot_id);
        const cells = [
          slot?.starts_at ?? "",
          slot ? `${formatSlotTime(slot.starts_at)} - ${formatSlotTime(slot.ends_at)}` : "",
          row.student_name,
          row.student_email ?? "",
          row.booked_at ?? "",
          row.status,
        ];
        return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bookings.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="export-bookings-csv"
        >
          {t("exportCsv")}
        </button>
      </div>

      <div className="overflow-x-hidden rounded-lg border">
        <table className="w-full min-w-0 table-fixed text-left text-xs sm:table-auto">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold sm:px-3">{t("colSlot")}</th>
              <th className="px-2 py-2 font-semibold sm:px-3">{t("colStudent")}</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">{t("colEmail")}</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">{t("colBookedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
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
                  <tr key={`${row.slot_id}-${index}`} className="border-t">
                    <td className="px-2 py-2 sm:px-3">
                      <span className="block whitespace-nowrap font-medium">
                        {slot
                          ? `${formatSlotTime(slot.starts_at)} – ${formatSlotTime(slot.ends_at)}`
                          : ""}
                      </span>
                      <span className="block whitespace-nowrap text-muted-foreground sm:hidden">
                        {formatShortDay(slot?.starts_at ?? "")}
                      </span>
                    </td>
                    <td className="px-2 py-2 sm:px-3">
                      <span className="block font-medium">{row.student_name}</span>
                      <span className="block whitespace-nowrap text-muted-foreground sm:hidden">
                        {studentEmailLocalPart(row.student_email ?? "")}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">{row.student_email}</td>
                    <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                      {row.booked_at ? formatDateTime(row.booked_at) : ""}
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
