"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/features/booking/contracts";
import {
  bookSlotAction,
  cancelBookingAction,
  createPeriodAction,
  createSlotAction,
  generateSlotsAction,
  switchSlotAction,
  updateSlotCapacityAction,
} from "@/features/booking/actions";
import { planBulkSlots } from "@/features/booking/bulk-slots";
import { formatSlotTime } from "@/lib/time-format";

type SelectOption = { id: string; label: string };
type SectionOption = SelectOption & { offeringId: string };

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "text-sm font-medium";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const wFullButton =
  "inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function FormError({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("Booking");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-destructive">
      {t(`errors.${state.error}`)}
    </p>
  );
}

/** Staff: create an evaluation period for one of their sections. */
export function PeriodForm({
  offerings,
  sections,
}: {
  offerings: SelectOption[];
  sections: SectionOption[];
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createPeriodAction(formData),
    null,
  );
  const [offeringId, setOfferingId] = useState("");
  const sectionOptions = sections.filter((section) => section.offeringId === offeringId);

  return (
    <form action={formAction} data-testid="period-form" className="grid max-w-md gap-3">
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.offering")}</span>
        <select
          name="offeringId"
          required
          value={offeringId}
          onChange={(event) => setOfferingId(event.target.value)}
          className={fieldClass}
          data-testid="period-offering"
        >
          <option value="" disabled>
            {t("selectPlaceholder")}
          </option>
          {offerings.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.section")}</span>
        <select
          name="sectionId"
          required
          disabled={offeringId.length === 0}
          defaultValue=""
          className={fieldClass}
          data-testid="period-section"
        >
          <option value="" disabled>
            {t("selectPlaceholder")}
          </option>
          {sectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.periodTitle")}</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={120}
          className={fieldClass}
          data-testid="period-title"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.startsAt")}</span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            className={fieldClass}
            data-testid="period-starts"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.endsAt")}</span>
          <input
            type="datetime-local"
            name="endsAt"
            required
            className={fieldClass}
            data-testid="period-ends"
          />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.cutoffHours")}</span>
        <input
          type="number"
          name="cutoffHours"
          min={0}
          max={168}
          defaultValue={6}
          required
          className={fieldClass}
          data-testid="period-cutoff"
        />
      </label>
      <FormError state={state} testId="period-form-error" />
      {state?.ok ? (
        <p className="text-sm text-muted-foreground" data-testid="period-success">
          {t("periodCreated")}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClass} data-testid="period-submit">
        {pending ? t("saving") : t("actions.savePeriod")}
      </button>
    </form>
  );
}

/** Staff: add a slot with capacity to a period. */
export function SlotForm({ periodId }: { periodId: string }) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createSlotAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="slot-form" className="grid max-w-md gap-3">
      <input type="hidden" name="periodId" value={periodId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.startsAt")}</span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            className={fieldClass}
            data-testid="slot-starts"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.endsAt")}</span>
          <input
            type="datetime-local"
            name="endsAt"
            required
            className={fieldClass}
            data-testid="slot-ends"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.capacity")}</span>
          <input
            type="number"
            name="capacity"
            min={1}
            max={500}
            required
            className={fieldClass}
            data-testid="slot-capacity"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.location")}</span>
          <input
            name="location"
            maxLength={120}
            className={fieldClass}
            data-testid="slot-location"
          />
        </label>
      </div>
      <FormError state={state} testId="slot-form-error" />
      {state?.ok ? (
        <p className="text-sm text-muted-foreground" data-testid="slot-success">
          {t("slotCreated")}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClass} data-testid="slot-submit">
        {pending ? t("saving") : t("actions.saveSlot")}
      </button>
    </form>
  );
}

/** Student: book a slot through the atomic RPC. */
export function BookButton({
  periodId,
  slotId,
  disabled = false,
}: {
  periodId: string;
  slotId: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => bookSlotAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="slotId" value={slotId} />
      <FormError state={state} testId="book-slot-error" />
      <button
        type="submit"
        disabled={pending || disabled}
        className={buttonClass}
        data-testid="book-slot"
      >
        {pending ? t("saving") : t("actions.book")}
      </button>
    </form>
  );
}

/**
 * Student: move their active booking in this period to another free slot in
 * one atomic RPC (old booking cancels only when the new one commits).
 */
export function SwitchButton({
  periodId,
  slotId,
  disabled = false,
}: {
  periodId: string;
  slotId: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => switchSlotAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="targetSlotId" value={slotId} />
      <FormError state={state} testId={`switch-slot-error-${slotId.slice(0, 8)}`} />
      <button
        type="submit"
        disabled={pending || disabled}
        className="inline-flex h-9 items-center rounded-lg border border-primary/50 bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        data-testid={`switch-slot-${slotId}`}
      >
        {pending ? t("saving") : t("actions.switchHere")}
      </button>
    </form>
  );
}

/** Staff: edit one slot's capacity (the RPC refuses cutting below bookings). */
export function CapacityForm({
  slotId,
  capacity,
  booked,
}: {
  slotId: string;
  capacity: number;
  booked: number;
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => updateSlotCapacityAction(formData),
    null,
  );

  return (
    <form
      action={formAction}
      className="flex items-center gap-2"
      data-testid={`capacity-form-${slotId.slice(0, 8)}`}
    >
      <input type="hidden" name="slotId" value={slotId} />
      <label className="grid gap-1">
        <span className="sr-only">{t("fields.capacity")}</span>
        <input
          type="number"
          name="capacity"
          min={booked > 0 ? booked : 1}
          max={500}
          defaultValue={capacity}
          required
          className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          data-testid={`capacity-input-${slotId.slice(0, 8)}`}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        data-testid={`capacity-save-${slotId.slice(0, 8)}`}
      >
        {pending ? t("saving") : t("actions.saveCapacity")}
      </button>
      {state && !state.ok ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid={`capacity-error-${slotId.slice(0, 8)}`}
        >
          {state.error === "capacityBelowBookings"
            ? t("errors.capacityBelowBookings")
            : t("errors.genericAction")}
        </p>
      ) : null}
      {state?.ok ? <p className="text-xs text-muted-foreground">{t("capacityUpdated")}</p> : null}
    </form>
  );
}

type BulkFormState = ActionResult | null;

/**
 * Staff: generate slots across a date range (or per-day slot count) with a
 * live preview ("This will create N slots across D days") listing every
 * planned slot before anything is saved. The RPC re-validates authoritatively.
 */
export function BulkSlotForm({ periodId }: { periodId: string }) {
  const t = useTranslations("Booking.bulk");
  const [state, formAction, pending] = useActionState<BulkFormState, FormData>(
    async (_prev, formData) => generateSlotsAction(formData),
    null,
  );
  const [dailyEnd, setDailyEnd] = useState("");
  const [slotsPerDay, setSlotsPerDay] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dailyStart, setDailyStart] = useState("09:00");
  const [slotMinutes, setSlotMinutes] = useState("30");
  const [gapMinutes, setGapMinutes] = useState("0");

  const preview = useMemo(() => {
    if (!fromDate || !toDate) return null;
    const plan = planBulkSlots({
      fromDate,
      toDate,
      dailyStart,
      dailyEnd: dailyEnd.length >= 4 ? dailyEnd : undefined,
      slotsPerDay: slotsPerDay.length > 0 ? Number.parseInt(slotsPerDay, 10) : undefined,
      slotMinutes: Number.parseInt(slotMinutes, 10) || 30,
      gapMinutes: Number.parseInt(gapMinutes, 10) || 0,
    });
    return plan;
  }, [fromDate, toDate, dailyStart, dailyEnd, slotsPerDay, slotMinutes, gapMinutes]);

  return (
    <form action={formAction} data-testid="bulk-slot-form" className="grid max-w-2xl gap-3">
      <input type="hidden" name="periodId" value={periodId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.fromDate")}</span>
          <input
            type="date"
            name="fromDate"
            required
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className={fieldClass}
            data-testid="bulk-from-date"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.toDate")}</span>
          <input
            type="date"
            name="toDate"
            required
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className={fieldClass}
            data-testid="bulk-to-date"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.dailyStart")}</span>
          <input
            type="time"
            name="dailyStart"
            required
            value={dailyStart}
            onChange={(event) => setDailyStart(event.target.value)}
            className={fieldClass}
            data-testid="bulk-daily-start"
          />
        </label>
        {/* Alternative input mode: EITHER daily end time OR slots per day. */}
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.dailyEnd")}</span>
          <input
            type="time"
            name="dailyEnd"
            value={dailyEnd}
            onChange={(event) => {
              setDailyEnd(event.target.value);
              if (event.target.value) setSlotsPerDay("");
            }}
            className={fieldClass}
            data-testid="bulk-daily-end"
          />
        </label>
      </div>
      <p className="text-xs font-medium text-muted-foreground">{t("altCountHint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.slotsPerDay")}</span>
          <input
            type="number"
            name="slotsPerDay"
            min={1}
            max={200}
            value={slotsPerDay}
            onChange={(event) => {
              setSlotsPerDay(event.target.value);
              if (event.target.value) setDailyEnd("");
            }}
            className={fieldClass}
            data-testid="bulk-slots-per-day"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.slotMinutes")}</span>
          <input
            type="number"
            name="slotMinutes"
            min={1}
            max={480}
            required
            value={slotMinutes}
            onChange={(event) => setSlotMinutes(event.target.value)}
            className={fieldClass}
            data-testid="bulk-slot-minutes"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.gapMinutes")}</span>
          <input
            type="number"
            name="gapMinutes"
            min={0}
            max={240}
            value={gapMinutes}
            onChange={(event) => setGapMinutes(event.target.value)}
            className={fieldClass}
            data-testid="bulk-gap-minutes"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.capacity")}</span>
          <input
            type="number"
            name="capacity"
            min={1}
            max={500}
            required
            defaultValue={1}
            className={fieldClass}
            data-testid="bulk-capacity"
          />
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("fields.location")}</span>
          <input
            name="location"
            maxLength={120}
            className={fieldClass}
            data-testid="bulk-location"
          />
        </label>
      </div>

      {/* Live preview: exact schedule the RPC will create. */}
      <div className="grid gap-2 rounded-lg border bg-muted/30 p-3" data-testid="bulk-preview">
        {preview == null ? (
          <p className="text-xs text-muted-foreground">{t("previewIdle")}</p>
        ) : !preview.ok ? (
          <p className="text-xs text-destructive" role="alert" data-testid="bulk-preview-error">
            {t(`planErrors.${preview.error}`)}
          </p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm font-medium" data-testid="bulk-preview-summary">
              {t("previewSummary", { total: preview.total, days: preview.days.length })}
            </p>
            <ul className="grid max-h-56 gap-1 overflow-y-auto text-xs text-muted-foreground">
              {preview.slots.map((slot, index) => (
                <li key={index} className="whitespace-nowrap">
                  {formatSlotTime(slot.startsAt)} – {formatSlotTime(slot.endsAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <FormError state={state} testId="bulk-slot-form-error" />
      {state?.ok ? (
        <p className="text-sm text-muted-foreground" data-testid="bulk-slot-success">
          {t("created")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={wFullButton}
        data-testid="bulk-slot-submit"
      >
        {pending ? t("saving") : t("submit")}
      </button>
    </form>
  );
}

/** Student: cancel their booking while the cutoff allows it. */
export function CancelButton({
  bookingId,
  periodId,
  disabled = false,
  closedReason,
}: {
  bookingId: string;
  periodId: string;
  disabled?: boolean;
  closedReason?: "cutoff" | "ended";
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => cancelBookingAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="periodId" value={periodId} />
      <FormError state={state} testId="cancel-booking-error" />
      <button
        type="submit"
        disabled={pending || disabled}
        className={buttonClass}
        data-testid="cancel-booking"
      >
        {pending ? t("saving") : t("actions.cancel")}
      </button>
      {disabled && closedReason ? (
        <p className="text-xs text-muted-foreground" data-testid="cancel-closed">
          {t(closedReason === "cutoff" ? "cancelClosedCutoff" : "cancelClosedEnded")}
        </p>
      ) : null}
    </form>
  );
}
