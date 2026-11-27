/** Shared, dependency-free name cleanup for preview and Excel export. */
const PROGRAM_SUFFIX = /\s+BS\s*\(?\s*[A-Z]{2,3}\s*\)?(?:\s|$).*$/i;

/** Strip program / batch / campus suffixes from a display name. */
export function cleanStudentName(value: string): string {
  return value.replace(PROGRAM_SUFFIX, "").trim();
}
