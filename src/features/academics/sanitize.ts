import sanitizeHtml from "sanitize-html";

/**
 * D8: announcements are sanitized on WRITE (here, in the server action) and
 * again on RENDER (announcement-list.tsx) — belt and braces against stored
 * XSS. The allowlist is intentionally tiny: rich enough for a course
 * announcement, too small for an injection gadget.
 */

const ALLOWED_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "h3",
    "h4",
    "blockquote",
    "code",
    "pre",
    "a",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target"],
  },
  allowedSchemes: ["https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

export function sanitizeAnnouncementHtml(dirty: string): string {
  return sanitizeHtml(dirty, ALLOWED_OPTIONS);
}
