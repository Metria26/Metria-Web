"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BookingEvaluator } from "@/features/booking/overview";

/**
 * Staff export controls: all evaluators (main workbook + per-evaluator sheets),
 * one evaluator's file, or a ZIP of one file per evaluator.
 */
export function ExportControls({
  periodId,
  evaluators,
  compact = false,
  mainTestId = "export-bookings-csv",
}: {
  periodId: string;
  evaluators: BookingEvaluator[];
  compact?: boolean;
  mainTestId?: string;
}) {
  const t = useTranslations("Booking.export");
  const [selected, setSelected] = useState("");
  const base = `/api/bookings/${periodId}/export`;
  const downloadHref = selected ? `${base}?evaluator=${encodeURIComponent(selected)}` : base;
  const controlClass = compact
    ? "h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
    : "h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
  const linkClass = compact
    ? "inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    : "inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="booking-export-controls">
      <label className="grid gap-1 text-xs font-medium">
        {t("evaluator")}
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className={controlClass}
          data-testid="export-evaluator-select"
        >
          <option value="">{t("all")}</option>
          {evaluators.map((evaluator) => (
            <option key={evaluator.id} value={evaluator.id}>
              {evaluator.name}
            </option>
          ))}
        </select>
      </label>
      <a href={downloadHref} download className={linkClass} data-testid={mainTestId}>
        {t("download")}
      </a>
      <a href={`${base}?zip=1`} download className={linkClass} data-testid="export-bookings-zip">
        {t("zip")}
      </a>
    </div>
  );
}
