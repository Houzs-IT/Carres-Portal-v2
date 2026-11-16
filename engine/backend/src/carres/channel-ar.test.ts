import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_CODES, orderMoneyTransferLines, type RoleCodes } from '../acc/rules';
import { arControlCodes, arForInvoice, arForOrder, arForSaleType, arForSource, channelArOn, withAr } from './channel-ar';

const houzs: RoleCodes = { ...DEFAULT_ROLE_CODES };
const carres: RoleCodes = { ...DEFAULT_ROLE_CODES, AR_SHOWROOM: '300-1000', AR_SUBSCRIPTION: '300-3000' };

/** A one-table fake: `from(t).select().eq()…maybeSingle()` answers the row whose fields match every eq. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, fail?: string) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      const where: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { where.push([col, v]); return q; },
        maybeSingle: async () => {
          if (fail === table) return { data: null, error: { message: 'boom' } };
          const row = (tables[table] ?? []).find((r) => where.every(([c, v]) => r[c] === v)) ?? null;
          return { data: row, error: null };
        },
      };
      return q;
    },
  };
}

const db = () => fakeDb({
  mfg_sales_orders: [
    { company_id: 1, doc_no: 'SO-1', sale_type: 'outright' },
    { company_id: 1, doc_no: 'SO-2', sale_type: 'subscription' },
  ],
  sales_invoices: [
    { company_id: 1, id: 'si-2', invoice_number: 'SI-2', so_doc_no: 'SO-2' },
    { company_id: 1, id: 'si-9', invoice_number: 'SI-9', so_doc_no: null },
  ],
});

describe('Carres channel debtor controls', () => {
  it('is off for Houzs, whose channel roles are AR', () => {
    expect(channelArOn(houzs)).toBe(false);
    expect(arControlCodes(houzs)).toEqual(['300-0000']);
  });

  it('picks 300-3000 for Subscription and 300-1000 otherwise', () => {
    expect(arForSaleType(carres, 'subscription')).toBe('300-3000');
    expect(arForSaleType(carres, 'Subscription')).toBe('300-3000');
    expect(arForSaleType(carres, 'outright')).toBe('300-1000');
    expect(arForSaleType(carres, null)).toBe('300-1000');
    expect(arControlCodes(carres)).toEqual(['300-0000', '300-1000', '300-3000']);
  });

  it('reads nothing when the company does not split', async () => {
    const d = db();
    expect(await arForOrder(d, houzs, 1, 'SO-2')).toBe('300-0000');
    expect(d.reads).toEqual([]);
  });

  it("takes an order's channel, an invoice's order's channel, and the showroom when there is no order", async () => {
    expect(await arForOrder(db(), carres, 1, 'SO-1')).toBe('300-1000');
    expect(await arForOrder(db(), carres, 1, 'SO-2')).toBe('300-3000');
    expect(await arForOrder(db(), carres, 1, null)).toBe('300-1000');
    expect(await arForInvoice(db(), carres, 1, { id: 'si-2' })).toBe('300-3000');
    expect(await arForInvoice(db(), carres, 1, { number: 'SI-9' })).toBe('300-1000');
    expect(await arForSource(db(), carres, 1, 'SI', 'SI-2')).toBe('300-3000');
    expect(await arForSource(db(), carres, 1, 'SO', 'SO-2')).toBe('300-3000');
  });

  it('books on Trade Debtors when the order cannot be read', async () => {
    const d = fakeDb({}, 'mfg_sales_orders');
    expect(await arForOrder(d, carres, 1, 'SO-2')).toBe('300-0000');
  });

  it('moves money between two channels when it moves between their orders', () => {
    const lines = orderMoneyTransferLines(withAr(carres, '300-1000'), {
      fromDocNo: 'SO-1', toDocNo: 'SO-2', from: { code: 'C1', name: 'A' }, to: { code: 'C1', name: 'A' }, fromAr: '300-1000', toAr: '300-3000',
    }, 500);
    expect(lines.map((l) => [l.accountCode, l.debitSen, l.creditSen])).toEqual([['300-1000', 500, 0], ['300-3000', 0, 500]]);
  });
});
