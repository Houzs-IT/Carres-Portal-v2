// Carres: a sold line's cost is the cost on the PO bought for it, never the catalogue or SO-recorded cost
// (Chew, docs/finance/MASTER.md §0.0 ruling 7 and §3.6). A line with no PO has no cost: it reads RM 0 and is
// counted as a line without a PO, never a guessed figure. Used by the Performance P&L and product profit.
import { chunkIn } from '../scm/lib/paginate-all';

export type PoCostItem = { qty: number | null; line_total_sen: number | null };

/** The cost of `soQty` units from the PO lines bought for one sales-order line: their average price per unit
    times the quantity sold (a PO for more than was sold charges only what was sold). Null when there is none. */
export function poCostForLine(soQty: number | null, items: readonly PoCostItem[]): number | null {
  const qty = items.reduce((s, i) => s + Math.max(0, Number(i.qty ?? 0)), 0);
  if (items.length === 0 || qty <= 0) return null;
  const total = items.reduce((s, i) => s + Number(i.line_total_sen ?? 0), 0);
  const sold = Math.max(0, Number(soQty ?? 0));
  return Math.round((total / qty) * Math.min(sold, qty));
}

type LineWithId = { id?: string | null; qty: number | null; unit_cost_sen: number | null; line_cost_sen: number | null };

/** Replaces each line's cost with its PO cost. Returns how many lines had no PO. */
export async function applyPoCost<T extends LineWithId>(
  sb: any, companyId: number, lines: T[],
): Promise<{ ok: true; lines: T[]; withoutPo: number } | { ok: false; reason: string }> {
  const ids = [...new Set(lines.map((l) => String(l.id ?? '')).filter((id) => id !== ''))];
  const rows = await chunkIn<{ so_item_id: string; qty: number | null; line_total_sen: number | null; purchase_orders: { status: string } | null }>(
    ids, (batch, f, t) => sb.from('purchase_order_items')
      .select('so_item_id, qty, line_total_sen, purchase_orders!inner(status)')
      .eq('company_id', companyId).in('so_item_id', batch)
      .order('id').range(f, t));
  if (rows.error) return { ok: false, reason: `PO cost: ${rows.error.message}` };
  const bySo = new Map<string, PoCostItem[]>();
  for (const r of rows.data) {
    if (String(r.purchase_orders?.status ?? '') === 'CANCELLED') continue;
    bySo.set(r.so_item_id, [...(bySo.get(r.so_item_id) ?? []), r]);
  }
  let withoutPo = 0;
  const out = lines.map((l) => {
    const cost = poCostForLine(l.qty, bySo.get(String(l.id ?? '')) ?? []);
    if (cost == null) withoutPo += 1;
    const lineCost = cost ?? 0;
    const qty = Number(l.qty ?? 0);
    return { ...l, line_cost_sen: lineCost, unit_cost_sen: qty > 0 ? Math.round(lineCost / qty) : 0 };
  });
  return { ok: true, lines: out, withoutPo };
}
