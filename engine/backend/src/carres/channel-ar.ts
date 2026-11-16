// Carres: the debtor control by channel (Chew 2026-11-16 「需要分欠款户口，这样对账全部都比较容易」;
// Finance MASTER §0.0 ruling 2). A customer's money sits on the debtor control of the
// order's channel: Subscription when the order's Sale type is Subscription, otherwise
// the showroom. Both controls are roles (AR_SHOWROOM 300-1000, AR_SUBSCRIPTION 300-3000);
// unset, each is AR, and then nothing here reads anything — the Houzs books are unchanged.
//
// An order is the one source of the channel. A document with no order (an invoice raised
// without one, a note naming none) is the showroom's. A read that fails books on AR
// (300-0000 Trade Debtors), where the aging and the control check still show it.

import type { RoleCodes } from '../acc/rules';

/** True when this company splits its debtors by channel. */
export const channelArOn = (roles: RoleCodes): boolean =>
  roles.AR_SHOWROOM !== roles.AR || roles.AR_SUBSCRIPTION !== roles.AR;

/** The debtor control for an order's Sale type. */
export const arForSaleType = (roles: RoleCodes, saleType: string | null | undefined): string =>
  String(saleType ?? '').trim().toLowerCase() === 'subscription' ? roles.AR_SUBSCRIPTION : roles.AR_SHOWROOM;

/** Every customer debtor control the company books on — AR first, then the channels, no repeats. */
export const arControlCodes = (roles: RoleCodes): string[] =>
  [...new Set([roles.AR, roles.AR_SHOWROOM, roles.AR_SUBSCRIPTION].filter(Boolean))];

/** The roles with AR replaced by the given control, for the line builders in acc/rules.ts. */
export const withAr = (roles: RoleCodes, ar: string): RoleCodes => (ar === roles.AR ? roles : { ...roles, AR: ar });

const logged = (what: string, reason: string): void => {
  /* eslint-disable-next-line no-console */
  console.error(`[carres/channel-ar] ${what} — booking on Trade Debtors:`, reason);
};

/** The debtor control for an order, by its doc no. */
export async function arForOrder(sb: any, roles: RoleCodes, companyId: number | null, soDocNo: string | null | undefined): Promise<string> {
  if (!channelArOn(roles)) return roles.AR;
  const docNo = String(soDocNo ?? '').trim();
  if (!docNo) return roles.AR_SHOWROOM;
  let q = sb.from('mfg_sales_orders').select('sale_type').eq('doc_no', docNo);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q.maybeSingle();
  if (error) { logged(`order ${docNo}`, error.message); return roles.AR; }
  return arForSaleType(roles, (data as { sale_type?: string | null } | null)?.sale_type);
}

/** The debtor control for a sales invoice — its order's. By id or by number. */
export async function arForInvoice(
  sb: any, roles: RoleCodes, companyId: number | null, si: { id?: string | null; number?: string | null },
): Promise<string> {
  if (!channelArOn(roles)) return roles.AR;
  if (!si.id && !si.number) return roles.AR_SHOWROOM;
  let q = sb.from('sales_invoices').select('so_doc_no');
  q = si.id ? q.eq('id', si.id) : q.eq('invoice_number', si.number);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q.maybeSingle();
  if (error) { logged(`invoice ${si.id ?? si.number}`, error.message); return roles.AR; }
  return arForOrder(sb, roles, companyId, (data as { so_doc_no?: string | null } | null)?.so_doc_no);
}

/** The debtor control for a refund's or a note's source: an order (SO) or an invoice (SI, by number). */
export async function arForSource(
  sb: any, roles: RoleCodes, companyId: number | null, type: string | null | undefined, docNo: string | null | undefined,
): Promise<string> {
  const t = String(type ?? '').toUpperCase();
  if (t === 'SI') return arForInvoice(sb, roles, companyId, { number: docNo ?? null });
  return arForOrder(sb, roles, companyId, docNo);
}
