"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/features/booking/contracts";
import {
  bookSlotAction,
  cancelBookingAction,
  createPeriodAction,
  createSlotAction,
} from "@/features/booking/actions";

type SelectOption = { id: string; label: string };
type SectionOption = SelectOption & { offeringId: string };

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "text-sm font-medium";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

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
