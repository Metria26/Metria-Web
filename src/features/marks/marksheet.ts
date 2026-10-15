/**
 * Pure marksheet math (feature 2.3 / T-A004). Same formulas as
 * private.offering_marksheet: a graded mark contributes score/total × weight,
 * ungraded contributes 0; the grade band is the highest band whose min the
 * weighted total still reaches. pgTAP asserts RPC parity on fixtures.
 */

export type MarksheetAssessment = { id: string; total: number; weight: number };
export type GradeBand = { min: number; grade: string };
export type CellStatus = "graded" | "pending" | "missing";

export function weightedTotal(
  assessments: MarksheetAssessment[],
  scores: Record<string, number | null | undefined>,
): { total: number; gradedWeight: number } {
  let total = 0;
  let gradedWeight = 0;
  for (const assessment of assessments) {
    const score = scores[assessment.id];
    if (score === null || score === undefined) continue;
    total += (score / assessment.total) * assessment.weight;
    gradedWeight += assessment.weight;
  }
  return { total: round2(total), gradedWeight: round2(gradedWeight) };
}

export function gradeFor(
  bands: GradeBand[] | null | undefined,
  weightedTotalValue: number,
): string | null {
  if (!bands || bands.length === 0) return null;
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  for (const band of ordered) {
    if (weightedTotalValue >= band.min) return band.grade;
  }
  return null;
}

/** missing = no mark row at all; pending = row exists without a score. */
export function classify(
  assessments: MarksheetAssessment[],
  scores: Record<string, { score: number | null } | undefined>,
): { missing: string[]; pending: string[]; graded: string[] } {
  const missing: string[] = [];
  const pending: string[] = [];
  const graded: string[] = [];
  for (const assessment of assessments) {
    const cell = scores[assessment.id];
    if (cell === undefined) missing.push(assessment.id);
    else if (cell.score === null) pending.push(assessment.id);
    else graded.push(assessment.id);
  }
  return { missing, pending, graded };
}

export function cellStatus(cell: { score: number | null } | undefined): CellStatus {
  if (cell === undefined) return "missing";
  if (cell.score === null) return "pending";
  return "graded";
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
