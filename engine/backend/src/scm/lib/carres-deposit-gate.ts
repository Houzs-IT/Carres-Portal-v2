// ----------------------------------------------------------------------------
// Carres: the 50% deposit BLOCKS a Processing Date / Proceed (owner ruling 12 Nov 2026).
//
// Houzs removed the deposit from its save gates on 20 Aug 2026 (「以电脑为准 —— 两边都不查」, see
// shared/so-save-problems.ts). Carres keeps it: an order whose collected deposit is below
// processingDateThresholdFor(company) of its total (50% for the HOUZS row, which is Carres) cannot be given a
// Processing Date or moved to the proceed stage — on create, header edit, Draft -> Confirmed with a date,
// /status IN_PRODUCTION and amendment approval — and POST /validate tells the form the same before saving.
// Every other company keeps Houzs's behaviour (no money gate).
//
// The refusal is shared/so-save-problems.ts depositProblem, so the words and amounts are the ones the proceed
// refusal already prints: "Deposit RM 200.00 of RM 500.00 needed (50%) before a Processing Date can be set".
// A free order (total <= 0) is never refused (meetsDepositGate is vacuously met).
// ----------------------------------------------------------------------------

import { depositProblem, type GateAct, type SaveProblem } from '../shared/so-save-problems';

/** Carres is the engine's one company, kept under Houzs's code (row code 'HOUZS', name 'Carres', id 1). */
export const DEPOSIT_GATE_COMPANY_CODES: readonly string[] = ['HOUZS'];

export function companyBlocksOnDeposit(companyCode: unknown): boolean {
  return DEPOSIT_GATE_COMPANY_CODES.includes(String(companyCode ?? '').trim().toUpperCase());
}

/** The refusal for this order's money, or null when it may proceed (or the company has no money gate). */
export function carresDepositProblem(args: {
  companyCode: unknown;
  paidSen: number;
  totalSen: number;
  act: GateAct;
}): SaveProblem | null {
  if (!companyBlocksOnDeposit(args.companyCode)) return null;
  const code = String(args.companyCode ?? '').trim().toUpperCase();
  return depositProblem(Math.max(0, args.paidSen || 0), args.totalSen || 0, code, args.act);
}

/** A body's `pendingDepositSen`, as a non-negative number. */
export function pendingDepositOf(body: Record<string, unknown>): number {
  const v = Number(body.pendingDepositSen ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export const DEPOSIT_UNREADABLE: SaveProblem = {
  code: 'deposit_unreadable',
  message: 'The payments on this order could not be read, so the deposit could not be checked. Try again in a moment.',
  field: 'Deposit',
};

/**
 * The same rule for a saved order: its total (local_total_sen) against every payment recorded on it. Fails
 * CLOSED — an unreadable ledger is not an unpaid one, but it is not a paid one either.
 *
 * @param sb The scm PostgREST client, already company-scoped by the caller's doc lookup.
 * @param pendingSen Money the same save records right after this check (a form's new payment rows, sent as
 *   `pendingDepositSen`, as the create already does) — counted so a deposit keyed in the same save is not
 *   refused for arriving one request later. Never stored.
 */
export async function carresDepositProblemForDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SCM PostgREST client is untyped throughout
  sb: any,
  docNo: string,
  companyCode: unknown,
  act: GateAct,
  pendingSen = 0,
): Promise<SaveProblem | null> {
  if (!companyBlocksOnDeposit(companyCode)) return null;
  const [tot, pays] = await Promise.all([
    sb.from('mfg_sales_orders').select('local_total_sen').eq('doc_no', docNo).maybeSingle(),
    sb.from('mfg_sales_order_payments').select('amount_sen').eq('so_doc_no', docNo),
  ]);
  if (tot.error || pays.error) return DEPOSIT_UNREADABLE;
  const totalSen = Number((tot.data as { local_total_sen?: number | null } | null)?.local_total_sen ?? 0);
  const paidSen = ((pays.data ?? []) as Array<{ amount_sen?: number | null }>)
    .reduce((s, p) => s + Number(p.amount_sen ?? 0), 0) + Math.max(0, Number(pendingSen) || 0);
  return carresDepositProblem({ companyCode, paidSen, totalSen, act });
}
