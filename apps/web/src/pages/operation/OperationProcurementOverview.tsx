import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { poReportCategoryLabel, type PoReportLine } from "@carres/shared";
import { FinanceKpi } from "@/components/FinanceKpi";
import Button from "@/components/kit/Button";
import DataTable, { type Column } from "@/components/kit/DataTable";
import EmptyState from "@/components/kit/EmptyState";
import Tabs from "@/components/kit/Tabs";
import { appTodayIso, fmtDate, fmtMonth } from "@/lib/fmt-date";
import { useOperationPos, usePoReport } from "@/lib/queries";
import PurchasingTabs from "./PurchasingTabs";

/**
 * Purchasing → Procurement Overview, following Houzs scm-v2/ProcurementOverview.tsx
 * (Weisiang, WhatsApp 1 Nov 2026). Reads the PO Report's lines and the PO list and
 * stores nothing. Carres shows quantities where Houzs shows RM: the PO Report carries
 * no cost (Loo, 2026-08-04, po-report.ts:15). The promised date is the supplier's
 * official date, else the PO's ETA; Houzs's Lead time & stock tab is not ported.
 */
export type OpenLine = { poId: string; supplier: string; sku: string; pending: number; date: string | null; daysLate: number | null };

type PoLike = {
  id: string; status?: string | null; suppliers?: { name?: string | null } | null;
  official_delivery_date?: string | null; eta_date?: string | null;
  purchase_order_lines?: Array<{ id?: string; sku?: string | null; qty?: number | null; received_qty?: number | null }> | null;
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
    { key: "late5", label: "Late 5+ days", qty: 0 },
    { key: "late4", label: "Late up to 4 days or due tomorrow", qty: 0 },
    { key: "week", label: "Due in 2–7 days", qty: 0 },
    { key: "later", label: "Due in 8+ days", qty: 0 },
  ];
  for (const l of lines) {
    if (l.daysLate == null) continue;
    const at = l.daysLate >= 5 ? 0 : l.daysLate >= -1 ? 1 : l.daysLate >= -7 ? 2 : 3;
    buckets[at].qty += l.pending;
  }
  return buckets;
}

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

export default function OperationProcurementOverview() {
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <FinanceKpi testId="overview-raised" label="PO raised" value={report.data ? String(raised) : null} hint={`${new Set(live.map((l) => l.poId)).size} POs`} />
          <FinanceKpi testId="overview-received" label="Received" tone="ok" value={report.data ? String(received) : null} />
          <FinanceKpi testId="overview-outstanding" label="Total outstanding" tone="warn" value={pos.data ? String(outstanding) : null} hint={`${overdue.length} late lines`} />
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
            {lateness.map((b) => <FinanceKpi key={b.key} testId={`overview-${b.key}`} label={b.label} value={pos.data ? String(b.qty) : null} />)}
          </div>
        </section>
        <div className="grid gap-5 xl:grid-cols-2">
          <LineTable title="Overdue" lines={overdue} dayLabel="Days late" dayOf={(l) => String(l.daysLate ?? "")} />
          <LineTable title="Arriving in the next 3 days" lines={arriving} dayLabel="Due in" dayOf={(l) => String(-(l.daysLate ?? 0))} />
        </div>
      </div>
    </div>
  );
}
