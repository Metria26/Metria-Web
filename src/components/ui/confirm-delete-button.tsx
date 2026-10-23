"use client";

/**
 * Destructive submit button with a confirmation prompt. Render inside a form
 * whose action is a server action (the form still works without JS).
 */
export function ConfirmDeleteButton({
  label,
  confirmMessage,
  testId,
}: {
  label: string;
  confirmMessage: string;
  testId: string;
}) {
  return (
    <button
      type="submit"
      className="inline-flex h-9 items-center rounded-lg border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
      data-testid={testId}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
