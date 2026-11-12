// Carres: the 50% deposit BLOCKS a Processing Date / Proceed (owner ruling 12 Nov 2026) -- the routes.
// Confirm and Proceed through /status, the header edit through the header PATCH, and the allowed case on each.
// The create, /validate and amendment wiring are pinned at the bottom (the router's create cannot be driven end to
// end here, the same reason so-create-fair-gate.test.ts pins its wiring). Fake PostgREST: soConfirmProcessingDate.
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { soRouterSource } from './lib/so-router-source';

type Row = Record<string, any>;

/* Permissive fake PostgREST builder (same shape as soCancelScopeAndAtomicCancels):
   every method chains, eq/neq/in filter, an unknown table reads as empty. */
class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  constructor(private rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  ilike() { return this; }
  gte() { return this; }
  lte() { return this; }
  like() { return this; }
  is() { return this; }
  or() { return this; }
  /* Only the shapes the learning hook sends: not(col,'is',null) and
     not('action','in','("A","B")'). */
  not(col: string, op: string, val: unknown) {
    if (op === 'is') this.preds.push((r) => r[col] != null);
    if (op === 'in') {
      const s = new Set(String(val).replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
      this.preds.push((r) => !s.has(String(r[col])));
    }
    return this;
  }
  update(p: Row) { this.op = 'update'; this.patch = p; return this; }
  delete() { this.op = 'delete'; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.inserted = Array.isArray(p) ? p : [p]; return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  in(col: string, vals: unknown[]) { const s = new Set((vals ?? []).map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  private run(): Row[] {
    if (this.op === 'insert') { this.rows.push(...this.inserted); return this.inserted; }
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') for (const r of hit) Object.assign(r, this.patch);
    if (this.op === 'delete') for (const r of hit) this.rows.splice(this.rows.indexOf(r), 1);
    return hit;
  }
  maybeSingle() { const h = this.run(); return Promise.resolve({ data: h[0] ?? null, error: null }); }
  single() { const h = this.run(); return Promise.resolve({ data: h[0] ?? null, error: h.length ? null : { message: 'no rows' } }); }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve({ data: this.run(), error: null }).then(res, rej); }
}

let tables: Record<string, Row[]> = {};
const client = () => ({ from: (t: string) => new FakeQuery((tables[t] ||= [])), rpc: async () => ({ data: true, error: null }) });

vi.mock('../src/db/supabase', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSupabaseService: () => client(),
}));

/* The brand question after a confirm reads D1; not under test here. */
vi.mock('../src/scm/lib/vp-brand-ask', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadVpBrandAsk: async () => null,
}));

import { patchMfgSalesOrderHeaderHandler, patchMfgSalesOrderStatusHandler } from '../src/scm/routes/mfg-sales-orders';

const CO = 1;
const DOC = 'HC-SO-2611-001';

/* A RM 500 order, complete, at a Carres showroom; `paidSen` is what the payments ledger holds. */
function world(o: { status: string; proc: string | null; paidSen: number; companyCode?: string }) {
  tables = {
    mfg_sales_orders: [{
      doc_no: DOC, company_id: CO, status: o.status, version: 2, debtor_code: 'C1',
      salesperson_id: 'staff-1', venue: 'Carres PJ', project_id: null, fair_match: 'NO_FAIR',
      debtor_name: 'TEST CUSTOMER', phone: '+60120000000', address1: '1 Jalan Ujian',
      city: 'Petaling Jaya', postcode: '46000', customer_state: 'Selangor', sales_location: 'PJ',
      processing_date: o.proc, customer_delivery_date: '2026-11-30', local_total_sen: 500_00,
      edit_lease_token: null, edit_lease_expires_at: null,
    }],
    mfg_sales_order_payments: o.paidSen > 0 ? [{ so_doc_no: DOC, amount_sen: o.paidSen }] : [],
    mfg_sales_order_items: [],
    mfg_so_audit_log: [],
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, { ...client(), rpc: async () => ({ data: [{ applied: true, current_version: 3 }], error: null }) } as never);
    c.set('companyId' as never, CO as never);
    c.set('companyCode' as never, (o.companyCode ?? 'HOUZS') as never);
    c.set('user' as never, { id: 'u1', user_metadata: { name: 'Tester' } } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Tester', position_name: 'Super Admin', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.patch('/mfg-sales-orders/:docNo/status', patchMfgSalesOrderStatusHandler as never);
  app.patch('/mfg-sales-orders/:docNo', patchMfgSalesOrderHeaderHandler as never);
  return app;
}

const json = { 'content-type': 'application/json' };
const DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }) };
const status = (app: Hono, to: string, from: string) => app.request(`/mfg-sales-orders/${DOC}/status`, {
  method: 'PATCH', headers: json, body: JSON.stringify({ status: to, expectedStatus: from, version: 2 }),
}, { DB });
const setDate = (app: Hono, extra: Record<string, unknown> = {}) => app.request(`/mfg-sales-orders/${DOC}`, {
  method: 'PATCH', headers: json,
  body: JSON.stringify({ processingDate: '2026-11-20', customerDeliveryDate: '2026-11-30', version: 2, ...extra }),
}, { DB });
const so = () => tables.mfg_sales_orders![0]!;
type Body = { error: string; problems: Array<{ code: string; field?: string; message: string }> };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T02:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('header edit: setting a Processing Date', () => {
  test('refused below 50%, naming paid vs needed', async () => {
    const res = await setDate(world({ status: 'CONFIRMED', proc: null, paidSen: 200_00 }));
    expect(res.status).toBe(422);
    const body = await res.json() as Body;
    const dep = body.problems.find((p) => p.field === 'Deposit')!;
    expect(dep.code).toBe('processing_date_unpaid');
    expect(dep.message).toBe('Deposit RM 200.00 of RM 250.00 needed (50%) before a Processing Date can be set');
    expect(so().processing_date).toBeNull();
  });

  test('allowed at 50%', async () => {
    expect((await setDate(world({ status: 'CONFIRMED', proc: null, paidSen: 250_00 }))).status).toBe(200);
  });

  test('allowed when the payment keyed in the same save brings it to 50% (pendingDepositSen)', async () => {
    const app = world({ status: 'CONFIRMED', proc: null, paidSen: 100_00 });
    expect((await setDate(app, { pendingDepositSen: 150_00 })).status).toBe(200);
  });

  test("every other company keeps Houzs's behaviour: no money gate", async () => {
    expect((await setDate(world({ status: 'CONFIRMED', proc: null, paidSen: 0, companyCode: '2990' }))).status).toBe(200);
  });
});

