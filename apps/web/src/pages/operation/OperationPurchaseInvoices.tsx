import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { FinanceKpi } from "@/components/FinanceKpi";
import ListPageShell from "@/components/ListPageShell";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Tabs from "@/components/kit/Tabs";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/fmt-date";
import { BILL_STATUS_WORD, money, word } from "@/pages/finance/payables/payables-words";
import ModuleHeader from "./components/ModuleHeader";

/**
 * PURCHASE INVOICES — the supplier bills inside Purchasing.
 *
 * Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): purchasing staff see
 * purchase invoices and what is paid on them inside the purchasing area, Houzs
 * way. Jess's rules that Finance alone shows bills and that Operations carries no
 * finance fields are overturned; Jess was not part of this decision.
 *
 * ONE LEDGER: every row is Finance's own bill, read through 0721's
 * `purchasing_supplier_bill_list` with Finance's own paid figure. The list
 * writes nothing; the principal gets a link to Finance → Bills.
 *
 * ENTERING (Chew, Finance, WhatsApp 2026-10-23, via YH): "New bill" and "Bill
 * from GRN" open OperationPurchaseInvoiceNew, which saves a draft through
 * Finance's own bill door (0721), and saving posts it (Q8, Chew 2026-10-26,
 * Houzs way). Cancelling and paying a bill stay
 * Finance's (finance + principal in the database).
 */
type BillRow = {
  id: string;
  bill_no: string | null;
  status: string;
  supplier_name: string;
  supplier_invoice_no: string;
  bill_date: string;
  due_date: string | null;
  po_id: string | null;
  total_amount: number | string;
  paid_total: number | string;
  unpaid: number | string | null;
  /** 2026-10-26: the caller's own bill with no payment against it, which it may change (Houzs piLocked). */
  mine: boolean;
};

/* Houzs's pills (PurchaseInvoicesListV2.tsx:1137-1145). A bill stores draft, confirmed or
   cancelled; Partial and Paid read Finance's own paid figure. Carres has no On Hold. */
