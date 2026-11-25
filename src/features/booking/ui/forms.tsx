"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/features/booking/contracts";
import {
  bookSlotAction,
  bulkReassignEvaluatorAction,
  cancelBookingAction,
  createPeriodAction,
  createSlotAction,
  generateSlotsAction,
  removeEvaluatorAction,
  reassignEvaluatorAction,
  saveEvaluatorsAction,
  switchSlotAction,
  updateSlotCapacityAction,
} from "@/features/booking/actions";
import { planBulkSlots } from "@/features/booking/bulk-slots";
import type { BookingEvaluator } from "@/features/booking/overview";
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
const EMPTY_EVALUATORS: BookingEvaluator[] = [];

function FormError({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("Booking");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-destructive">
      {t(`errors.${state.error}`)}
    </p>
  );
}

/** Non-blocking feedback: the action succeeded but staff should be aware. */
function FormWarning({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("Booking");
  if (!state?.ok || !state.warning) return null;
  return (
    <p role="status" data-testid={testId} className="text-sm text-warning-foreground">
      {t(`warnings.${state.warning}`)}
    </p>
  );
}

type EvaluatorRow = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  contactNote: string;
  position: number;
};

/**
 * TA-authored evaluator roster. Nothing is hardcoded: every name and contact
 * value is typed here and serialized into the hidden `evaluators` JSON field.
 * Existing ids are preserved so booked seats keep their evaluator on save.
 */