describe('/status: Draft -> Confirmed with a date, and Proceed', () => {
  test('a draft carrying a Processing Date is not confirmed into the proceed stage below 50%', async () => {
    const res = await status(world({ status: 'DRAFT', proc: '2026-11-20', paidSen: 0 }), 'CONFIRMED', 'DRAFT');
    expect(res.status).toBe(422);
    const body = await res.json() as Body;
    expect(body.problems.map((p) => p.message)).toContain('Deposit RM 0.00 of RM 250.00 needed (50%) before this order can be proceeded');
    expect(so().status).toBe('DRAFT');
  });

  test('Proceed (IN_PRODUCTION) is refused below 50%', async () => {
    const res = await status(world({ status: 'CONFIRMED', proc: '2026-11-20', paidSen: 249_99 }), 'IN_PRODUCTION', 'CONFIRMED');
    expect(res.status).toBe(422);
    expect(so().status).toBe('CONFIRMED');
  });

  test('Proceed is allowed at 50%', async () => {
    const res = await status(world({ status: 'CONFIRMED', proc: '2026-11-20', paidSen: 250_00 }), 'IN_PRODUCTION', 'CONFIRMED');
    expect(res.status).toBe(200);
    expect(so().status).toBe('IN_PRODUCTION');
  });

  test('a draft with no dates still confirms with nothing paid', async () => {
    expect((await status(world({ status: 'DRAFT', proc: null, paidSen: 0 }), 'CONFIRMED', 'DRAFT')).status).toBe(200);
  });
});

describe('the other doors carry the same rule (wiring)', () => {
  const raw = soRouterSource();
  test('create: a Processing Date on create is weighed against the money the create brings', () => {
    const core = raw.slice(raw.indexOf('async function createSalesOrderCore('));
    expect(core).toContain("companyCode: c.get('companyCode'), act: 'processing_date', totalSen: grandTotal,");
    expect(core).toContain('paidSen: posPaymentsTotalSen ?? Math.max(num(body.pendingDepositSen), num(body.depositSen)),');
    expect(core).toContain('if (depositRefusal) pricedGateProblems.push(depositRefusal);');
  });
  test('/validate tells the form before saving, create and edit', () => {
    const v = raw.slice(raw.indexOf("mfgSalesOrders.post('/validate'"));
    expect(v).toContain("await carresDepositProblemForDoc(c.get('supabase'), editDoc, depositCompany, 'processing_date', pendingDepositOf(body))");
    expect(v).toContain('paidSen: pendingDepositOf(body),');
  });
  test('amendment approval that sets a new Processing Date', () => {
    const am = readFileSync(new URL('../src/scm/routes/so-amendments.ts', import.meta.url), 'utf8');
    expect(am).toContain("await carresDepositProblemForDoc(sb, amendment.so_doc_no, c.get('companyCode'), 'processing_date')");
  });
});
