/**
 * Deterministic student ordering (registry delta 2026-11-08). Lists sort by
 * email ascending using the part before '@' (l250616@... comes before
 * l257689@...), case-insensitive and numeric-aware; this mirrors the SQL
 * `private.natural_sort_key()` helper used by roster RPCs so server- and
 * client-side lists always agree.
 */

/** Lowercase local part of a university email ("l250616@x.y" → "l250616"). */
export function studentEmailLocalPart(email: string | null | undefined): string {
  const trimmed = (email ?? "").trim();
  const at = trimmed.indexOf("@");
  return (at === -1 ? trimmed : trimmed.slice(0, at)).toLowerCase();
}

/** Case-insensitive, numeric-aware comparison: digit runs compare as numbers. */
export function naturalCompare(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const pattern = /\d+|\D+/g;
  const lParts = left.match(pattern) ?? [];
  const rParts = right.match(pattern) ?? [];
  const count = Math.min(lParts.length, rParts.length);
  for (let index = 0; index < count; index += 1) {
    const l = lParts[index] ?? "";
    const r = rParts[index] ?? "";
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const delta = Number.parseInt(l, 10) - Number.parseInt(r, 10);
      if (delta !== 0) return delta;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  if (lParts.length !== rParts.length) return lParts.length - rParts.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Sort key that matches private.natural_sort_key(): padded digit runs. */
export function naturalSortKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\d+/g, (digits) => digits.padStart(12, "0"));
}

const naturalKeyCollator: (a: string, b: string) => number = (a, b) => {
  const ka = naturalSortKey(a);
  const kb = naturalSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/**
 * Primary comparator for student lists: email local part, then the full email,
 * then display name (rare tie-break). Stable input order for equal keys.
 */
export function compareStudentsByEmail(
  a: { email?: string | null; displayName?: string | null },
  b: { email?: string | null; displayName?: string | null },
): number {
  const aLocal = studentEmailLocalPart(a.email);
  const bLocal = studentEmailLocalPart(b.email);
  const localDelta = naturalKeyCollator(aLocal, bLocal);
  if (localDelta !== 0) return localDelta;
  const aEmail = (a.email ?? "").toLowerCase();
  const bEmail = (b.email ?? "").toLowerCase();
  if (aEmail !== bEmail) return aEmail < bEmail ? -1 : 1;
  const aName = a.displayName ?? "";
  const bName = b.displayName ?? "";
  return aName < bName ? -1 : aName > bName ? 1 : 0;
}

/**
 * Convenience sort for roster rows (mutates-free): returns a new array sorted
 * by email ascending. Falls back to any secondary ordering already present.
 */
export function sortStudentsByEmail<T extends { email?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareStudentsByEmail(a, b));
}
