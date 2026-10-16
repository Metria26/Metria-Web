"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createAnnouncementAction } from "@/features/academics/actions";
import type { ActionResult } from "@/features/academics/contracts";

type SectionOption = { id: string; label: string };

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "text-sm font-medium";
const buttonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const toolbarButtonClass =
  "inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent";

function ToolbarButton({
  label,
  testId,
  isActive,
  onRun,
}: {
  label: string;
  testId: string;
  isActive: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      className={toolbarButtonClass}
      aria-pressed={isActive}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onRun}
    >
      {label}
    </button>
  );
}

/**
 * T-A005: Tiptap editor for announcement bodies (D8). The editor keeps its own
 * HTML; the hidden `bodyHtml` input carries it to the server action, which
 * sanitizes before persisting. Editing is intentionally minimal -- bold,
 * italic, lists -- matching the sanitize allowlist.
 */
export function AnnouncementForm({ sections }: { sections: SectionOption[] }) {
  const t = useTranslations("Announcements.form");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => createAnnouncementAction(formData),
    null,
  );
  const [html, setHtml] = useState("");

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    // SSR-safe: do not render on the server (Next App Router).
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-24 rounded-b-lg border border-t-0 border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring",
        "aria-label": t("bodyLabel"),
      },
    },
    onUpdate: ({ editor: instance }) => setHtml(instance.getHTML()),
  });

  return (
    <form action={formAction} className="grid max-w-xl gap-3" data-testid="announcement-form">
      <label className="grid gap-1.5">
        <span className={labelClass}>{t("section")}</span>
        <select
          name="sectionId"
          required
          defaultValue=""
          className={fieldClass}
          data-testid="announcement-section"
        >
          <option value="" disabled>
            {t("sectionPlaceholder")}
          </option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className={labelClass}>{t("title")}</span>
        <input
          name="title"
          required
          minLength={2}
          maxLength={200}
          className={fieldClass}
          data-testid="announcement-title"
        />
      </label>

      <div className="grid gap-1.5">
        <span className={labelClass}>{t("bodyLabel")}</span>
        {editor ? (
          <div className="flex flex-wrap gap-1" data-testid="announcement-toolbar">
            <ToolbarButton
              label={t("bold")}
              testId="announcement-bold"
              isActive={editor.isActive("bold")}
              onRun={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolbarButton
              label={t("italic")}
              testId="announcement-italic"
              isActive={editor.isActive("italic")}
              onRun={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolbarButton
              label={t("bullets")}
              testId="announcement-bullets"
              isActive={editor.isActive("bulletList")}
              onRun={() => editor.chain().focus().toggleBulletList().run()}
            />
          </div>
        ) : null}
        <EditorContent editor={editor} data-testid="announcement-editor" />
        <input type="hidden" name="bodyHtml" value={html} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
        data-testid="announcement-submit"
      >
        {pending ? t("saving") : t("submit")}
      </button>
      {state && !state.ok ? (
        <p role="alert" data-testid="announcement-error" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {state && state.ok ? (
        <p
          role="status"
          data-testid="announcement-success"
          className="text-sm text-muted-foreground"
        >
          {t("posted")}
        </p>
      ) : null}
    </form>
  );
}
