"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { assessmentInputSchema, type ActionResult } from "@/features/academics/contracts";
import {
  createAssessmentAction,
  createCourseAction,
  createOfferingAction,
  createSectionAction,
  enrollStudentAction,
} from "@/features/academics/actions";

type SelectOption = { id: string; label: string };

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "text-sm font-medium";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function FormError({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("Offerings");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-destructive">
      {t(`errors.${state.error}`)}
    </p>
  );
}

function SelectField({
  name,
  label,
  options,
  required = true,
  testId,
}: {
  name: string;
  label: string;
  options: SelectOption[];
  required?: boolean;
  testId?: string;
}) {
  const t = useTranslations("Offerings");
  return (
    <label className="grid gap-1.5">
      <span className={labelClass}>{label}</span>
      <select
        name={name}
        required={required}
        defaultValue=""
        className={fieldClass}
        data-testid={testId}
      >
        <option value="" disabled>
          {t("selectPlaceholder")}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CourseForm({ departments }: { departments: SelectOption[] }) {
  const t = useTranslations("Offerings");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createCourseAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="course-form" className="grid max-w-md gap-3">
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.code")}</span>
        <input
          name="code"
          required
          maxLength={20}
          pattern="[A-Za-z0-9-]+"
          className={fieldClass}
          data-testid="course-code"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.title")}</span>
        <input
          name="title"
          required
          maxLength={120}
          className={fieldClass}
          data-testid="course-title"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.description")}</span>
        <textarea name="description" maxLength={1000} rows={2} className={fieldClass} />
      </label>
      {departments.length > 0 ? (
        <SelectField
          name="departmentId"
          label={t("fields.department")}
          options={departments}
          required={false}
        />
      ) : null}
      <FormError state={state} testId="course-form-error" />
      <button type="submit" disabled={pending} className={buttonClass} data-testid="course-submit">
        {pending ? t("saving") : t("actions.saveCourse")}
      </button>
    </form>
  );
}

export function OfferingForm({
  courses,
  terms,
}: {
  courses: SelectOption[];
  terms: SelectOption[];
}) {
  const t = useTranslations("Offerings");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createOfferingAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="offering-form" className="grid max-w-md gap-3">
      <SelectField
        name="courseId"
        label={t("fields.course")}
        options={courses}
        testId="offering-course"
      />
      <SelectField name="termId" label={t("fields.term")} options={terms} testId="offering-term" />
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.offeringCode")}</span>
        <input
          name="offeringCode"
          required
          maxLength={30}
          pattern="[A-Za-z0-9-]+"
          className={fieldClass}
          data-testid="offering-code"
        />
      </label>
      <FormError state={state} testId="offering-form-error" />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
        data-testid="offering-submit"
      >
        {pending ? t("saving") : t("actions.saveOffering")}
      </button>
    </form>
  );
}

export function SectionForm({ offeringId }: { offeringId: string }) {
  const t = useTranslations("Offerings");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createSectionAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="section-form" className="grid max-w-md gap-3">
      <input type="hidden" name="offeringId" value={offeringId} />
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.sectionCode")}</span>
        <input
          name="sectionCode"
          required
          maxLength={10}
          pattern="[A-Za-z0-9-]+"
          className={fieldClass}
          data-testid="section-code"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.capacity")}</span>
        <input
          name="capacity"
          type="number"
          min={1}
          max={1000}
          className={fieldClass}
          data-testid="section-capacity"
        />
      </label>
      <FormError state={state} testId="section-form-error" />
      <button type="submit" disabled={pending} className={buttonClass} data-testid="section-submit">
        {pending ? t("saving") : t("actions.saveSection")}
      </button>
    </form>
  );
}

export function AssessmentForm({
  offeringId,
  sections,
}: {
  offeringId: string;
  sections: SelectOption[];
}) {
  const t = useTranslations("Offerings");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createAssessmentAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="assessment-form" className="grid max-w-md gap-3">
      <input type="hidden" name="offeringId" value={offeringId} />
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.title")}</span>
        <input
          name="title"
          required
          maxLength={120}
          className={fieldClass}
          data-testid="assessment-title"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.assessmentType")}</span>
        <select
          name="assessmentType"
          required
          defaultValue="quiz"
          className={fieldClass}
          data-testid="assessment-type"
        >
          {assessmentInputSchema.shape.assessmentType.options.map((value) => (
            <option key={value} value={value}>
              {t(`assessmentTypes.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.total")}</span>
        <input
          name="total"
          type="number"
          min={0.01}
          step="0.01"
          required
          className={fieldClass}
          data-testid="assessment-total"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.weight")}</span>
        <input
          name="weight"
          type="number"
          min={0}
          max={100}
          step="0.0001"
          required
          className={fieldClass}
          data-testid="assessment-weight"
        />
      </label>
      {sections.length > 0 ? (
        <SelectField
          name="sectionId"
          label={t("fields.section")}
          options={sections}
          required={false}
        />
      ) : null}
      <FormError state={state} testId="assessment-form-error" />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
        data-testid="assessment-submit"
      >
        {pending ? t("saving") : t("actions.saveAssessment")}
      </button>
    </form>
  );
}

export function EnrollmentForm({ sections }: { sections: SelectOption[] }) {
  const t = useTranslations("Offerings");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => enrollStudentAction(formData),
    null,
  );

  return (
    <form action={formAction} data-testid="enrollment-form" className="grid max-w-md gap-3">
      <SelectField
        name="sectionId"
        label={t("fields.section")}
        options={sections}
        testId="enrollment-section"
      />
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("fields.studentEmail")}</span>
        <input
          name="studentEmail"
          type="email"
          required
          maxLength={254}
          className={fieldClass}
          data-testid="enrollment-email"
        />
      </label>
      <FormError state={state} testId="enrollment-form-error" />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
        data-testid="enrollment-submit"
      >
        {pending ? t("saving") : t("actions.enrollStudent")}
      </button>
    </form>
  );
}
