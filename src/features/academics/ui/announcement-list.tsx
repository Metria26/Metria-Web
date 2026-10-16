import { sanitizeAnnouncementHtml } from "@/features/academics/sanitize";

export type AnnouncementListItem = {
  id: string;
  title: string;
  bodyHtml: string;
  context?: string;
  createdAt: string;
};

const displayDateFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Renders announcements with the body sanitized AGAIN on render (D8) — the
 * write path already sanitized, but rendering must never trust stored HTML.
 * Server component: no client JS ships for a read-only list.
 */
export function AnnouncementList({ announcements }: { announcements: AnnouncementListItem[] }) {
  if (announcements.length === 0) return null;
  return (
    <ul className="grid gap-2" data-testid="announcements-list">
      {announcements.map((announcement) => (
        <li
          key={announcement.id}
          className="grid gap-1 rounded-lg border bg-card px-4 py-3"
          data-testid="announcement-item"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">{announcement.title}</h3>
            <span className="text-xs text-muted-foreground">
              {displayDateFormat.format(new Date(announcement.createdAt))}
              {announcement.context ? ` · ${announcement.context}` : ""}
            </span>
          </div>
          <div
            className="text-sm text-muted-foreground [&_a]:underline [&_li]:ml-4 [&_li]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_p]:mt-1"
            // Sanitized above on every render — never raw stored HTML.
            dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(announcement.bodyHtml) }}
          />
        </li>
      ))}
    </ul>
  );
}
