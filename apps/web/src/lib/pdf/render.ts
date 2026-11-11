import { type ReactElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { SalesOrderTemplate } from "./sales-order-template";
import { InvoiceTemplate } from "./invoice-template";
import { DoTemplate } from "./do-template";
import { PoTemplate } from "./po-template";
import { PickupEventTemplate } from "./pickup-event-template";
import { ReceiptTemplate } from "./receipt-template";
import { CreditNoteTemplate } from "./credit-note-template";
import { ExtensionAgreementTemplate } from "./extension-agreement-template";
import { LoanNoteTemplate } from "./loan-note-template";
import { OtherDebtorInvoiceTemplate } from "./other-debtor-invoice-template";
import { PaymentVoucherTemplate } from "./payment-voucher-template";
import { RegisterListTemplate, type RegisterListTemplateData } from "./register-list-template";
import { registerNotoSansSC } from "./fonts/noto";
import type { DoTemplateData, ExtensionAgreementTemplateData, InvoiceTemplateData, LoanNoteTemplateData, OtherDebtorInvoiceTemplateData, PaymentVoucherTemplateData, PoTemplateData, ReceiptTemplateData, SalesOrderTemplateData } from "./types";
import type { PickupEventPrintPayload } from "@/lib/queries";
import type { CreditNotePrintData } from "@carres/shared/schemas/finance-credit-note";

/** All four PDFs share the render pipeline; only the template differs. */
async function toBlob(element: ReactElement): Promise<Blob> {
  registerNotoSansSC();
  return pdf(element).toBlob();
}

export function renderSalesOrderPdf(data: SalesOrderTemplateData): Promise<Blob> {
  return toBlob(SalesOrderTemplate(data));
}


export function renderInvoicePdf(data: InvoiceTemplateData): Promise<Blob> {
  return toBlob(InvoiceTemplate(data));
}

/** Other debtor invoice (ARI, 0478) — rendered on demand from the detail read. */
export function renderOtherDebtorInvoicePdf(data: OtherDebtorInvoiceTemplateData): Promise<Blob> {
  return toBlob(OtherDebtorInvoiceTemplate(data));
}

/** Payment voucher (PV) — rendered on demand from the voucher document. */
export function renderPaymentVoucherPdf(data: PaymentVoucherTemplateData): Promise<Blob> {
  return toBlob(PaymentVoucherTemplate(data));
}

/** Balance job (0184) — payment receipt, one per ledger entry. Rendered
 *  on-demand from the order_payments row + order (no bucket persistence yet). */
export function renderReceiptPdf(data: ReceiptTemplateData): Promise<Blob> {
  return toBlob(ReceiptTemplate(data));
}

/** 0627 — the Credit Note, read from the API's print-data (Finance owns it). */
export function renderCreditNotePdf(data: CreditNotePrintData): Promise<Blob> {
  return toBlob(CreditNoteTemplate(data));
}

/** Migration 0196 — storage delivery-extension agreement (the two Google Forms).
 *  Rendered on-demand from the ops_order_control extension_* fields + order. */
export function renderExtensionAgreementPdf(
  data: ExtensionAgreementTemplateData,
): Promise<Blob> {
  return toBlob(ExtensionAgreementTemplate(data));
}

export function renderDoPdf(data: DoTemplateData): Promise<Blob> {
  return toBlob(DoTemplate(data));
}




/** Migration 0242 — ON LOAN delivery-note (the customer signs on hand-over of a
 *  loaner). Rendered on-demand from the ops_sofa_loans row + order. */
export function renderLoanNotePdf(data: LoanNoteTemplateData): Promise<Blob> {
  return toBlob(LoanNoteTemplate(data));
}

/** A Register's CURRENT VIEW as a document — not a business document, so it
 *  carries no letterhead, terms or signature block. Its cells are the same
 *  derived text the Excel export writes. */
export function renderRegisterListPdf(data: RegisterListTemplateData): Promise<Blob> {
  return toBlob(RegisterListTemplate(data));
}



export function renderPoPdf(data: PoTemplateData): Promise<Blob> {
  return toBlob(PoTemplate(data));
}



/** Task 13 (2026-05-15) — pickup-event DO render (supplier / partner /
 *  operation reprint). Data assembled server-side by
 *  `/api/pickup-events/:id/print` (RLS-scoped per role via 0107 RPC);
 *  browser renders via @react-pdf/renderer. */
export function renderPickupEventPdf(
  data: PickupEventPrintPayload,
): Promise<Blob> {
  return toBlob(PickupEventTemplate(data));
}

