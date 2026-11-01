import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { InvoiceRegisterRow } from "@carres/shared/payment-invoice-register";
import { soRemaining } from "@carres/shared/payment-invoice-register";
import type { OrderActionTone } from "@carres/shared";
import { FinanceKpi } from "@/components/FinanceKpi";
import ListPageShell from "@/components/ListPageShell";
import Drawer from "@/components/kit/Drawer";
import SectionHeader from "@/components/kit/SectionHeader";
import StatusPill from "@/components/kit/StatusPill";
import Tabs from "@/components/kit/Tabs";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";
import { useInvoiceRegister } from "@/lib/queries";
import ModuleHeader from "@/pages/operation/components/ModuleHeader";
import NewSalesInvoiceDialog from "./NewSalesInvoiceDialog";

/**
 * SALES INVOICES — the Houzs list (YH, 30 Oct 2026; Weisiang, 1 Nov 2026; Houzs-ERP
 * frontend/src/pages/scm-v2/SalesInvoicesListV2.tsx). It lists the invoice
 * register's `sales` rows, a row opens the quick view, and the SI No opens that
 * invoice on the Monitor, where every invoice action already lives. Storage
 * invoices stay on the Monitor.
 */
type Bucket = "draft" | "sent" | "partial" | "paid" | "cancelled";
const STATUS: Record<Bucket, { word: string; tone: OrderActionTone }> = {
  draft: { word: "Draft", tone: "warning" },
  sent: { word: "Submitted", tone: "warning" },
  partial: { word: "Partially paid", tone: "warning" },
  paid: { word: "Paid", tone: "success" },
  cancelled: { word: "Cancelled", tone: "neutral" },
};
const TABS = [
  ["all", "All"], ["sent", "Sent"], ["partial", "Partial"], ["paid", "Paid"], ["cancelled", "Cancelled"],
] as const;
type Tab = (typeof TABS)[number][0];

const invoiceHref = (r: InvoiceRegisterRow) => `/finance/monitor?invoice=${r.id}`;
const invoiceNoOf = (r: InvoiceRegisterRow) => r.invoice_no ?? "Draft, no number yet";
const totalOf = (r: InvoiceRegisterRow) => Number(r.amount) + Number(r.tax_amount);
const paidOf = (r: InvoiceRegisterRow) => Number(r.orders?.paid ?? 0);
const refOf = (r: InvoiceRegisterRow) => [r.orders?.source_ref ?? []].flat().join(", ");
const dateOf = (r: InvoiceRegisterRow) => (r.issued_at ? fmtDate(r.issued_at) : "");
const soOf = (r: InvoiceRegisterRow) => `SO-${r.orders?.so}`;
const phoneOf = (r: InvoiceRegisterRow) => r.orders?.customer_phone ?? "";
/** Money is held on the order, so a tile counts each order once. */
const perOrder = (rows: InvoiceRegisterRow[], of: (r: InvoiceRegisterRow) => number) =>
  [...new Map(rows.map((r) => [r.order_id, r])).values()].reduce((sum, r) => sum + of(r), 0);

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="text-label text-muted-foreground">{label}</div><div className="text-body">{value || "Not provided"}</div></div>;
}