export const PI_VIEWS = [
  { value: "all", label: "All" }, { value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" },
  { value: "partial", label: "Partial" }, { value: "paid", label: "Paid" }, { value: "cancelled", label: "Cancelled" },
] as const;
type PiView = (typeof PI_VIEWS)[number]["value"];
export function piViewOf(r: Pick<BillRow, "status" | "paid_total" | "unpaid">): Exclude<PiView, "all"> {
  if (r.status === "draft" || r.status === "cancelled") return r.status;
  if (Number(r.paid_total) <= 0) return "confirmed";
  return Number(r.unpaid) > 0 ? "partial" : "paid";
}
const sum = (rows: BillRow[], of: (r: BillRow) => number | string | null) =>
  rows.reduce((total, r) => total + Number(of(r) ?? 0), 0);

export default function OperationPurchaseInvoices() {
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  const query = useQuery<{ rows: BillRow[] }>({
    queryKey: ["operation", "purchase-invoices"],
    queryFn: () => apiFetch("/api/operation/purchase-invoices"),
  });
  const [view, setView] = useState<PiView>("all");
  const all = query.data?.rows ?? [];
  const rows = view === "all" ? all : all.filter((r) => piViewOf(r) === view);
  const live = all.filter((r) => r.status !== "cancelled");
  // Column order follows Houzs PI_DEFAULT_COLUMN_KEYS (pi-list-export.ts:114-118), then its Due, Status and Owed.
  const columns = useMemo<DataGridColumn<BillRow>[]>(() => [
    { key: "bill", label: "PI No", width: 130, accessor: (r) => r.bill_no ?? "" },
    { key: "invoice", label: "Supplier Invoice No", width: 160, accessor: (r) => r.supplier_invoice_no },
    { key: "date", label: "PI Doc Date", width: 120, accessor: (r) => fmtDate(r.bill_date), dateValue: (r) => r.bill_date, filterType: "date" },
    { key: "supplier", label: "Supplier", width: 200, wrap: true, accessor: (r) => r.supplier_name,
      filterValue: (r) => r.supplier_name, filterType: "enum" },
    { key: "total", label: "Total", width: 120, align: "right", accessor: (r) => money(r.total_amount) },
    { key: "paid", label: "Paid", width: 120, align: "right", accessor: (r) => money(r.paid_total) },
    { key: "unpaid", label: "Owed", width: 120, align: "right", accessor: (r) => money(r.unpaid) },
    { key: "due", label: "Due Date", width: 120, accessor: (r) => (r.due_date ? fmtDate(r.due_date) : "") },
    { key: "status", label: "Status", width: 110, accessor: (r) => word(BILL_STATUS_WORD, r.status),
      filterValue: (r) => word(BILL_STATUS_WORD, r.status), filterType: "enum" },
    { key: "po", label: "PO No", width: 130, accessor: (r) => r.po_id ?? "" },
  ], []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleHeader destinationHeader testId="purchase-invoices-destination-header" word="Purchase Invoices"
        docTitle="Purchase Invoices · Carres"
        right={
          <span className="flex items-center gap-2">
            {/* 0721 (Chew 2026-10-23): Purchasing enters a bill, Houzs's New and From GRN. */}
            <Button variant="neutral" onClick={() => navigate("/operation/purchase-invoices/from-grn")}
              data-testid="purchase-invoice-from-grn">From GRN</Button>
            <Button variant="primary" icon="add" onClick={() => navigate("/operation/purchase-invoices/new")}
              data-testid="purchase-invoice-new">New Purchase Invoice</Button>
            {role === "principal" && <Button variant="neutral" onClick={() => navigate("/finance/bills")}>Open in Finance</Button>}
          </span>
        } />
      <div className="grid shrink-0 grid-cols-2 gap-3 px-4 pt-3 md:grid-cols-4">
        <FinanceKpi testId="pi-kpi-count" label="Total PIs" value={query.data ? String(all.length) : null} />
        <FinanceKpi testId="pi-kpi-billed" label="Billed" value={query.data ? money(sum(live, (r) => r.total_amount)) : null} />
        <FinanceKpi testId="pi-kpi-owed" label="Owed" tone="danger" value={query.data ? money(sum(live, (r) => r.unpaid)) : null} />
        <FinanceKpi testId="pi-kpi-paid" label="Paid" tone="ok" value={query.data ? money(sum(live, (r) => r.paid_total)) : null} />
      </div>
      <div className="shrink-0 px-4 pt-2">
        <Tabs label="Purchase Invoices view" value={view} onValueChange={(v) => setView(v as PiView)}
          tabs={PI_VIEWS.map((v) => ({ value: v.value, label: `${v.label} · ${v.value === "all" ? all.length : all.filter((r) => piViewOf(r) === v.value).length}` }))} />
      </div>
      <ListPageShell register>
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowTestId={(r) => `purchase-invoice-row-${r.id}`}
          // 2026-10-26 (YH, Houzs): your own bill opens to be changed until a payment.
          onRowClick={(r) => { if (r.mine) navigate(`/operation/purchase-invoices/${r.id}/edit`); }}
          storageKey="carres.operation.purchase-invoices.v2"
          appearance="reference"
          fillColumn="supplier"
          exportName="Purchase Invoices"
          groupBanner={false}
          stickyIdentity
          isLoading={query.isLoading}
          searchPlaceholder="Search PI no, supplier invoice or PO…"
          emptyMessage="No purchase invoice yet. Enter one with New Purchase Invoice or From GRN."
          errorState={query.isError && !query.data ? (
            <div role="alert">
              <EmptyState title="Could not be loaded" detail="The purchase invoices could not be read."
                action={<Button variant="neutral" onClick={() => void query.refetch()}>Try again</Button>} />
            </div>
          ) : undefined}
        />
      </ListPageShell>
    </div>
  );
}
