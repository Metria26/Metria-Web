import Link from "next/link";
import { ChevronDown } from "lucide-react";

/**
 * Server-rendered dropdown for staff member-change requests. Native <details>
 * needs no client JavaScript, keeps the warning visible at a glance and expands
 * to show exactly which project/group each request belongs to.
 */
export type PendingRequestItem = {
  id: string;
  /** Project (dashboard) or page title. */
  primary: string;
  /** Group id, group project title and request count. */
  secondary: string;
  count: number;
  href: string;
  /** Human-readable change summaries, e.g. "Add member: Ali l250636". */
  changes: string[];
};

export function PendingRequestsDropdown({
  title,
  hint,
  reviewLabel,
  items,
}: {
  title: string;
  hint: string;
  reviewLabel: string;
  items: PendingRequestItem[];
}) {
  if (items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <details
      className="group mt-4 rounded-xl border-2 border-warning/60 bg-warning/10 shadow-sm"
      data-testid="pending-requests-dropdown"
    >
      <summary
        className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-t-xl px-4 py-3 text-sm font-semibold text-foreground marker:content-none [&::-webkit-details-marker]:hidden"
        data-testid="pending-requests-summary"
      >
        <span className="flex items-center gap-2">
          <span
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-warning px-2 text-xs font-bold text-warning-foreground"
            data-testid="pending-requests-count"
          >
            {total}
          </span>
          <span>{title}</span>
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {reviewLabel}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="border-t border-warning/40 px-4 py-3">
        <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
        <ul className="grid gap-2" data-testid="pending-requests-list">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.primary}</p>
                  <p className="text-xs text-muted-foreground">{item.secondary}</p>
                </div>
                <Link
                  href={item.href}
                  className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
                  data-testid={`pending-request-review-${item.id}`}
                >
                  {reviewLabel}
                </Link>
              </div>
              <ul className="mt-2 grid gap-1 text-xs">
                {item.changes.map((change, index) => (
                  <li key={`${item.id}-${index}`} className="text-foreground/80">
                    • {change}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
