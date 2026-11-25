"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BookingEvaluator, BookingSlotOverview } from "@/features/booking/overview";
import { formatSlotTime } from "@/lib/time-format";
import { ConfirmDeleteDialogButton } from "@/components/ui/confirm-delete-dialog";
import { deleteBookingAction } from "@/features/booking/actions";
import { ReassignForm } from "./forms";

type ScheduleRow = {
  evaluatorId: string;
  evaluatorName: string;
  slotStart: string;
  seatNumber: number;
  studentName: string;
};

/**
 * Staff-only per-evaluator view built from booked seats. Students never receive
 * this component's data — evaluator details are scoped to their own booking.
 */
export function EvaluatorSchedule({
  slots,
  evaluators,
}: {
  slots: BookingSlotOverview[];
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking.schedule");
  const [copied, setCopied] = useState(false);

  const groups = new Map<string, ScheduleRow[]>();
  for (const slot of slots) {
    for (const seat of slot.seats) {
      if (!seat.booking_id || !seat.evaluator_id || !seat.evaluator_name) continue;
      const row: ScheduleRow = {
        evaluatorId: seat.evaluator_id,
        evaluatorName: seat.evaluator_name,
        slotStart: slot.starts_at,
        seatNumber: seat.seat_number,
        studentName: seat.student_name ?? "",
      };
      const existing = groups.get(row.evaluatorId) ?? [];
      existing.push(row);
      groups.set(row.evaluatorId, existing);
    }
  }

  const rows = [...evaluators]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .filter((evaluator) => groups.has(evaluator.id))
    .map((evaluator) => ({
      evaluator,
      entries: groups
        .get(evaluator.id)!
        .sort((a, b) => a.slotStart.localeCompare(b.slotStart) || a.seatNumber - b.seatNumber),
    }));

  const asText = rows
    .map((group) =>
      [
        group.evaluator.name,
        ...group.entries.map(
          (entry) =>
            `  ${formatSlotTime(entry.slotStart)} · ${t("seat")} ${entry.seatNumber} · ${entry.studentName}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-3" data-testid="evaluator-schedule">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={rows.length === 0}
            className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            data-testid="evaluator-schedule-copy"
          >
            {copied ? t("copied") : t("copy")}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent"
            data-testid="evaluator-schedule-print"
          >
            {t("print")}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="evaluator-schedule-empty">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((group) => (
            <section
              key={group.evaluator.id}
              className="grid content-start gap-2 rounded-lg border bg-muted/20 p-3"
              data-testid="evaluator-schedule-group"
            >
              <h4 className="text-sm font-semibold">{group.evaluator.name}</h4>
              <ul className="grid gap-1">
                {group.entries.map((entry, index) => (
                  <li
                    key={`${entry.slotStart}-${entry.seatNumber}-${index}`}
                    className="grid gap-0.5 rounded-md bg-background/70 px-2 py-1.5 text-xs"
                  >
                    <span className="font-medium">
                      {formatSlotTime(entry.slotStart)} · {t("seat")} {entry.seatNumber}
                    </span>
                    <span className="min-w-0 break-words text-muted-foreground">
                      {entry.studentName}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Staff-only seat-by-seat view, including free seats and reassignment. */
export function SeatSchedule({
  periodId,
  slots,
  evaluators,
}: {
  periodId: string;
  slots: BookingSlotOverview[];
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking");

  return (
    <div className="grid gap-2" data-testid="seat-schedule">
      <p className="text-sm text-muted-foreground">{t("seats.hint")}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[42rem] table-auto text-left text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">{t("seats.slot")}</th>
              <th className="px-2 py-2 font-semibold">{t("seats.seat")}</th>
              <th className="px-2 py-2 font-semibold">{t("seats.evaluator")}</th>
              <th className="px-2 py-2 font-semibold">{t("seats.student")}</th>
              <th className="px-2 py-2 font-semibold">{t("staff.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 || slots.every((slot) => slot.seats.length === 0) ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                  {t("seats.empty")}
                </td>
              </tr>
            ) : (
              slots.map((slot) =>
                slot.seats.map((seat) => (
                  <tr key={seat.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-2 font-medium">
                      {formatSlotTime(slot.starts_at)}
                    </td>
                    <td className="px-2 py-2">#{seat.seat_number}</td>
                    <td className="px-2 py-2">
                      <span className="block break-words font-medium">
                        {seat.evaluator_name ?? t("schedule.noEvaluator")}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="block break-words">
                        {seat.student_name ?? (
                          <em className="text-muted-foreground">{t("seats.free")}</em>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {seat.booking_id ? (
                        <div className="flex flex-wrap items-start gap-2">
                          <ReassignForm
                            periodId={periodId}
                            bookingId={seat.booking_id}
                            evaluators={evaluators}
                            compact
                          />
                          <ConfirmDeleteDialogButton
                            label={t("actions.deleteBooking")}
                            confirmMessage={t("confirm.deleteBooking", {
                              student: seat.student_name ?? "?",
                              time: formatSlotTime(slot.starts_at),
                            })}
                            hiddenFields={{ periodId, bookingId: seat.booking_id }}
                            action={deleteBookingAction}
                            testId={`delete-booking-${seat.booking_id.slice(0, 8)}`}
                            buttonClass="inline-flex h-8 items-center rounded-lg border border-destructive/40 bg-background px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
