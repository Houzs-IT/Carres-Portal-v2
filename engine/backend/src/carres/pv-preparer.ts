// Carres: the person who prepared a payment voucher may not check it (Chew, docs/finance/MASTER.md §0.0 ruling 8).
// Houzs lets one person prepare, check and approve; Carres keeps preparing and checking apart. The same
// person may still check and approve.

export type PreparerVerdict = { ok: true } | { ok: false; error: 'preparer_cannot_check'; message: string };

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function preparerMayCheck(pv: { submitted_by?: string | null }, actor: string): PreparerVerdict {
  const preparer = norm(pv.submitted_by);
  if (preparer !== '' && preparer === norm(actor)) {
    return {
      ok: false,
      error: 'preparer_cannot_check',
      message: 'You prepared this voucher, so someone else must check it.',
    };
  }
  return { ok: true };
}
