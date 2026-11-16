// Carres: an invoiced order is refunded through a credit note, not by cancelling its invoice (Chew,
// docs/finance/MASTER.md §0.0 ruling 9 and §3.1). Finance knocks a credit note (default line 520-0000 DISCOUNT
// ALLOWED, the SALES_RETURNS role) off the invoice, then a Customer Refund voucher pays back up to that credit.
// Read by scm/lib/pv-refund.ts while CARRES_FINANCE_RULES is on.
import { siCreditNotesSen } from '../scm/lib/si-credit-notes';

/** The credit notes knocked off one live invoice: the most a refund on it may pay back. null = could not read. */
export async function creditedRefundCap(sb: any, companyId: number, siId: string): Promise<number | null> {
  return siCreditNotesSen(sb, companyId, siId);
}
