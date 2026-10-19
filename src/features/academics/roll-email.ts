/**
 * Roll-number → university email transforms for bulk student enrollment.
 * Product-confirmed rule: 24L-0612 → l240612@lhr.nu.edu.pk, i.e. strip
 * separators, lowercase, and move the campus letter before the batch year.
 * Spreadsheet round-trips sometimes drop leading zeros, so a zero-padded
 * alternate serial (24L-612 → l24612 / l240612) is accepted as a fallback.
 */

export const UNIVERSITY_EMAIL_DOMAIN = "lhr.nu.edu.pk";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPUS_FORM_RE = /^(\d{2})([a-z])(\d{2,})$/;
const LOCAL_FORM_RE = /^[a-z]\d{4,}$/;
const YEAR_SERIAL_RE = /^\d{6}$/;
const PADDED_SERIAL_LENGTH = 4;

export type ParsedRoll = {
  /** Cell value as it appeared in the CSV (trimmed). */
  input: string;
  /** Canonical email; also the pending-invite key. */
  email: string;
  /** Same student with a padded serial, when it differs from `email`. */
  altEmail: string | null;
};

function toEmail(local: string): string {
  return `${local.toLowerCase()}@${UNIVERSITY_EMAIL_DOMAIN}`;
}

function withPaddedVariant(local: string, input: string): ParsedRoll {
  const email = toEmail(local);
  const match = /^([a-z]\d{2})(\d+)$/.exec(local.toLowerCase());
  if (!match) return { input, email, altEmail: null };
  const prefix = match[1] ?? "";
  const serial = match[2] ?? "";
  if (!prefix || serial.length >= PADDED_SERIAL_LENGTH) {
    return { input, email, altEmail: null };
  }
  const altEmail = toEmail(`${prefix}${serial.padStart(PADDED_SERIAL_LENGTH, "0")}`);
  return { input, email, altEmail: altEmail === email ? null : altEmail };
}

/**
 * Parses a single CSV cell. Accepts roll numbers in any common separator
 * style (24L-0612, 24L 0612, 24L0612, 24l-612) as well as full emails.
 * Returns null for values that cannot be mapped to a student identity.
 */
export function parseRollInput(raw: string): ParsedRoll | null {
  const input = raw.trim();
  if (input.length === 0 || input.length > 254) return null;

  const lowered = input.toLowerCase();
  if (lowered.includes("@")) {
    return EMAIL_RE.test(lowered) ? { input, email: lowered, altEmail: null } : null;
  }

  const compact = lowered.replace(/[^a-z0-9]/g, "");

  const campus = CAMPUS_FORM_RE.exec(compact);
  if (campus) {
    const year = campus[1] ?? "";
    const letter = campus[2] ?? "";
    const serial = campus[3] ?? "";
    if (year && letter && serial) {
      return withPaddedVariant(`${letter}${year}${serial}`, input);
    }
  }

  if (LOCAL_FORM_RE.test(compact)) {
    return withPaddedVariant(compact, input);
  }

  const yearSerial = YEAR_SERIAL_RE.exec(compact);
  if (yearSerial) {
    return withPaddedVariant(`l${compact}`, input);
  }

  return null;
}
