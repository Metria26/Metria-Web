"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ActionResult } from "@/features/booking/contracts";

/**
 * Destructive confirmation dialog (registry delta 2026-11-08). Replaces the
 * bare window.confirm prompts: it states exactly what will be removed
 * (authoritative counts computed server-side), and destructive roots
 * (section / offering / period) additionally require typing the item's name
 * before the delete button unlocks. The server action receives every id via
 * hiddenFields (the dialog owns its form, so no outer form is needed).
 */
type ConfirmDeleteDialogProps = {
  label: string;
  /** Dialog copy stating exactly what is removed (with counts). */
  confirmMessage: string;
  /**
   * When set, the staff member must type this name (case-insensitive, trimmed)
   * before the confirm button unlocks — the most destructive deletes only.
   */
  requireTyping?: string;
  /** Toast copy after the server action succeeds. */
  successToast?: string;
  /** Inputs rendered inside the dialog's form (ids, force, …). */
  hiddenFields: Record<string, string>;
  testId: string;
  buttonClass?: string;
  action: (formData: FormData) => Promise<ActionResult>;
};

export function ConfirmDeleteDialogButton({
  label,
  confirmMessage,
  requireTyping,
  successToast,
  hiddenFields,
  testId,
  buttonClass = "inline-flex h-9 items-center rounded-lg border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
  action,
}: ConfirmDeleteDialogProps) {
  const t = useTranslations("DeleteDialog");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const matchOk = !requireTyping || typed.trim().toLowerCase() === requireTyping.toLowerCase();

  const [, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(successToast ?? t("defaultSuccess"));
        setOpen(false);
        setTyped("");
      } else {
        toast.error(t("errorToast", { message: result.error }));
      }
      return result;
    },
    null,
  );

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            data-testid={`${testId}-dialog`}
            className="grid w-full max-w-md gap-4 rounded-xl border bg-card p-5 shadow-lg"
          >
            <p className="text-sm font-semibold">{t("title")}</p>
            <p className="text-sm text-muted-foreground" data-testid={`${testId}-message`}>
              {confirmMessage}
            </p>
            <form action={formAction} className="grid gap-3">
              {Object.entries(hiddenFields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              {requireTyping ? (
                <label className="grid gap-1 text-sm">
                  <span>{t("typeToConfirm", { name: requireTyping })}</span>
                  <input
                    type="text"
                    name="confirmName"
                    autoComplete="off"
                    data-testid={`${testId}-confirm-input`}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  data-testid={`${testId}-cancel`}
                  onClick={() => {
                    setOpen(false);
                    setTyped("");
                  }}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={pending || !matchOk}
                  className="inline-flex h-9 items-center rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  data-testid={`${testId}-confirm`}
                >
                  {pending ? t("deleting") : t("confirm")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
