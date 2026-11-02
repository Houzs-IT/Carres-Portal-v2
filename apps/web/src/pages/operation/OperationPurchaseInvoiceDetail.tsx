// design-standard: not-a-list-page — one bill's read page; its lines table is the document's own.
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Loading from "@/components/kit/Loading";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import { Facts } from "@/pages/finance/payables/PayablesParts";
import { BILL_STATUS_WORD, money, word } from "@/pages/finance/payables/payables-words";
import SalesOrderTabs from "./SalesOrderTabs";

/**
 * ONE PURCHASE INVOICE, read only (`/operation/purchase-invoices/:id`), and the
 * lines under its register row. Follows Houzs PurchaseInvoiceDetailV2.tsx and
 * PurchaseInvoicesListV2.tsx:1318. Same people as the list; it writes nothing.
 */
type BillDetail = {
  bill: {
    id: string; bill_no: string | null; status: string; supplier_name: string; supplier_invoice_no: string;
    bill_date: string; due_date: string | null; po_id: string | null;
    total_amount: number | string; paid_total: number | string; unpaid: number | string | null; mine: boolean;
  };
  lines: Array<{
    line_no: number; grn_no: string | null; sku: string | null; description: string | null;
    qty: number | null; unit_price: number | null; amount: number | null;
  }>;
};

function useBillDetail(id: string) {
  return useQuery<BillDetail>({
    queryKey: ["operation", "purchase-invoices", id, "detail"],
    queryFn: () => apiFetch(`/api/operation/purchase-invoices/${id}/detail`),
  });
}

function LinesTable({ lines }: { lines: BillDetail["lines"] }) {
  if (lines.length === 0) return <p className="text-body">No lines on this bill.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body" data-testid="purchase-invoice-lines">
        <thead>
          <tr className="text-left text-meta text-kit-slate-11">
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 pr-2 font-medium">SKU</th>
            <th className="py-1 pr-2 font-medium">GRN No</th>
            <th className="py-1 pr-2 text-right font-medium">Qty</th>
            <th className="py-1 pr-2 text-right font-medium">Unit Price</th>
            <th className="py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lines.map((l) => (
            <tr key={l.line_no} className="border-t border-kit-slate-4">
              <td className="py-1 pr-2">{l.description ?? l.sku ?? ""}</td>
              <td className="py-1 pr-2 font-mono">{l.sku ?? ""}</td>
              <td className="py-1 pr-2 font-mono">{l.grn_no ?? ""}</td>
              <td className="py-1 pr-2 text-right">{l.qty ?? ""}</td>
              <td className="py-1 pr-2 text-right">{l.unit_price == null ? "" : money(l.unit_price)}</td>
              <td className="py-1 text-right">{l.amount == null ? "" : money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The lines under a register row. */
export function PurchaseInvoiceLines({ id }: { id: string }) {
  const q = useBillDetail(id);
  if (q.isLoading) return <Loading variant="skeleton" label="Loading the lines" />;
  if (!q.data) {
    return (
      <div role="alert" className="flex items-center gap-2 text-body">
        The lines could not be read.
        <Button variant="neutral" onClick={() => void q.refetch()}>Try again</Button>
      </div>
    );
  }
  return <LinesTable lines={q.data.lines} />;
}

export default function OperationPurchaseInvoiceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const q = useBillDetail(id);
  if (q.isLoading) return <div className="p-4"><Loading variant="skeleton" label="Loading the bill" /></div>;
  if (!q.data) {
    return (
      <div role="alert">
        <EmptyState title="This bill could not be opened" detail="Try again."
          action={<Button variant="neutral" onClick={() => void q.refetch()}>Try again</Button>} />
      </div>
    );
  }
  const { bill, lines } = q.data;
  const facts: Array<[string, string]> = [
    ["Supplier", bill.supplier_name],
    ["Supplier Invoice No", bill.supplier_invoice_no],
    ["PI Doc Date", fmtDate(bill.bill_date)],
    ["Due Date", bill.due_date ? fmtDate(bill.due_date) : "Not recorded"],
    ["Status", word(BILL_STATUS_WORD, bill.status)],
    ["PO No", bill.po_id ?? "Not recorded"],
    ["Total", money(bill.total_amount)],
    ["Paid", money(bill.paid_total)],
    ["Owed", money(bill.unpaid)],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="purchase-invoice-detail">
      <SalesOrderTabs
        identity={bill.bill_no ?? "Draft Purchase Invoice"}
        customer={bill.supplier_name}
        backTo="/operation?tab=purchase-invoices"
        backLabel="Purchase Invoices"
        right={bill.mine
          ? <Button variant="primary" onClick={() => navigate(`/operation/purchase-invoices/${bill.id}/edit`)}
              data-testid="purchase-invoice-change">Change</Button>
          : undefined}
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="flex max-w-[1100px] flex-col gap-4">
          <Facts title="Bill">
            <dl className="grid grid-cols-1 gap-3 text-body md:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label}><dt className="text-meta text-kit-slate-11">{label}</dt><dd className="break-words">{value}</dd></div>
              ))}
            </dl>
          </Facts>
          <Facts title="Lines"><LinesTable lines={lines} /></Facts>
        </div>
      </div>
    </div>
  );
}
