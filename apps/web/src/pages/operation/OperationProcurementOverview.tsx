import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { poReportCategoryLabel, type PoReportLine, type StockRegisterUnit } from "@carres/shared";
import { FinanceKpi } from "@/components/FinanceKpi";
import Button from "@/components/kit/Button";
import DataTable, { type Column } from "@/components/kit/DataTable";
import Drawer from "@/components/kit/Drawer";
import EmptyState from "@/components/kit/EmptyState";
import Tabs from "@/components/kit/Tabs";
import { appTodayIso, fmtDate, fmtMonth } from "@/lib/fmt-date";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOperationPos, usePoReport, useStockRegister } from "@/lib/queries";
import { money } from "@/pages/finance/payables/payables-words";
import PurchasingTabs from "./PurchasingTabs";

/**
 * Purchasing → Procurement Overview, following Houzs scm-v2/ProcurementOverview.tsx
 * (Weisiang, WhatsApp 1 Nov 2026). Reads the PO Report's lines and the PO list and
 * stores nothing. Carres shows quantities where Houzs shows RM: the PO Report carries
 * no cost (Loo, 2026-08-04, po-report.ts:15). The promised date is the supplier's
 * official date, else the PO's ETA. Lead time & stock follows Houzs in Units too, so
 * its RM dead-stock, buffer and turnover figures are left out. Supplier billed is the
 * one RM figure: Purchase Invoices already shows it to these same roles.
 */
export type OpenLine = { poId: string; supplier: string; sku: string; pending: number; date: string | null; daysLate: number | null };

type PoLike = {
  id: string; status?: string | null; suppliers?: { name?: string | null } | null;
  official_delivery_date?: string | null; eta_date?: string | null;
  supplier_id?: string | null; placed_at?: string | null; do_uploaded_at?: string | null;
  purchase_order_lines?: Array<{ id?: string; sku?: string | null; qty?: number | null; received_qty?: number | null; category?: string | null }> | null;
};

const dayNumber = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/** One row per PO line with goods still to come. Cancelled POs are out, as on the PO Report. */
export function openLinesOf(pos: readonly PoLike[], today: string): OpenLine[] {
  const out: OpenLine[] = [];
  for (const po of pos) {
    if (po.status === "cancelled") continue;
    const date = po.official_delivery_date ?? po.eta_date ?? null;
    for (const line of po.purchase_order_lines ?? []) {
      const pending = Number(line.qty ?? 0) - Number(line.received_qty ?? 0);
      if (pending <= 0) continue;
      out.push({ poId: po.id, supplier: po.suppliers?.name ?? "", sku: line.sku ?? "", pending, date,
        daysLate: date ? dayNumber(today) - dayNumber(date) : null });
    }
  }
  return out;
}

/** Houzs's four lateness buckets (ProcurementOverview.tsx:58-63), in Units. */
export function latenessOf(lines: readonly OpenLine[]) {
  const buckets = [
    { key: "late5", label: "Late 5+ days", qty: 0, lines: [] as OpenLine[] },
    { key: "late4", label: "Late up to 4 days or due tomorrow", qty: 0, lines: [] as OpenLine[] },
    { key: "week", label: "Due in 2–7 days", qty: 0, lines: [] as OpenLine[] },
    { key: "later", label: "Due in 8+ days", qty: 0, lines: [] as OpenLine[] },
  ];
  for (const l of lines) {
    if (l.daysLate == null) continue;
    const at = l.daysLate >= 5 ? 0 : l.daysLate >= -1 ? 1 : l.daysLate >= -7 ? 2 : 3;
    buckets[at].qty += l.pending;
    buckets[at].lines.push(l);
  }
  return buckets;
}

export type LeadRow = { key: string; label: string; receipts: number; avgDays: number | null; midDays: number | null; onTimePct: number | null; avgLate: number | null };

