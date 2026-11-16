// Carres (CARRES_FINANCE_RULES on): an invoiced order is refunded through a credit note, not by cancelling the
// invoice (Chew, docs/finance/MASTER.md §0.0 ruling 9). A live invoice may be refunded up to the posted credit
// notes knocked off it; without one it is refused with the way forward. With the switch off, Houzs's rule stands.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { refundSourceHandler } from '../src/scm/lib/pv-refund';

const CO = 1;
const SI = { id: 'si-1', invoice_number: 'CR-SI-2611-001', company_id: CO, status: 'SENT', debtor_name: 'Ali', debtor_code: 'D001', migrated_no_stock: false };

function world(credit: Row[] = [], notes: Row[] = []) {
  const sb = fakeSb({
    sales_invoices: [{ ...SI }],
    sales_invoice_payments: [{ id: 'sp1', sales_invoice_id: 'si-1', paid_at: '2026-11-01', method: 'transfer', merchant_provider: null, amount_sen: 80000, company_id: CO }],
    journal_entries: [{ id: 'je-si', je_no: 'CR-JE-2611-001', company_id: CO, source_type: 'SIPAY', source_doc_no: 'sp1', reversed: false, entry_date: '2026-11-01' }],
    payment_vouchers: [],
    acc_credit_note_allocations: credit,
    acc_credit_notes: notes,
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: 'HOUZS' }] as never);
    await next();
  });
  app.get('/refund-source', refundSourceHandler as never);
  return app;
}

const read = async (app: Hono, on: boolean) =>
  (await (await app.request(`/refund-source?type=SI&docNo=${SI.invoice_number}`, {}, on ? { CARRES_FINANCE_RULES: 'on' } : {})).json()) as { source: Record<string, any> };

describe('refund on a credited live invoice', () => {
  test('refunds up to the posted credit notes knocked off it', async () => {
    const app = world(
      [{ id: 'a1', company_id: CO, note_id: 'cn-1', sales_invoice_id: 'si-1', applied_sen: 30000 }],
      [{ id: 'cn-1', company_id: CO, status: 'POSTED' }],
    );
    const { source } = await read(app, true);
    expect(source).toMatchObject({ eligible: true, bookedSen: 80000, refundableSen: 30000, reason: null });
  });

  test('a draft credit note does not open a refund', async () => {
    const app = world(
      [{ id: 'a1', company_id: CO, note_id: 'cn-1', sales_invoice_id: 'si-1', applied_sen: 30000 }],
      [{ id: 'cn-1', company_id: CO, status: 'DRAFT' }],
    );
    const { source } = await read(app, true);
    expect(source.eligible).toBe(false);
    expect(source.reason).toMatch(/Knock a credit note off it first/);
  });

  test('with the switch off, a live invoice must be cancelled first, as in Houzs', async () => {
    const app = world(
      [{ id: 'a1', company_id: CO, note_id: 'cn-1', sales_invoice_id: 'si-1', applied_sen: 30000 }],
      [{ id: 'cn-1', company_id: CO, status: 'POSTED' }],
    );
    const { source } = await read(app, false);
    expect(source.eligible).toBe(false);
    expect(source.reason).toMatch(/still stands/);
  });
});
