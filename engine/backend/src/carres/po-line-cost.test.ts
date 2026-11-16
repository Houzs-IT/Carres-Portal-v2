import { describe, expect, it } from 'vitest';
import { applyPoCost, poCostForLine } from './po-line-cost';

describe('PO cost of a sold line', () => {
  it('is the PO price for the quantity sold', () => {
    expect(poCostForLine(1, [{ qty: 1, line_total_sen: 83250 }])).toBe(83250);
    expect(poCostForLine(2, [{ qty: 1, line_total_sen: 1000 }, { qty: 1, line_total_sen: 1200 }])).toBe(2200);
  });
  it('charges only what was sold when the PO bought more', () => {
    expect(poCostForLine(1, [{ qty: 2, line_total_sen: 2000 }])).toBe(1000);
  });
  it('has no cost without a PO', () => {
    expect(poCostForLine(1, [])).toBeNull();
  });
});

describe('applyPoCost', () => {
  const db = (rows: unknown[]) => ({
    from: () => {
      const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, range: async () => ({ data: rows, error: null }) };
      return q;
    },
  });
  it('replaces the recorded cost and counts lines without a PO', async () => {
    const r = await applyPoCost(db([
      { so_item_id: 'a', qty: 1, line_total_sen: 500, purchase_orders: { status: 'RECEIVED' } },
      { so_item_id: 'b', qty: 1, line_total_sen: 900, purchase_orders: { status: 'CANCELLED' } },
    ]), 1, [
      { id: 'a', qty: 1, unit_cost_sen: 9999, line_cost_sen: 9999 },
      { id: 'b', qty: 1, unit_cost_sen: 9999, line_cost_sen: 9999 },
    ]);
    expect(r.ok && r.lines.map((l) => l.line_cost_sen)).toEqual([500, 0]);
    expect(r.ok && r.withoutPo).toBe(1);
  });
});