/** The MYT day of a timestamp, so a 9pm receipt is not filed under tomorrow. */
const mytDay = (ts: string) => new Date(Date.parse(ts) + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Houzs's Lead time table (ProcurementOverview.tsx:262-318). Carres stamps goods in
 * per PO (`do_uploaded_at`, what the supplier scorecard reads), so a receipt here is
 * a PO, not a line. On time reads `eta_date`, as the scorecard does. `month` is the
 * month the goods came in.
 */
export function leadTimesOf(pos: readonly PoLike[], by: "category" | "supplier", month: string): LeadRow[] {
  const groups = new Map<string, { label: string; days: number[]; judged: number; late: number[] }>();
  for (const po of pos) {
    if (po.status === "cancelled" || !po.placed_at || !po.do_uploaded_at) continue;
    const got = mytDay(po.do_uploaded_at);
    if (month !== "all" && got.slice(0, 7) !== month) continue;
    const keys = by === "supplier"
      ? [[po.supplier_id ?? "", po.suppliers?.name ?? ""]]
      : [...new Set((po.purchase_order_lines ?? []).map((l) => l.category ?? ""))].map((c) => [c, poReportCategoryLabel(c)]);
    for (const [key, label] of keys) {
      const g = groups.get(key) ?? { label, days: [], judged: 0, late: [] };
      g.days.push(dayNumber(got) - dayNumber(mytDay(po.placed_at)));
      if (po.eta_date) {
        g.judged += 1;
        const late = dayNumber(got) - dayNumber(po.eta_date);
        if (late > 0) g.late.push(late);
      }
      groups.set(key, g);
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return [...groups].map(([key, g]) => {
    const sorted = [...g.days].sort((a, b) => a - b);
    return {
      key, label: g.label, receipts: g.days.length, avgDays: avg(g.days), midDays: sorted[Math.floor((sorted.length - 1) / 2)] ?? null,
      onTimePct: g.judged ? Math.round(((g.judged - g.late.length) / g.judged) * 100) : null, avgLate: avg(g.late),
    };
  }).sort((a, b) => b.receipts - a.receipts);
}

export type StockRow = { key: string; label: string; forOrder: number; forNoOrder: number; idle90: number };

/** Stock in Units, Houzs's dead-stock split without its RM: free for no order, and how much of that is 90+ days in. */
export function stockRowsOf(units: readonly Pick<StockRegisterUnit, "availability" | "qty" | "dateIn" | "siteName" | "category">[], by: "warehouse" | "category", today: string): StockRow[] {
  const rows = new Map<string, StockRow>();
  for (const u of units) {
    if (u.availability !== "available" && u.availability !== "reserved") continue;
    const key = (by === "warehouse" ? u.siteName : u.category) ?? "";
    const row = rows.get(key) ?? { key, label: by === "warehouse" ? u.siteName ?? "Not recorded" : poReportCategoryLabel(key), forOrder: 0, forNoOrder: 0, idle90: 0 };
    if (u.availability === "reserved") row.forOrder += u.qty;
    else {
      row.forNoOrder += u.qty;
      if (u.dateIn && dayNumber(today) - dayNumber(u.dateIn) >= 90) row.idle90 += u.qty;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.forNoOrder - a.forNoOrder);
}

/** The bills Supplier billed adds up: not cancelled, the Purchase Invoices page's own Billed rule. */
type BillRow = { id: string; bill_no: string | null; status: string; supplier_name: string; bill_date: string; total_amount: number | string };
export const billedIn = (rows: readonly BillRow[], month: string) =>
  rows.filter((r) => r.status !== "cancelled" && (month === "all" || r.bill_date.slice(0, 7) === month));

type Row = { key: string; label: string; pos: Set<string>; ordered: number; received: number };

export function breakdownOf(lines: readonly PoReportLine[], by: "category" | "supplier"): Row[] {
  const rows = new Map<string, Row>();
  for (const l of lines) {
    if (l.cancelled) continue;
    const key = by === "category" ? l.category ?? "" : l.supplierId;
    const row = rows.get(key) ?? { key, label: by === "category" ? poReportCategoryLabel(key) : l.supplierName, pos: new Set<string>(), ordered: 0, received: 0 };
    row.pos.add(l.poId);
    row.ordered += l.ordered;
    row.received += l.received;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.ordered - a.ordered);
}

const poLink = (id: string) => (
  <Link className="font-mono text-kit-blue-11 hover:underline" to={`/operation?tab=purchase-orders&po=${encodeURIComponent(id)}`}>{id}</Link>
);

function LineTable({ title, lines, dayLabel, dayOf }: { title: string; lines: OpenLine[]; dayLabel: string; dayOf: (l: OpenLine) => string }) {
  const columns: Column<OpenLine>[] = [
    { key: "po", label: "PO", width: "150px", cell: (l) => poLink(l.poId) },
    { key: "supplier", label: "Supplier", width: "140px", cell: (l) => <span className="truncate">{l.supplier}</span> },
    { key: "item", label: "Item", width: "150px", cell: (l) => <span className="truncate">{l.sku}</span> },
    { key: "pending", label: "Still to come", width: "90px", align: "right", numeric: true, cell: (l) => l.pending },
    { key: "date", label: "Promised", width: "110px", cell: (l) => (l.date ? fmtDate(l.date) : "") },
    { key: "day", label: dayLabel, width: "auto", align: "right", numeric: true, cell: dayOf },
  ];
  return (
    <section className="min-w-0">
      <h2 className="mb-2 text-strong">{title} · {lines.length}</h2>
      {/* Capped at 60 rows, as Houzs's LineTable (ProcurementOverview.tsx:383-401). */}
      <DataTable<OpenLine> rows={lines.slice(0, 60)} columns={columns} sizing="content" label={title}
        rowId={(l) => `${l.poId}-${l.sku}`} empty={<span className="text-meta text-kit-slate-11">None.</span>} />
    </section>
  );
}

/** Its own component so the register is read only when this tab opens. */
function StockSection() {
  const stock = useStockRegister();
  return (
    <section data-testid="overview-stock">
      <h2 className="mb-2 text-strong">Stock</h2>
      {stock.isError ? (
        <div role="alert"><EmptyState title="Could not be loaded" action={<Button variant="neutral" onClick={() => void stock.refetch()}>Try again</Button>} /></div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <DataTable<StockRow> rows={stockRowsOf(stock.data?.units ?? [], "warehouse", appTodayIso())} columns={stockColumns("Warehouse")} sizing="content" rowId={(r) => r.key || "none"} label="Stock by warehouse"
            loading={stock.isLoading} empty={<span className="text-meta text-kit-slate-11">No stock.</span>} />
          <DataTable<StockRow> rows={stockRowsOf(stock.data?.units ?? [], "category", appTodayIso())} columns={stockColumns("Category")} sizing="content" rowId={(r) => r.key || "none"} label="Stock by category"
            loading={stock.isLoading} empty={<span className="text-meta text-kit-slate-11">No stock.</span>} />
        </div>
      )}
    </section>
  );
}

function Tile({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return <button type="button" className="w-full cursor-pointer text-left" onClick={onOpen}>{children}</button>;
}

const leadColumns = (label: string): Column<LeadRow>[] => {
  const days = (n: number | null) => (n == null ? "" : `${n} days`);
  return [
    { key: "label", label, width: "180px", cell: (r) => <span className="truncate">{r.label}</span> },
    { key: "receipts", label: "Receipts", width: "80px", align: "right", numeric: true, cell: (r) => r.receipts },
    { key: "avg", label: "Supplier takes · average", width: "160px", align: "right", numeric: true, cell: (r) => days(r.avgDays) },
    { key: "mid", label: "Supplier takes · median", width: "160px", align: "right", numeric: true, cell: (r) => days(r.midDays) },
    { key: "onTime", label: "On time", width: "80px", align: "right", numeric: true, cell: (r) => (r.onTimePct == null ? "" : `${r.onTimePct}%`) },
    { key: "late", label: "Late by · average", width: "auto", align: "right", numeric: true, cell: (r) => days(r.avgLate) },
  ];
};

const stockColumns = (label: string): Column<StockRow>[] => [
  { key: "label", label, width: "180px", cell: (r) => <span className="truncate">{r.label}</span> },
  { key: "onHand", label: "On hand", width: "90px", align: "right", numeric: true, cell: (r) => r.forOrder + r.forNoOrder },
  { key: "forOrder", label: "For an order", width: "100px", align: "right", numeric: true, cell: (r) => r.forOrder },
  { key: "forNoOrder", label: "For no order", width: "100px", align: "right", numeric: true, cell: (r) => r.forNoOrder },
  { key: "idle", label: "For no order 90+ days", width: "auto", align: "right", numeric: true, cell: (r) => r.idle90 },
];

const openColumns: Column<OpenLine>[] = [
  { key: "po", label: "PO", width: "120px", cell: (l) => poLink(l.poId) },
  { key: "item", label: "Item", width: "130px", cell: (l) => <span className="truncate">{l.sku}</span> },
  { key: "pending", label: "Still to come", width: "80px", align: "right", numeric: true, cell: (l) => l.pending },
  { key: "date", label: "Promised", width: "auto", cell: (l) => (l.date ? fmtDate(l.date) : "") },
];

type DrillPo = { key: string; poId: string; supplier: string; category: string; ordered: number; received: number };

/** The POs behind a tile: exactly the report lines its figure added up. */
export function drillPos(lines: readonly PoReportLine[], keep: (l: PoReportLine) => boolean): DrillPo[] {
  const rows = new Map<string, DrillPo>();
  for (const l of lines) {
    if (l.cancelled || !keep(l)) continue;
    const key = `${l.poId}|${l.category ?? ""}`;
    const row = rows.get(key) ?? { key, poId: l.poId, supplier: l.supplierName, category: poReportCategoryLabel(l.category ?? ""), ordered: 0, received: 0 };
    row.ordered += l.ordered;
    row.received += l.received;
    rows.set(key, row);
  }
  return [...rows.values()];
}

const drillPoColumns: Column<DrillPo>[] = [
  { key: "po", label: "PO", width: "110px", cell: (r) => poLink(r.poId) },
  { key: "supplier", label: "Supplier", width: "110px", cell: (r) => <span className="truncate">{r.supplier}</span> },
  { key: "ordered", label: "Ordered", width: "70px", align: "right", numeric: true, cell: (r) => r.ordered },
  { key: "received", label: "Received", width: "auto", align: "right", numeric: true, cell: (r) => r.received },
];

const billColumns: Column<BillRow>[] = [
  { key: "bill", label: "PI No", width: "110px", cell: (r) => r.bill_no ?? "" },
  { key: "supplier", label: "Supplier", width: "110px", cell: (r) => <span className="truncate">{r.supplier_name}</span> },
  { key: "date", label: "PI Doc Date", width: "90px", cell: (r) => fmtDate(r.bill_date) },
  { key: "total", label: "Total", width: "auto", align: "right", numeric: true, cell: (r) => money(r.total_amount) },
];

export default function OperationProcurementOverview() {
  const role = useAuth((s) => s.role);
  // The same read and gate as Purchase Invoices; any other role never asks and sees no tile.
  const canReadBills = role === "operation" || role === "principal";
  const bills = useQuery<{ rows: BillRow[] }>({
    queryKey: ["operation", "purchase-invoices"],
    queryFn: () => apiFetch("/api/operation/purchase-invoices"),
    enabled: canReadBills,
  });
  const [view, setView] = useState<"overview" | "stock">("overview");
  const [drill, setDrill] = useState<{ title: string; body: ReactNode } | null>(null);
  const report = usePoReport();
  const pos = useOperationPos({ status: "all" });
  const [month, setMonth] = useState("all");
  const [by, setBy] = useState<"category" | "supplier">("category");

  const allLines = useMemo(() => report.data?.lines ?? [], [report.data]);
  const months = useMemo(() => [...new Set(allLines.map((l) => l.month))].sort().reverse().slice(0, 6), [allLines]);
  const lines = useMemo(() => (month === "all" ? allLines : allLines.filter((l) => l.month === month)), [allLines, month]);
  const rows = useMemo(() => breakdownOf(lines, by), [lines, by]);
  const open = useMemo(() => openLinesOf((pos.data?.pos ?? []) as PoLike[], appTodayIso()), [pos.data]);

  const live = lines.filter((l) => !l.cancelled);
  const raised = live.reduce((sum, l) => sum + l.ordered, 0);
  const received = live.reduce((sum, l) => sum + l.received, 0);
  const outstanding = open.reduce((sum, l) => sum + l.pending, 0);
  const overdue = open.filter((l) => (l.daysLate ?? 0) > 0).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));
  const arriving = open.filter((l) => l.daysLate != null && l.daysLate <= 0 && l.daysLate >= -3).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));
  const lateness = latenessOf(open);
  const billed = useMemo(() => billedIn(bills.data?.rows ?? [], month), [bills.data, month]);
  const posList = (pos.data?.pos ?? []) as PoLike[];
  const openPosDrill = (title: string, keep: (l: PoReportLine) => boolean) => setDrill({
    title,
    body: <DataTable<DrillPo> rows={drillPos(lines, keep)} columns={drillPoColumns} sizing="content" label={title} rowId={(r) => r.key}
      empty={<span className="text-meta text-kit-slate-11">None.</span>} />,
  });
  const openLinesDrill = (title: string, rows: OpenLine[]) => setDrill({
    title,
    body: <DataTable<OpenLine> rows={rows} columns={openColumns} sizing="content" label={title} rowId={(l) => `${l.poId}-${l.sku}`}
      empty={<span className="text-meta text-kit-slate-11">None.</span>} />,
  });

  const columns: Column<Row>[] = [
    { key: "label", label: by === "category" ? "Category" : "Supplier", width: "180px", cell: (r) => <span className="truncate">{r.label}</span> },
    { key: "pos", label: "POs", width: "70px", align: "right", numeric: true, cell: (r) => r.pos.size },
    { key: "ordered", label: "PO raised", width: "90px", align: "right", numeric: true, cell: (r) => r.ordered },
    { key: "received", label: "Received", width: "90px", align: "right", numeric: true, cell: (r) => r.received },
    { key: "open", label: "Total outstanding", width: "auto", align: "right", numeric: true, cell: (r) => Math.max(r.ordered - r.received, 0) },
  ];

  if (report.isError || pos.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="procurement-overview">
        <PurchasingTabs />
        <div role="alert">
          <EmptyState title="Could not be loaded" detail="The Procurement Overview could not be read."
            action={<Button variant="neutral" onClick={() => { void report.refetch(); void pos.refetch(); }}>Try again</Button>} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="procurement-overview">
      <PurchasingTabs />
      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-3">
        <Tabs label="Period" value={month} onValueChange={setMonth}
          tabs={[{ value: "all", label: "All" }, ...months.map((m) => ({ value: m, label: fmtMonth(m) }))]} />
        <Tabs label="Procurement Overview view" value={view} onValueChange={(v) => setView(v as "overview" | "stock")}
          tabs={[{ value: "overview", label: "Overview" }, { value: "stock", label: "Lead time & stock" }]} />
        {view === "stock" ? (
          <>
            <section>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-strong">Lead time</h2>
                <Tabs label="Lead time by" value={by} onValueChange={(v) => setBy(v as "category" | "supplier")}
                  tabs={[{ value: "category", label: "By category" }, { value: "supplier", label: "By supplier" }]} />
              </div>
              <DataTable<LeadRow> rows={leadTimesOf(posList, by, month)} columns={leadColumns(by === "category" ? "Category" : "Supplier")} sizing="content" rowId={(r) => r.key || "none"} label="Lead time"
                loading={pos.isLoading} empty={<span className="text-meta text-kit-slate-11">No goods received in this period.</span>} />
            </section>
            <StockSection />
          </>
        ) : (
        <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile onOpen={() => openPosDrill("PO raised", () => true)}><FinanceKpi testId="overview-raised" label="PO raised" value={report.data ? String(raised) : null} hint={`${new Set(live.map((l) => l.poId)).size} POs`} /></Tile>
          <Tile onOpen={() => openPosDrill("Received", (l) => l.received > 0)}><FinanceKpi testId="overview-received" label="Received" tone="ok" value={report.data ? String(received) : null} /></Tile>
          <Tile onOpen={() => openLinesDrill("Total outstanding", open)}><FinanceKpi testId="overview-outstanding" label="Total outstanding" tone="warn" value={pos.data ? String(outstanding) : null} hint={`${overdue.length} late lines`} /></Tile>
          {canReadBills && (
            <Tile onOpen={() => setDrill({ title: "Supplier billed", body: <DataTable<BillRow> rows={billed} columns={billColumns} sizing="content" label="Supplier billed" rowId={(r) => r.id} empty={<span className="text-meta text-kit-slate-11">None.</span>} /> })}>
              <FinanceKpi testId="overview-billed" label="Supplier billed" value={bills.data ? money(billed.reduce((n, r) => n + Number(r.total_amount), 0)) : null} hint={bills.data ? `${billed.length} PIs` : undefined} />
            </Tile>
          )}
        </div>
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-strong">Breakdown</h2>
            <Tabs label="Breakdown by" value={by} onValueChange={(v) => setBy(v as "category" | "supplier")}
              tabs={[{ value: "category", label: "By category" }, { value: "supplier", label: "By supplier" }]} />
          </div>
          <DataTable<Row> rows={rows} columns={columns} sizing="content" rowId={(r) => r.key || "none"} label="Breakdown"
            loading={report.isLoading} empty={<span className="text-meta text-kit-slate-11">No purchase orders in this period.</span>} />
        </section>
        <section>
          <h2 className="mb-2 text-strong">Outstanding: how late</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="overview-lateness">
            {lateness.map((b) => <Tile key={b.key} onOpen={() => openLinesDrill(b.label, b.lines)}><FinanceKpi testId={`overview-${b.key}`} label={b.label} value={pos.data ? String(b.qty) : null} /></Tile>)}
          </div>
        </section>
        <div className="grid gap-5 xl:grid-cols-2">
          <LineTable title="Overdue" lines={overdue} dayLabel="Days late" dayOf={(l) => String(l.daysLate ?? "")} />
          <LineTable title="Arriving in the next 3 days" lines={arriving} dayLabel="Due in" dayOf={(l) => String(-(l.daysLate ?? 0))} />
        </div>
        </>
        )}
      </div>
      <Drawer open={drill != null} onOpenChange={(o) => { if (!o) setDrill(null); }} title={drill?.title ?? ""}>{drill?.body}</Drawer>
    </div>
  );
}