export function EvaluatorEditor({ initial = EMPTY_EVALUATORS }: { initial?: BookingEvaluator[] }) {
  const t = useTranslations("Booking");
  const [rows, setRows] = useState<EvaluatorRow[]>(() =>
    [...initial]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email ?? "",
        phone: item.phone ?? "",
        contactNote: item.contact_note ?? "",
        position: item.position,
      })),
  );

  const update = (index: number, patch: Partial<EvaluatorRow>) =>
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );

  const move = (index: number, offset: number) => {
    setRows((previous) => {
      const next = [...previous];
      const target = index + offset;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((row, rowIndex) => ({ ...row, position: rowIndex }));
    });
  };

  const removeRow = (index: number) =>
    setRows((previous) =>
      previous
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, rowIndex) => ({ ...row, position: rowIndex })),
    );

  const addRow = () =>
    setRows((previous) => [
      ...previous,
      { name: "", email: "", phone: "", contactNote: "", position: previous.length },
    ]);

  const json = JSON.stringify(rows.map((row, index) => ({ ...row, position: index })));
  const rowButton =
    "inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";

  return (
    <div className="grid gap-3" data-testid="evaluator-editor">
      <input type="hidden" name="evaluators" value={json} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="evaluators-empty">
          {t("evaluators.empty")}
        </p>
      ) : null}
      <ul className="grid gap-2">
        {rows.map((row, index) => (
          <li
            key={row.id ?? `new-${index}`}
            className="grid gap-2 rounded-lg border bg-muted/20 p-3"
            data-testid={`evaluator-row-${index}`}
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <span className={labelClass}>{t("fields.evaluatorName")}</span>
                <input
                  name={`evaluator-name-${index}`}
                  required
                  maxLength={120}
                  value={row.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder={t("evaluators.namePlaceholder")}
                  className={fieldClass}
                  data-testid={`evaluator-name-${index}`}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={labelClass}>{t("fields.evaluatorEmail")}</span>
                <input
                  type="email"
                  name={`evaluator-email-${index}`}
                  maxLength={254}
                  value={row.email}
                  onChange={(event) => update(index, { email: event.target.value })}
                  className={fieldClass}
                  data-testid={`evaluator-email-${index}`}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={labelClass}>{t("fields.evaluatorPhone")}</span>
                <input
                  name={`evaluator-phone-${index}`}
                  maxLength={60}
                  value={row.phone}
                  onChange={(event) => update(index, { phone: event.target.value })}
                  className={fieldClass}
                  data-testid={`evaluator-phone-${index}`}
                />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className={labelClass}>{t("fields.evaluatorContactNote")}</span>
              <input
                name={`evaluator-note-${index}`}
                maxLength={500}
                value={row.contactNote}
                onChange={(event) => update(index, { contactNote: event.target.value })}
                className={fieldClass}
                data-testid={`evaluator-note-${index}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className={rowButton}
                data-testid={`evaluator-up-${index}`}
                aria-label={t("actions.moveUp")}
              >
                ↑ {t("actions.moveUp")}
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1}
                className={rowButton}
                data-testid={`evaluator-down-${index}`}
                aria-label={t("actions.moveDown")}
              >
                ↓ {t("actions.moveDown")}
              </button>
              <button
                type="button"
                onClick={() => removeRow(index)}
                className={`${rowButton} text-destructive`}
                data-testid={`evaluator-remove-${index}`}
              >
                {t("actions.removeRow")}
              </button>
              <span className="text-xs text-muted-foreground">
                {t("evaluators.count", { count: rows.length })}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addRow}
        className="inline-flex h-9 w-fit items-center rounded-lg border border-primary/40 bg-primary/5 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="evaluator-add"
      >
        {t("actions.addEvaluator")}
      </button>
    </div>
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
      <div className="grid gap-2 border-t pt-3">
        <h3 className="text-base font-semibold">{t("evaluators.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("evaluators.hint")}</p>
        <EvaluatorEditor />
      </div>
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
export function SlotForm({
  periodId,
  evaluatorCount = 0,
}: {
  periodId: string;
  evaluatorCount?: number;
}) {
  const t = useTranslations("Booking");
  const [capacity, setCapacity] = useState("1");
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
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
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
      {evaluatorCount > 0 && Number(capacity) > evaluatorCount ? (
        <p
          role="status"
          className="text-sm text-warning-foreground"
          data-testid="slot-capacity-warning"
        >
          {t("evaluators.capacityWarning", { capacity, count: evaluatorCount })}
        </p>
      ) : null}
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
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => bookSlotAction(formData),
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

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
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => switchSlotAction(formData),
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

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
  evaluatorCount = 0,
}: {
  slotId: string;
  capacity: number;
  booked: number;
  evaluatorCount?: number;
}) {
  const t = useTranslations("Booking");
  const [value, setValue] = useState(String(capacity));
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => updateSlotCapacityAction(formData),
    null,
  );

  return (
    <form
      action={formAction}
      className="grid gap-2"
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
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          data-testid={`capacity-input-${slotId.slice(0, 8)}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
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
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        {state?.ok ? <p className="text-xs text-muted-foreground">{t("capacityUpdated")}</p> : null}
      </div>
      {evaluatorCount > 0 && Number(value) > evaluatorCount ? (
        <p role="status" className="text-xs text-warning-foreground">
          {t("evaluators.capacityWarning", { capacity: value, count: evaluatorCount })}
        </p>
      ) : null}
    </form>
  );
}

type BulkFormState = ActionResult | null;

/**
 * Staff: generate slots across a date range (or per-day slot count) with a
 * live preview ("This will create N slots across D days") listing every
 * planned slot before anything is saved. The RPC re-validates authoritatively.
 */
export function BulkSlotForm({
  periodId,
  evaluatorCount = 0,
}: {
  periodId: string;
  evaluatorCount?: number;
}) {
  const t = useTranslations("Booking.bulk");
  const tEvaluators = useTranslations("Booking.evaluators");
  const [capacity, setCapacity] = useState("1");
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
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
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

      {evaluatorCount > 0 && Number(capacity) > evaluatorCount ? (
        <p
          role="status"
          className="text-sm text-warning-foreground"
          data-testid="bulk-capacity-warning"
        >
          {tEvaluators("capacityWarning", { capacity, count: evaluatorCount })}
        </p>
      ) : null}

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
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => cancelBookingAction(formData),
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

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

/** Staff: edit names/contacts, reorder, add or remove evaluators in one save. */
export function EvaluatorManageForm({
  periodId,
  evaluators,
}: {
  periodId: string;
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => saveEvaluatorsAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid max-w-3xl gap-3" data-testid="evaluator-manage-form">
      <input type="hidden" name="periodId" value={periodId} />
      <p className="text-sm text-muted-foreground">{t("evaluators.hint")}</p>
      <EvaluatorEditor initial={evaluators} />
      <FormError state={state} testId="evaluator-manage-error" />
      {state?.ok ? (
        <p
          role="status"
          className="text-sm text-muted-foreground"
          data-testid="evaluator-manage-success"
        >
          {t("evaluators.saved")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
        data-testid="evaluator-manage-save"
      >
        {pending ? t("saving") : t("actions.saveEvaluators")}
      </button>
    </form>
  );
}

/** Staff: remove an evaluator, optionally moving their bookings in one action. */
export function RemoveEvaluatorForm({
  periodId,
  evaluators,
}: {
  periodId: string;
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => removeEvaluatorAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid max-w-md gap-3" data-testid="remove-evaluator-form">
      <input type="hidden" name="periodId" value={periodId} />
      <p className="text-sm text-muted-foreground">{t("evaluators.removeHint")}</p>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("evaluators.selectEvaluator")}</span>
        <select
          name="evaluatorId"
          required
          value={evaluatorId}
          onChange={(event) => setEvaluatorId(event.target.value)}
          className={fieldClass}
          data-testid="remove-evaluator-select"
        >
          <option value="" disabled>
            {t("selectPlaceholder")}
          </option>
          {evaluators.map((evaluator) => (
            <option key={evaluator.id} value={evaluator.id}>
              {evaluator.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("evaluators.replacement")}</span>
        <select
          name="replacementId"
          value={replacementId}
          onChange={(event) => setReplacementId(event.target.value)}
          className={fieldClass}
          data-testid="remove-evaluator-replacement"
        >
          <option value="">{t("evaluators.none")}</option>
          {evaluators
            .filter((evaluator) => evaluator.id !== evaluatorId)
            .map((evaluator) => (
              <option key={evaluator.id} value={evaluator.id}>
                {evaluator.name}
              </option>
            ))}
        </select>
      </label>
      <FormError state={state} testId="remove-evaluator-error" />
      {state?.ok ? (
        <p
          role="status"
          className="text-sm text-muted-foreground"
          data-testid="remove-evaluator-success"
        >
          {t("evaluators.removed")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || evaluators.length === 0}
        className="inline-flex h-9 w-fit items-center rounded-lg border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        data-testid="remove-evaluator-submit"
      >
        {pending ? t("saving") : t("actions.removeEvaluator")}
      </button>
    </form>
  );
}

/** Staff: reassign one booking; a duplicate in the same slot is only a warning. */
export function ReassignForm({
  periodId,
  bookingId,
  evaluators,
  compact = false,
}: {
  periodId: string;
  bookingId: string;
  evaluators: BookingEvaluator[];
  compact?: boolean;
}) {
  const t = useTranslations("Booking");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => reassignEvaluatorAction(formData),
    null,
  );

  return (
    <form
      action={formAction}
      className={compact ? "grid gap-1" : "grid max-w-md gap-3"}
      data-testid={`reassign-form-${bookingId.slice(0, 8)}`}
    >
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className="grid gap-1">
        {compact ? null : <span className={labelClass}>{t("reassign.selectEvaluator")}</span>}
        <select
          name="evaluatorId"
          required
          value={evaluatorId}
          onChange={(event) => setEvaluatorId(event.target.value)}
          className={
            compact
              ? "h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
              : fieldClass
          }
          data-testid={`reassign-evaluator-${bookingId.slice(0, 8)}`}
        >
          <option value="" disabled>
            {t("selectPlaceholder")}
          </option>
          {evaluators.map((evaluator) => (
            <option key={evaluator.id} value={evaluator.id}>
              {evaluator.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending || evaluators.length === 0}
        className={
          compact
            ? "inline-flex h-8 items-center rounded-lg border border-primary/40 bg-primary/5 px-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            : buttonClass
        }
        data-testid={`reassign-submit-${bookingId.slice(0, 8)}`}
      >
        {pending ? t("saving") : t("actions.reassign")}
      </button>
      <FormError state={state} testId={`reassign-error-${bookingId.slice(0, 8)}`} />
      <FormWarning state={state} testId={`reassign-warning-${bookingId.slice(0, 8)}`} />
      {state?.ok && !state.warning ? (
        <span className="text-xs text-muted-foreground">{t("reassign.success")}</span>
      ) : null}
    </form>
  );
}

/** Staff: bulk move ("B can't come — move B's students to D"). */
export function BulkReassignForm({
  periodId,
  evaluators,
}: {
  periodId: string;
  evaluators: BookingEvaluator[];
}) {
  const t = useTranslations("Booking");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => bulkReassignEvaluatorAction(formData),
    null,
  );

  return (
    <form action={formAction} className="grid max-w-md gap-3" data-testid="bulk-reassign-form">
      <input type="hidden" name="periodId" value={periodId} />
      <p className="text-sm text-muted-foreground">{t("reassign.bulkHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("reassign.from")}</span>
          <select
            name="fromEvaluatorId"
            required
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
            className={fieldClass}
            data-testid="bulk-reassign-from"
          >
            <option value="" disabled>
              {t("selectPlaceholder")}
            </option>
            {evaluators.map((evaluator) => (
              <option key={evaluator.id} value={evaluator.id}>
                {evaluator.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className={labelClass}>{t("reassign.to")}</span>
          <select
            name="toEvaluatorId"
            required
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            className={fieldClass}
            data-testid="bulk-reassign-to"
          >
            <option value="" disabled>
              {t("selectPlaceholder")}
            </option>
            {evaluators
              .filter((evaluator) => evaluator.id !== fromId)
              .map((evaluator) => (
                <option key={evaluator.id} value={evaluator.id}>
                  {evaluator.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <FormError state={state} testId="bulk-reassign-error" />
      <FormWarning state={state} testId="bulk-reassign-warning" />
      {state?.ok && !state.warning ? (
        <p
          role="status"
          className="text-sm text-muted-foreground"
          data-testid="bulk-reassign-success"
        >
          {t("reassign.bulkSuccess")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || evaluators.length < 2}
        className={buttonClass}
        data-testid="bulk-reassign-submit"
      >
        {pending ? t("saving") : t("reassign.bulkSubmit")}
      </button>
    </form>
  );
}
