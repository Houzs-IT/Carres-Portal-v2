/* Carres — the four address lines reach every document (owner bug, 14 Nov 2026; engine migration 2011).
 *
 * A Sales Order holds address lines 1-4. The Delivery Order, Sales Invoice and Delivery Return used to hold
 * two, and the SO -> DO conversion kept line 2 and dropped 3 + 4 whenever line 2 was used — so the printed
 * DO, the invoice and the return all went out with an incomplete address. These tests pin the paper and the
 * forms: every non-empty line prints, the forms offer four inputs, and a two-line document is unchanged.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { SoAddressLines } from '../components/SoAddressLines';
import { deliveryReturnPdfBundle } from '../lib/printDocumentPdf';
import { buildDoHeaderBody, seedDoHeaderForm } from '../vendor/scm/lib/do-header-form';

type JsPdf = import('jspdf').jsPDF;

const L1 = 'Lot1Jalan';
const L2 = 'Unit2Suria';
const L3 = 'Tower3Maju';
const L4 = 'Blok4Indah';

/** Every string drawn on the page, joined — an address line may be wrapped onto two draws, so the test reads
 *  the whole sheet rather than one draw. */
function captureText(doc: JsPdf): () => string {
  const drawn: string[] = [];
  const original = doc.text.bind(doc);
  vi.spyOn(doc, 'text').mockImplementation(((...args: Parameters<typeof doc.text>) => {
    const [value] = args;
    for (const line of Array.isArray(value) ? value.map(String) : [String(value)]) drawn.push(line);
    return original(...args);
  }) as typeof doc.text);
  return () => drawn.join(' ');
}

async function newDoc() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  return { doc, autoTable, text: captureText(doc) };
}

const DO_HEADER = {
  do_number: 'CR-DO-2611-001', status: 'DISPATCHED', do_date: '2026-11-14',
  so_doc_no: 'CR-SO-2611-001', debtor_code: 'C-1', debtor_name: 'Test Customer',
  expected_delivery_at: '2026-11-15', dispatched_at: null, signed_at: null,
  delivered_at: null, driver_name: null, vehicle: null,
  city: 'Klang', state: 'Selangor', postcode: '41000', phone: null, notes: null,
  m3_total_milli: null,
};
const DO_ITEMS = [{ item_code: 'DO-A', description: 'Bedframe', qty: 1, m3_milli: null, unit_price_sen: 0 }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('printed documents carry every non-empty address line', () => {
  test('the Delivery Order prints lines 1, 2, 3 and 4', async () => {
    const { doc, autoTable, text } = await newDoc();
    const { renderDeliveryOrderInto } = await import('../vendor/scm/lib/delivery-order-pdf');
    await renderDeliveryOrderInto(doc, autoTable, { ...DO_HEADER, address1: L1, address2: L2, address3: L3, address4: L4 } as never, DO_ITEMS as never);
    const sheet = text();
    for (const line of [L1, L2, L3, L4]) expect(sheet).toContain(line);
  });

  test('a two-line Delivery Order (pre-2011 row) prints as before — no blank or "null" line', async () => {
    const { doc, autoTable, text } = await newDoc();
    const { renderDeliveryOrderInto } = await import('../vendor/scm/lib/delivery-order-pdf');
    await renderDeliveryOrderInto(doc, autoTable, { ...DO_HEADER, address1: L1, address2: L2 } as never, DO_ITEMS as never);
    const sheet = text();
    expect(sheet).toContain(L1);
    expect(sheet).toContain(L2);
    expect(sheet).not.toContain('null');
    expect(sheet).not.toMatch(/, ,/);
  });

  test('the Sales Invoice prints lines 1, 2, 3 and 4', async () => {
    const { doc, autoTable, text } = await newDoc();
    const { renderSalesInvoiceInto } = await import('../vendor/scm/lib/sales-invoice-pdf');
    await renderSalesInvoiceInto(doc, autoTable, {
      invoice_number: 'CR-SI-2611-001', status: 'SENT', so_doc_no: 'CR-SO-2611-001',
      debtor_code: 'C-1', debtor_name: 'Test Customer', invoice_date: '2026-11-14',
      due_date: null, currency: 'MYR', subtotal_sen: 0, discount_sen: 0,
      tax_sen: 0, total_sen: 0, paid_sen: 0, notes: null,
      address1: L1, address2: L2, address3: L3, address4: L4, city: 'Klang', state: 'Selangor', postcode: '41000',
    }, [{ item_code: 'SI-A', description: 'Bedframe', qty: 1, unit_price_sen: 0, line_total_sen: 0 }]);
    const sheet = text();
    for (const line of [L1, L2, L3, L4]) expect(sheet).toContain(line);
  });

  test('the Delivery Return prints lines 1, 2, 3 and 4 through the shared bundle', async () => {
    const { header, items } = deliveryReturnPdfBundle({
      deliveryReturn: {
        return_number: 'CR-DR-2611-001', status: 'RECEIVED', return_date: '2026-11-14',
        debtor_name: 'Test Customer', local_total_sen: 0,
        address1: L1, address2: L2, address3: L3, address4: L4,
        city: 'Klang', customer_state: 'Selangor', postcode: '41000',
      },
      items: [],
    });
    expect(header).toMatchObject({ address1: L1, address2: L2, address3: L3, address4: L4 });
    const { doc, autoTable, text } = await newDoc();
    const { renderDeliveryReturnInto } = await import('../vendor/scm/lib/delivery-return-pdf');
    await renderDeliveryReturnInto(doc, autoTable, header as never, items as never);
    const sheet = text();
    for (const line of [L1, L2, L3, L4]) expect(sheet).toContain(line);
  });
});

describe('the document forms offer the SO form\'s four address lines', () => {
  test('SoAddressLines (SI, DR, consignment DO / return forms) renders Address Line 1-4', () => {
    const onChange = vi.fn();
    render(
      <div>
        <SoAddressLines lines={[L1, L2, L3, L4]} onChange={onChange}
          fieldClassName="f" labelClassName="l" inputClassName={() => 'i'} />
      </div>,
    );
    for (const [n, v] of [[1, L1], [2, L2], [3, L3], [4, L4]] as const) {
      expect((screen.getByLabelText(`Address Line ${n}`) as HTMLInputElement).value).toBe(v);
    }
  });

  test('the DO header form seeds and sends lines 3 and 4 (desktop and phone share it)', () => {
    const f = seedDoHeaderForm({ address1: L1, address2: L2, address3: L3, address4: L4 }, '2026-11-14');
    expect([f.address1, f.address2, f.address3, f.address4]).toEqual([L1, L2, L3, L4]);
    const body = buildDoHeaderBody(f, [], { locked: false });
    expect(body).toMatchObject({ address1: L1, address2: L2, address3: L3, address4: L4 });
    // A pre-2011 DO seeds empty lines 3 and 4, never "undefined".
    const old = seedDoHeaderForm({ address1: L1, address2: L2 }, '2026-11-14');
    expect([old.address3, old.address4]).toEqual(['', '']);
  });

  test('an invoiced DO drops lines 3 and 4 from its PATCH like the rest of the address', () => {
    const f = seedDoHeaderForm({ address1: L1, address3: L3, address4: L4 }, '2026-11-14');
    const body = buildDoHeaderBody(f, [], { locked: true });
    expect(body).not.toHaveProperty('address1');
    expect(body).not.toHaveProperty('address3');
    expect(body).not.toHaveProperty('address4');
  });
});
