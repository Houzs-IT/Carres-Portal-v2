// Carres: the Sales Order and the documents cut from it use Address Line 1 and 2 only, the same as Houzs
// (owner 14 Nov 2026, reversing PR #2301). Drives the REAL SO -> DO handler and the REAL DO -> SI core
// through a fake PostgREST client (the harness of delivery-orders-mfg.ship-from.test.ts) and pins that
// the two lines a user typed on the order arrive on the Delivery Order and the Sales Invoice unchanged.
import { describe, expect, test } from 'vitest';
import { createDoFromSoLinesHandler } from './delivery-orders-mfg';
import { createSalesInvoiceFromDoLines } from '../lib/si-from-do';

type Row = Record<string, unknown>;

/* Reads are served from `tables`; inserts are captured per table and handed back with an id. Any
   unmodelled chained method filters nothing and resolves to the current row set. */
function fakeSb(tables: Record<string, Row[]>, captured: Record<string, Row[]>) {
  let minted = 0;
  const mk = (table: string) => {
    const state = { rows: [...(tables[table] ?? [])], single: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the chainable PostgREST fake has no static shape by design
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const result = state.single
            ? { data: state.rows[0] ?? null, error: null, count: state.rows.length }
            : { data: state.rows, error: null, count: state.rows.length };
          return (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(result).then(onF, onR);
        }
        if (prop === 'eq') return (col: string, val: unknown) => { state.rows = state.rows.filter((r) => r[col] === val); return proxy; };
        if (prop === 'in') return (col: string, vals: unknown[]) => { state.rows = state.rows.filter((r) => vals.includes(r[col])); return proxy; };
        if (prop === 'is') return (col: string, val: unknown) => { if (val === null) state.rows = state.rows.filter((r) => r[col] == null); return proxy; };
        if (prop === 'range') return (from: number, to: number) => { state.rows = state.rows.slice(from, to + 1); return proxy; };
        if (prop === 'limit') return (n: number) => { state.rows = state.rows.slice(0, n); return proxy; };
        if (prop === 'maybeSingle' || prop === 'single') return () => { state.single = true; return proxy; };
        if (prop === 'insert') return (payload: Row | Row[]) => {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${table}-${++minted}`, ...r }));
          (captured[table] ??= []).push(...rows);
          state.rows = rows;
          return proxy;
        };
        return (..._args: unknown[]) => proxy;
      },
    });
    return proxy;
  };
  return {
    from: (table: string) => mk(table),
    rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function in this harness' } }),
  };
}

const SO_DOC = 'SO-2611-401';
const LINE1 = 'No 12, Jalan Bukit Bintang';
const LINE2 = 'Unit 8-3, Menara Suria';

const soLine: Row = {
  id: 'soi-1', doc_no: SO_DOC, company_id: 1, item_code: 'MATT-1', item_group: 'MATTRESS',
  description: 'Mattress', description2: null, uom: 'UNIT', qty: 1,
  unit_price_sen: 10000, unit_cost_sen: 0, discount_sen: 0, variants: {},
  cancelled: false, warehouse_id: 'wh-kl', photo_urls: [], debtor_code: 'C001', debtor_name: 'Customer One',
};

const soHeader: Row = {
  doc_no: SO_DOC, company_id: 1, status: 'CONFIRMED', on_hold: false, debtor_code: 'C001', debtor_name: 'Customer One',
  address1: LINE1, address2: LINE2, address3: null, address4: null,
  city: 'Kuala Lumpur', customer_state: 'Wilayah Persekutuan', postcode: '55100',
};

async function soToDo(): Promise<{ header: Row; items: Row[] }> {
  const captured: Record<string, Row[]> = {};
  const sb = fakeSb({
    mfg_sales_order_items: [soLine], mfg_sales_orders: [soHeader],
    delivery_orders: [], delivery_order_items: [], delivery_return_items: [], delivery_returns: [],
    warehouses: [], mfg_products: [], purchase_orders: [], purchase_order_items: [],
  }, captured);
  const ctx = {
    req: {
      json: async () => ({ picks: [{ soItemId: 'soi-1', qty: 1 }], asDraft: true, confirmShortStock: true, confirmNotReady: true }),
      param: () => undefined,
    },
    get: (key: string) => {
      if (key === 'supabase') return sb;
      if (key === 'user') return { id: 'user-1' };
      if (key === 'houzsUser') return { id: 7, name: 'Harness' };
      return undefined;
    },
    env: {},
    json: (body: unknown, status = 200) => ({ status, body: body as Record<string, unknown> }),
  } as unknown as Parameters<typeof createDoFromSoLinesHandler>[0];
  const out = (await createDoFromSoLinesHandler(ctx)) as unknown as { status: number; body: Row };
  if (out.status !== 201) throw new Error(`SO -> DO refused: ${out.status} ${JSON.stringify(out.body)}`);
  expect(captured.delivery_orders).toHaveLength(1);
  return { header: captured.delivery_orders![0]!, items: captured.delivery_order_items ?? [] };
}

describe('Carres: SO -> DO -> SI carries Address Line 1 and 2 unchanged', () => {
  test('the Delivery Order and the Sales Invoice hold the two lines typed on the order', async () => {
    const dO = await soToDo();
    expect(dO.header.address1).toBe(LINE1);
    expect(dO.header.address2).toBe(LINE2);
    expect(dO.items.length).toBeGreaterThan(0);

    // The delivery went out: the DO is in the invoiceable pool.
    const doRow = { ...dO.header, status: 'DELIVERED', migrated_no_stock: false };
    const captured: Record<string, Row[]> = {};
    const sb = fakeSb({
      delivery_orders: [doRow], delivery_order_items: dO.items,
      sales_invoice_items: [], sales_invoices: [], delivery_return_items: [], delivery_returns: [],
    }, captured);
    const out = await createSalesInvoiceFromDoLines(sb as never, {
      companyId: null, docPrefix: 'SI', picks: dO.items.map((it) => ({ doItemId: String(it.id), qty: 1 })),
      asDraft: true, createdBy: null, actor: null,
    });
    if (!out.ok) throw new Error(`DO -> SI refused: ${out.status} ${JSON.stringify(out.body)}`);
    const si = captured.sales_invoices?.[0];
    expect(si?.address1).toBe(LINE1);
    expect(si?.address2).toBe(LINE2);
  });
});
