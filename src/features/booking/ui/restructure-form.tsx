"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { applySlotRestructureAction, undoSlotRestructureAction } from "@/features/booking/actions";
import type { ActionResult } from "@/features/booking/contracts";
import {
  previewRestructure,
  restructureRpcPayload,
  type RestructureData,
  type RestructureDayInput,
} from "@/features/booking/restructure";

const fieldClass =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const outlineButtonClass =
  "inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function ActionError({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("Booking");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid={testId} className="grid gap-1 text-sm text-destructive">
      <span>{t(`errors.${state.error}`)}</span>
      {state.detail ? (
        <span className="text-xs font-mono opacity-80" data-testid={`${testId}-detail`}>
          {state.detail}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Admin-only preview/apply surface. The preview is pure; only the confirmed
 * submit sends the reviewed plan to the transactional SQL RPC.
 */
export function RestructureForm({
  data,
  defaultDays,
}: {
  data: RestructureData;
  defaultDays: RestructureDayInput[];
}) {
  const t = useTranslations("Booking.restructure");
  const tBooking = useTranslations("Booking");
  const formRef = useRef<HTMLFormElement>(null);
  const [slotMinutes, setSlotMinutes] = useState(data.period.slotMinutes || 15);
  const [capacity, setCapacity] = useState(data.period.capacity || 4);
  const [keepEvaluator, setKeepEvaluator] = useState(true);
  const [fillAfterLast, setFillAfterLast] = useState(true);
  const [days, setDays] = useState<RestructureDayInput[]>(defaultDays);
  const [applyState, applyAction, applyPending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => applySlotRestructureAction(formData),
    null,
  );
  const [undoState, undoAction, undoPending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => undoSlotRestructureAction(formData),
    null,
  );

  const options = useMemo(
    () => ({ slotMinutes, capacity, keepEvaluator, fillAfterLast, days }),
    [slotMinutes, capacity, keepEvaluator, fillAfterLast, days],
  );
  const preview = useMemo(() => previewRestructure(data, options), [data, options]);
  const payload = useMemo(() => restructureRpcPayload(preview, options), [preview, options]);

  const patchDay = (index: number, patch: Partial<RestructureDayInput>) =>
    setDays((previous) =>
      previous.map((day, dayIndex) => (dayIndex === index ? { ...day, ...patch } : day)),
    );

  return (
    <div className="grid gap-6">
      <form
        ref={formRef}
        action={applyAction}
        className="grid gap-6"
        data-testid="restructure-form"
      >
        <input type="hidden" name="periodId" value={data.period.id} />
        <input type="hidden" name="slotMinutes" value={slotMinutes} />
        <input type="hidden" name="capacity" value={capacity} />
        <input type="hidden" name="keepEvaluator" value={String(keepEvaluator)} />
        <input type="hidden" name="fillAfterLast" value={String(fillAfterLast)} />
        <input type="hidden" name="days" value={JSON.stringify(payload.days)} />
        <input type="hidden" name="plan" value={JSON.stringify(payload.plan)} />

        <section className="rounded-2xl border border-white/20 bg-card/75 p-5 shadow-sm backdrop-blur-md">
          <h2 className="mb-4 text-lg font-semibold">{t("settings")}</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1 text-sm font-medium">
              {t("duration")}
              <input
                type="number"
                min={1}
                max={240}
                className={fieldClass}
                value={slotMinutes}
                onChange={(event) => setSlotMinutes(Number(event.target.value))}
                data-testid="restructure-duration"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t("capacity")}
              <input
                type="number"
                min={1}
                max={500}
                className={fieldClass}
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
                data-testid="restructure-capacity"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="evaluator-mode"
                checked={keepEvaluator}
                onChange={() => setKeepEvaluator(true)}
              />
              {t("keepEvaluator")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="evaluator-mode"
                checked={!keepEvaluator}
                onChange={() => setKeepEvaluator(false)}
              />
              {t("rebalance")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fillAfterLast}
                onChange={(event) => setFillAfterLast(event.target.checked)}
              />
              {t("fillAfterLast")}
            </label>
          </div>
        </section>

        <section className="grid gap-4">
          {days.map((day, index) => {
            const dayPreview = preview.days.find((item) => item.input.key === day.key);
            return (
              <div
                key={day.key}
                className="rounded-2xl border border-white/20 bg-card/75 p-5 shadow-sm backdrop-blur-md"
              >
                <div className="mb-4 flex flex-wrap items-end gap-4">
                  <span className="text-sm font-semibold">{day.key}</span>
                  <label className="grid gap-1 text-xs font-medium">
                    {t("dayStart")}
                    <input
                      type="time"
                      className={fieldClass}
                      value={day.start}
                      onChange={(event) => patchDay(index, { start: event.target.value })}
                      data-testid={`restructure-start-${day.key}`}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">
                    {t("dayEnd")}
                    <input
                      type="time"
                      className={fieldClass}
                      value={day.end}
                      onChange={(event) => patchDay(index, { end: event.target.value })}
                      data-testid={`restructure-end-${day.key}`}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">
                    {t("breakStart")}
                    <input
                      type="time"
                      className={fieldClass}
                      value={day.breakStart ?? ""}
                      onChange={(event) =>
                        patchDay(index, { breakStart: event.target.value || null })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">
                    {t("breakEnd")}
                    <input
                      type="time"
                      className={fieldClass}
                      value={day.breakEnd ?? ""}
                      onChange={(event) =>
                        patchDay(index, { breakEnd: event.target.value || null })
                      }
                    />
                  </label>
                  <span className="ml-auto grid gap-0.5 text-xs text-muted-foreground">
                    <span>
                      {t("slotCount", {
                        slots: dayPreview?.newSlots.length ?? 0,
                        students: dayPreview?.rows.length ?? 0,
                      })}
                    </span>
                    {dayPreview?.emptySlots ? (
                      <span data-testid={`restructure-empty-slots-${day.key}`}>
                        {t("emptySlots", { count: dayPreview.emptySlots })}
                      </span>
                    ) : null}
                  </span>
                </div>

                {dayPreview?.error ? (
                  <p
                    role="alert"
                    className="mb-3 text-sm text-destructive"
                    data-testid={`restructure-error-${day.key}`}
                  >
                    {dayPreview.error}
                  </p>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid={`restructure-preview-${day.key}`}>
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-2">{t("student")}</th>
                        <th className="p-2">{t("rollNo")}</th>
                        <th className="p-2">{t("oldSlot")}</th>
                        <th className="p-2">{t("oldSeat")}</th>
                        <th className="p-2">{t("newSlot")}</th>
                        <th className="p-2">{t("newSeat")}</th>
                        <th className="p-2">{t("evaluator")}</th>
                        <th className="p-2">{t("changed")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dayPreview?.rows ?? []).map((row) => (
                        <tr
                          key={row.bookingId}
                          className={`border-b last:border-0 ${row.timeChanged ? "bg-warning/10" : ""}`}
                        >
                          <td className="p-2">{row.studentName}</td>
                          <td className="p-2">{row.rollNo ?? "—"}</td>
                          <td className="p-2">{row.oldSlotLabel}</td>
                          <td className="p-2">{row.oldSeat ?? "—"}</td>
                          <td className="p-2 font-medium">{row.newSlotLabel}</td>
                          <td className="p-2">{row.newSeat}</td>
                          <td className="p-2">{row.evaluatorName ?? "—"}</td>
                          <td className="p-2">{row.timeChanged ? t("yes") : t("no")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background/60 p-4">
          <span className="text-sm">{t("slotsBefore", { count: preview.slotsBefore })}</span>
          <span className="text-sm font-semibold">
            {t("slotsAfter", { count: preview.slotsAfter })}
          </span>
          <span className="text-sm">{t("studentsMoved", { count: preview.studentsMoved })}</span>
          <span className="text-sm text-muted-foreground">
            {t("changeBreakdown", {
              time: preview.timeChangedCount,
              seat: preview.seatChangedCount,
            })}
          </span>
          <ActionError state={applyState} testId="restructure-apply-error" />
          <Dialog>
            <DialogTrigger
              type="button"
              className={buttonClass}
              disabled={!preview.canApply || applyPending}
              data-testid="restructure-apply"
            >
              {t("apply")}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("confirmTitle")}</DialogTitle>
                <DialogDescription>{t("confirmBody")}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose type="button" className={outlineButtonClass}>
                  {t("cancel")}
                </DialogClose>
                <DialogClose
                  type="button"
                  className={buttonClass}
                  disabled={applyPending}
                  onClick={() => formRef.current?.requestSubmit()}
                  data-testid="restructure-confirm"
                >
                  {t("confirm")}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </form>

      <form
        action={undoAction}
        className="flex flex-wrap items-center gap-3"
        data-testid="restructure-undo-form"
      >
        <input type="hidden" name="periodId" value={data.period.id} />
        <button
          type="submit"
          className={outlineButtonClass}
          disabled={undoPending}
          data-testid="restructure-undo"
        >
          {t("undo")}
        </button>
        <ActionError state={undoState} testId="restructure-undo-error" />
        {undoState?.ok ? (
          <p role="status" className="text-sm text-success-foreground">
            {tBooking("capacityUpdated")}
          </p>
        ) : null}
      </form>
    </div>
  );
}