function QuickView({ row, owed, onClose }: { row: InvoiceRegisterRow | null; owed: number; onClose: () => void }) {
  const lines = row ? (row.snapshot_lines ?? row.orders?.order_lines ?? []) : [];
  const payments = row?.orders?.order_payments ?? [];
  return <Drawer open={row !== null} onOpenChange={(open) => { if (!open) onClose(); }} variant="quick-view"
    title={row ? invoiceNoOf(row) : ""} footer={row ? <Link className="btn-secondary" to={invoiceHref(row)}>Open on Monitor</Link> : undefined}>
    {row && <div className="flex flex-col gap-4">
      <section><SectionHeader title="Customer" />
        <div className="grid grid-cols-2 gap-3"><Field label="Customer name" value={row.orders?.customer_name ?? ""} /><Field label="Phone" value={phoneOf(row)} /></div>
      </section>
      <section><SectionHeader title="Invoice info" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice date" value={dateOf(row)} /><Field label="SO No." value={soOf(row)} />
          <Field label="Ref No." value={refOf(row)} /><Field label="Total" value={rm(totalOf(row))} />
          <Field label="Paid on SO" value={rm(paidOf(row))} /><Field label="Outstanding on SO" value={rm(owed)} />
        </div>
      </section>
      <section><SectionHeader title={`Line items · ${lines.length}`} />
        <ul className="text-body">{lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-1">
          <span>{l.sku ?? "Item"} × {Number(l.qty)}</span><span>{rm(Number(l.qty) * Number(l.unit_price ?? 0))}</span>
        </li>)}</ul>
      </section>
      <section><SectionHeader title="Payments" />
        {payments.length === 0 ? <p className="text-body text-muted-foreground">No payments yet.</p>
          : <ul className="text-body">{payments.map((p) => <li key={p.id} className={`flex justify-between gap-3 py-1 ${p.voided_at ? "line-through text-muted-foreground" : ""}`}>
              <span>{p.receipt_no ?? "No receipt number"} · {fmtDate(p.paid_on)}{p.method ? ` · ${p.method}` : ""}</span><span>{rm(Number(p.amount))}</span>
            </li>)}</ul>}
      </section>
    </div>}
  </Drawer>;
}

