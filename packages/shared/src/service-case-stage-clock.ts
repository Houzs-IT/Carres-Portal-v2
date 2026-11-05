/**
 * 0745 — how long a Service Case has been in its current stage, against the
 * stage's target days. Follows Houzs frontend/src/pages/ServiceCases.tsx:7127-7175
 * (LeadTimePill: elapsed / target, red at or past the target) per Weisiang's
 * ruling (2026-10-22): clear Carres rules, implement Houzs.
 */
export interface CaseStageDwell {
  /** Whole days since the case entered the stage. */
  days: number;
  /** The stage has a target and the case has reached or passed it. */
  overTarget: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function caseStageDwell(stageSince: string, targetDays: number | null | undefined, now: Date): CaseStageDwell {
  const elapsed = Math.max(0, (now.getTime() - new Date(stageSince).getTime()) / DAY_MS);
  return {
    days: Math.floor(elapsed),
    overTarget: targetDays != null && targetDays > 0 && elapsed >= targetDays,
  };
}
