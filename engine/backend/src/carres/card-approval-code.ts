// Carres: every card payment carries its approval code (Chew, docs/finance/MASTER.md §0.0 ruling 4). A card
// payment is method `merchant` (or `installment`, the plan under Merchant). The database refuses one without a
// code too (engine migration 2014), but a door asks first so the person sees the sentence before anything is
// saved: at Sales Order create a refused deposit row would otherwise be skipped and the order made without it.
// Runs only while CARRES_FINANCE_RULES is on (carres/finance-rules.ts).
import type { SaveProblem } from '../scm/shared/so-save-problems';

export const CARD_CODE_REQUIRED: SaveProblem = {
  code: 'card_approval_code_required',
  field: 'Approval code',
  message: 'A card payment needs its approval code. Type the code printed on the card terminal receipt.',
};

export type CardRow = { method?: unknown; approvalCode?: unknown; amountSen?: unknown };

const isCard = (method: unknown): boolean => ['merchant', 'installment'].includes(String(method ?? '').trim().toLowerCase());
const blank = (code: unknown): boolean => String(code ?? '').trim() === '';

/** The problem when any card row with money on it has no approval code; null when every one has. */
export function cardCodeProblem(rows: readonly CardRow[]): SaveProblem | null {
  return rows.some((r) => isCard(r.method) && blank(r.approvalCode) && (r.amountSen == null || Number(r.amountSen) > 0))
    ? CARD_CODE_REQUIRED
    : null;
}

/** The payment rows a Sales Order create body carries: its `payments` list, or the single deposit fields. */
export function soCreateCardRows(body: Record<string, unknown>, payments: readonly CardRow[] | null): CardRow[] {
  if (payments) return [...payments];
  return [{ method: body.paymentMethod, approvalCode: body.approvalCode, amountSen: Number(body.depositSen ?? 0) }];
}
