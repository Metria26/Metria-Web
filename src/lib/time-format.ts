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

const dateTimeInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: UNIVERSITY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Stored instant → datetime-local value in university time
 * ("YYYY-MM-DDTHH:mm"). Rendering the raw ISO slice would show UTC.
 */
export function toUniversityDateTimeInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = dateTimeInputFormatter.formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/**
 * datetime-local value ("YYYY-MM-DDTHH:mm") interpreted as university wall
 * time → ISO UTC. Asia/Karachi is UTC+05 with no DST, so the offset is exact.
 */
export function universityDateTimeInputToIso(raw: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((raw ?? "").trim());
  if (!match) return null;
  const date = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}+05:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