export default function SalesInvoices() {
  const query = useInvoiceRegister();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<InvoiceRegisterRow | null>(null);
  const all = query.data;
  const sales = useMemo(() => (all ?? []).filter((r) => r.kind === "sales"), [all]);
  // Money is owed on the order, so two invoices of one SO show the same figure.
  const owedBySo = useMemo(() => {
    const byOrder = new Map<string, InvoiceRegisterRow[]>();
    for (const r of all ?? []) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r]);
    return new Map([...byOrder].map(([id, mine]) => [id, soRemaining(mine, id).outstanding]));
  }, [all]);
  const { owedOf, bucketOf, tabOf } = useMemo(() => {
    const owedOf = (r: InvoiceRegisterRow) => owedBySo.get(r.order_id) ?? 0;
    const bucketOf = (r: InvoiceRegisterRow): Bucket => {
      if (r.status === "voided") return "cancelled";
      if (r.status === "draft") return "draft";
      if (owedOf(r) <= 0) return "paid";
      return paidOf(r) > 0 ? "partial" : "sent";
    };
    // Houzs counts a draft under Sent (SalesInvoicesListV2.tsx:200).
    const tabOf = (r: InvoiceRegisterRow): Tab => {
      const b = bucketOf(r);
      return b === "draft" ? "sent" : b;
    };
    return { owedOf, bucketOf, tabOf };
  }, [owedBySo]);
  const rows = useMemo(() => (tab === "all" ? sales : sales.filter((r) => tabOf(r) === tab)), [sales, tab, tabOf]);
  const live = useMemo(() => rows.filter((r) => r.status === "issued"), [rows]);
  const columns = useMemo<DataGridColumn<InvoiceRegisterRow>[]>(() => {
    const word = (r: InvoiceRegisterRow) => STATUS[bucketOf(r)].word;
    return [
      { key: "invoice_no", label: "SI No.", width: 200,
        accessor: (r) => <Link to={invoiceHref(r)} className={`font-semibold hover:underline ${r.status === "voided" ? "line-through" : ""}`} onClick={(e) => e.stopPropagation()}>{invoiceNoOf(r)}</Link>,
        searchValue: invoiceNoOf, filterValue: invoiceNoOf, filterType: "numbering", exportValue: invoiceNoOf },
      { key: "date", label: "Date", width: 140, accessor: dateOf,
        dateValue: (r) => r.issued_at, filterType: "date", exportValue: dateOf },
      { key: "so", label: "SO No.", width: 110, accessor: soOf, searchValue: soOf },
      { key: "customer", label: "Customer", width: 220, accessor: (r) => r.orders?.customer_name ?? "",
        searchValue: (r) => r.orders?.customer_name ?? "", filterValue: (r) => r.orders?.customer_name ?? "", filterType: "enum" },
      { key: "ref", label: "Ref No.", width: 140, accessor: refOf, searchValue: refOf },
      { key: "status", label: "Status", width: 130,
        accessor: (r) => <StatusPill tone={STATUS[bucketOf(r)].tone}>{word(r)}</StatusPill>,
        filterValue: word, filterType: "enum", exportValue: word },
      { key: "owed", label: "Outstanding on SO", width: 160, align: "right",
        accessor: (r) => (r.status === "issued" && owedOf(r) <= 0 ? "Cleared" : rm(owedOf(r))),
        numberValue: owedOf, filterType: "number", exportValue: owedOf },
      { key: "total", label: "Total", width: 140, align: "right", accessor: (r) => rm(totalOf(r)),
        numberValue: totalOf, filterType: "number", exportValue: totalOf },
      { key: "paid", label: "Paid on SO", width: 130, align: "right", defaultHidden: true, accessor: (r) => rm(paidOf(r)),
        numberValue: paidOf, filterType: "number", exportValue: paidOf },
      { key: "phone", label: "Phone", width: 130, defaultHidden: true, accessor: phoneOf, searchValue: phoneOf, exportValue: phoneOf },
    ];
  }, [bucketOf, owedOf]);
  return <div className="flex h-full min-h-0 flex-col">
    <h1 className="sr-only">Sales Invoices</h1>
    <ModuleHeader destinationHeader testId="sales-invoices-destination-header" word="Sales Invoices" docTitle="Sales Invoices · Carres" />
    {query.isError && !query.data
      ? <div role="alert" className="p-6 text-body">
          <p>Sales Invoices could not be loaded. Try again.</p>
          <button className="btn-secondary mt-3" onClick={() => void query.refetch()}>Try again</button>
        </div>
      : <>
          <div className="grid grid-cols-2 gap-3 px-4 pt-3 lg:grid-cols-4">
            <FinanceKpi testId="si-kpi-count" label="Total Invoices" value={String(rows.length)} />
            <FinanceKpi testId="si-kpi-billed" label="Billed" value={rm(live.reduce((s, r) => s + totalOf(r), 0))} />
            <FinanceKpi testId="si-kpi-outstanding" label="Outstanding" tone="danger" value={rm(perOrder(live, owedOf))} />
            <FinanceKpi testId="si-kpi-paid" label="Paid" tone="ok" value={rm(perOrder(live, paidOf))} />
          </div>
          <div className="px-4 pt-3">
            <Tabs label="Invoice status" value={tab} onValueChange={(v) => setTab(v as Tab)}
              tabs={TABS.map(([value, label]) => ({ value, label, count: value === "all" ? sales.length : sales.filter((r) => tabOf(r) === value).length }))} />
          </div>
          <ListPageShell register>
            <DataGrid rows={rows} columns={columns} rowKey={(r) => r.id}
              storageKey="carres.finance.sales-invoices.v1" appearance="reference" exportName="Sales Invoices"
              groupBanner={false} stickyIdentity isLoading={!query.isSuccess} searchPlaceholder="Search SI, customer, phone, ref…"
              emptyMessage="No sales invoices yet." onRowClick={setSelected} onRowDoubleClick={(r) => navigate(invoiceHref(r))}
              toolbarEnd={<NewSalesInvoiceDialog />}
              statusSummary={(visible) => <span data-testid="sales-invoices-summary">{visible.length} {visible.length === 1 ? "sales invoice" : "sales invoices"}</span>} />
          </ListPageShell>
          <QuickView row={selected} owed={selected ? owedOf(selected) : 0} onClose={() => setSelected(null)} />
        </>}
  </div>;
}
