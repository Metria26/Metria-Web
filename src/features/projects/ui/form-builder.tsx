"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addFieldAction,
  deleteFieldAction,
  reorderFieldsAction,
  toggleFieldAction,
  updateFieldAction,
} from "../actions";
import { FIELD_TYPES, type ActionResult } from "../contracts";

export type FieldRow = {
  id: string;
  position: number;
  label: string;
  description: string;
  field_type: string;
  required: boolean;
  placeholder: string;
  options: string[];
  is_system: boolean;
  enabled: boolean;
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const chipClass =
  "inline-flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function ErrorText({ result }: { result: ActionResult | null }) {
  const t = useTranslations("Projects.errors");
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="text-xs text-destructive" data-testid="form-builder-error">
      {t(result.error)}
    </p>
  );
}

/**
 * Dynamic submission form builder (prompt 2): reorder, enable/disable,
 * required toggle, edit and delete custom fields — with a live student
 * preview. The four default system fields cannot be deleted.
 */
export function FormBuilder({ dashboardId, fields }: { dashboardId: string; fields: FieldRow[] }) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const outcome = await fn();
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  const move = (field: FieldRow, direction: -1 | 1) => {
    const ordered = [...fields].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((row) => row.id === field.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const swapped = [...ordered];
    const moved = swapped.splice(index, 1)[0]!;
    swapped.splice(target, 0, moved);
    const order = swapped.map((row) => row.id);
    run(() => {
      const formData = new FormData();
      formData.set("dashboardId", dashboardId);
      formData.set("order", JSON.stringify(order));
      return reorderFieldsAction(formData);
    });
  };

  const toggle = (fieldId: string, patch: { enabled?: boolean; required?: boolean }) => {
    run(() => {
      const formData = new FormData();
      formData.set("fieldId", fieldId);
      formData.set("dashboardId", dashboardId);
      if (patch.enabled !== undefined) formData.set("enabled", String(patch.enabled));
      if (patch.required !== undefined) formData.set("required", String(patch.required));
      return toggleFieldAction(formData);
    });
  };

  return (
    <div className="grid gap-6" data-testid="form-builder">
      <div className="grid gap-3">
        {[...fields]
          .sort((a, b) => a.position - b.position)
          .map((field, index, ordered) => (
            <div
              key={field.id}
              className="rounded-xl border p-4"
              data-testid={`field-row-${field.field_type}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold"
                    data-testid={`field-label-${field.id}`}
                  >
                    {field.label}
                    {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                    {field.is_system ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("builder.system")}
                      </span>
                    ) : null}
                    {!field.enabled ? (
                      <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning-foreground">
                        {t("builder.disabled")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`builder.types.${field.field_type}`)}
                    {field.options.length > 0 ? ` — ${field.options.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending || index === 0}
                    onClick={() => move(field, -1)}
                    aria-label={t("builder.moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending || index === ordered.length - 1}
                    onClick={() => move(field, 1)}
                    aria-label={t("builder.moveDown")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending}
                    onClick={() => toggle(field.id, { enabled: !field.enabled })}
                  >
                    {field.enabled ? t("builder.disable") : t("builder.enable")}
                  </button>
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending}
                    onClick={() => toggle(field.id, { required: !field.required })}
                  >
                    {field.required ? t("builder.unrequire") : t("builder.makeRequired")}
                  </button>
                  <button
                    type="button"
                    className={chipClass}
                    disabled={pending}
                    onClick={() => setEditingId(editingId === field.id ? null : field.id)}
                  >
                    {t("builder.edit")}
                  </button>
                  {!field.is_system ? (
                    <button
                      type="button"
                      className={`${chipClass} text-destructive`}
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(t("builder.deleteConfirm"))) return;
                        run(() => {
                          const formData = new FormData();
                          formData.set("fieldId", field.id);
                          formData.set("dashboardId", dashboardId);
                          return deleteFieldAction(formData);
                        });
                      }}
                    >
                      {t("builder.delete")}
                    </button>
                  ) : null}
                </div>
              </div>

              {editingId === field.id ? (
                <EditFieldForm
                  key={`edit-${field.id}`}
                  dashboardId={dashboardId}
                  field={field}
                  onDone={() => setEditingId(null)}
                  run={run}
                  pending={pending}
                />
              ) : null}
            </div>
          ))}
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("builder.addField")}</h3>
          <button
            type="button"
            className={buttonClass}
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? t("builder.cancel") : t("builder.addField")}
          </button>
        </div>
        {adding ? (
          <AddFieldForm
            dashboardId={dashboardId}
            onDone={() => setAdding(false)}
            run={run}
            pending={pending}
          />
        ) : null}
      </div>

      <ErrorText result={result} />

      <div className="rounded-xl border bg-muted/30 p-4">
        <h3 className="text-sm font-semibold">{t("builder.preview")}</h3>
        <div className="mt-3 grid gap-4" data-testid="form-preview">
          {[...fields]
            .filter((field) => field.enabled)
            .sort((a, b) => a.position - b.position)
            .map((field) => (
              <label key={field.id} className="grid gap-1.5">
                <span className="text-sm font-medium">
                  {field.label}
                  {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                </span>
                {field.description ? (
                  <span className="text-xs text-muted-foreground">{field.description}</span>
                ) : null}
                {field.field_type === "long_text" ? (
                  <textarea
                    rows={3}
                    disabled
                    placeholder={field.placeholder}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  />
                ) : field.field_type === "select" ? (
                  <select disabled className={inputClass} defaultValue="">
                    <option value="">{t("selectPlaceholder")}</option>
                    {field.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.field_type === "number" ? "number" : "text"}
                    disabled
                    placeholder={field.placeholder}
                    className={inputClass}
                  />
                )}
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}

function AddFieldForm({
  dashboardId,
  onDone,
  run,
  pending,
}: {
  dashboardId: string;
  onDone: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
}) {
  const t = useTranslations("Projects");
  const [fieldType, setFieldType] = useState<string>("short_text");

  return (
    <form
      className="grid gap-3 rounded-xl border p-4"
      data-testid="add-field-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("dashboardId", dashboardId);
        run(async () => {
          const outcome = await addFieldAction(formData);
          if (outcome.ok) onDone();
          return outcome;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.label")}</span>
          <input
            name="label"
            required
            maxLength={120}
            className={inputClass}
            data-testid="add-field-label"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.type")}</span>
          <select
            name="fieldType"
            className={inputClass}
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value)}
            data-testid="add-field-type"
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`builder.types.${type}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("builder.description")}</span>
        <input name="description" maxLength={500} className={inputClass} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("builder.placeholder")}</span>
        <input name="placeholder" maxLength={120} className={inputClass} />
      </label>
      {fieldType === "select" ? (
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.options")}</span>
          <input
            name="options"
            data-testid="add-field-options"
            placeholder={t("builder.optionsHint")}
            className={inputClass}
          />
        </label>
      ) : (
        <input type="hidden" name="options" value="[]" />
      )}
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" />
        {t("builder.makeRequired")}
      </label>
      <div>
        <button type="submit" className={buttonClass} disabled={pending}>
          {t("builder.addField")}
        </button>
      </div>
    </form>
  );
}

function EditFieldForm({
  dashboardId,
  field,
  onDone,
  run,
  pending,
}: {
  dashboardId: string;
  field: FieldRow;
  onDone: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
}) {
  const t = useTranslations("Projects");
  const [fieldType, setFieldType] = useState(field.field_type);

  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border bg-muted/20 p-4"
      data-testid="edit-field-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("dashboardId", dashboardId);
        formData.set("fieldId", field.id);
        run(async () => {
          const outcome = await updateFieldAction(formData);
          if (outcome.ok) onDone();
          return outcome;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.label")}</span>
          <input
            name="label"
            required
            maxLength={120}
            defaultValue={field.label}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.type")}</span>
          <select
            name="fieldType"
            className={inputClass}
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value)}
            disabled={field.is_system}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`builder.types.${type}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("builder.description")}</span>
        <input
          name="description"
          maxLength={500}
          defaultValue={field.description}
          className={inputClass}
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{t("builder.placeholder")}</span>
        <input
          name="placeholder"
          maxLength={120}
          defaultValue={field.placeholder}
          className={inputClass}
        />
      </label>
      {fieldType === "select" ? (
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("builder.options")}</span>
          <input
            name="options"
            defaultValue={field.options.join(", ")}
            placeholder={t("builder.optionsHint")}
            className={inputClass}
          />
        </label>
      ) : (
        <input type="hidden" name="options" value="[]" />
      )}
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" defaultChecked={field.required} />
        {t("builder.makeRequired")}
      </label>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={pending}>
          {t("saveChanges")}
        </button>
        <button type="button" className={chipClass} onClick={onDone}>
          {t("builder.cancel")}
        </button>
      </div>
    </form>
  );
}
