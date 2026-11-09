/**
 * University-timezone display helpers (registry delta 2026-11-08). All times
 * are stored UTC (timestamptz) and displayed in Asia/Karachi on a 12-hour
 * clock with AM/PM in every view; these formatters are the single source of
 * truth so no page can regress to a 24-hour display.
 */

export const UNIVERSITY_TIME_ZONE = "Asia/Karachi";

const timeFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: UNIVERSITY_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: UNIVERSITY_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortDayFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: UNIVERSITY_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const shortDayTimeFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: UNIVERSITY_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const fullDayTimeFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: UNIVERSITY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "10:30 AM - 11:00 AM" (slot time range on a 12-hour clock). */
export function formatSlotTimeRange(startsAt: string | Date, endsAt: string | Date): string {
  return `${timeFormatter.format(new Date(startsAt))} - ${timeFormatter.format(new Date(endsAt))}`;
}

/** "10:30 AM" (single boundary). */
export function formatSlotTime(value: string | Date): string {
  return timeFormatter.format(new Date(value));
}

/** "Monday, 9 Nov 2026" (day group heading). */
export function formatDayHeading(value: string | Date): string {
  return dayFormatter.format(new Date(value));
}

/** "Mon, 9 Nov" (compact label, filters and chips). */
export function formatShortDay(value: string | Date): string {
  return shortDayFormatter.format(new Date(value));
}

/** "Mon, 9 Nov, 10:30 AM" (dashboard cards, staff tables). */
export function formatShortDayTime(value: string | Date): string {
  return shortDayTimeFormatter.format(new Date(value));
}

/** "9 Nov 2026, 10:30 am" (window label with the full date). */
export function formatDateTime(value: string | Date): string {
  return fullDayTimeFormatter.format(new Date(value));
}

/** Asia/Karachi calendar date (YYYY-MM-DD) of an instant — day grouping key. */
export function karachiDateKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UNIVERSITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
  return parts; // en-CA keeps ISO YYYY-MM-DD ordering
}
