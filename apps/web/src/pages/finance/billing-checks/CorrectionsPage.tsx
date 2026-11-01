/**
 * Finance → Corrections, at `/finance/corrections`. READ ONLY, month by month:
 * every allocation corrected (0450) and every payment voided (0513), with who
 * did it and why, and who first recorded the payment. Follows Houzs
 * PaymentCorrectionsTab.tsx; its Ledger column is left out (no such log here).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { controlClass } from "@/components/kit/field-recipe";
import { FinanceKpi } from "@/components/FinanceKpi";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { apiFetch } from "@/lib/api";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import ModuleHeader from "@/pages/operation/components/ModuleHeader";
import { LoadFailed } from "../other-money-in/parts";

export interface CorrectionRow {
  id: string;
  kind: "allocation" | "void";
  at: string;
  by: string | null;
  order_id: string | null;
  so: number | null;
  customer_name: string | null;
  receipt_no: string | null;
  what: string;
  reason: string | null;
  recorded_by: string | null;
  recorded_on: string | null;
}

const orderWord = (r: CorrectionRow) => (r.so === null ? "" : `SO-${r.so}`);
const recordedWord = (r: CorrectionRow) =>
  [r.recorded_by ?? "Not on file", r.recorded_on ? fmtDate(r.recorded_on) : null].filter(Boolean).join(" · ");

export default function CorrectionsPage() {
  const [month, setMonth] = useState(() => appTodayIso().slice(0, 7));
  const query = useQuery({
    queryKey: ["finance", "corrections", month],
    queryFn: () => apiFetch<{ rows: CorrectionRow[] }>(`/api/finance/corrections?month=${month}`),
    enabled: month !== "",
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const people = useMemo(() => new Set(rows.map((r) => r.by).filter(Boolean)).size, [rows]);
  const columns = useMemo<DataGridColumn<CorrectionRow>[]>(() => [
    { key: "done", label: "Done", width: 130, accessor: (r) => fmtDate(r.at), dateValue: (r) => r.at, filterType: "date", exportValue: (r) => fmtDate(r.at) },
    { key: "by", label: "Done By", width: 150, accessor: (r) => r.by ?? "Not on file", filterType: "enum" },
    { key: "order", label: "Sales order", width: 120,
      accessor: (r) => (r.order_id && r.so !== null ? <Link className="text-link" to={`/operation/orders/so/${r.order_id}`}>{orderWord(r)}</Link> : ""),
      searchValue: orderWord, exportValue: orderWord },
    { key: "customer", label: "Customer", width: 190, wrap: true, accessor: (r) => r.customer_name ?? "", searchValue: (r) => r.customer_name ?? "" },
    { key: "receipt", label: "Receipt", width: 150, accessor: (r) => r.receipt_no ?? "", searchValue: (r) => r.receipt_no ?? "" },
    { key: "what", label: "What", width: 340, wrap: true, accessor: (r) => r.what, searchValue: (r) => r.what },
    { key: "recorded", label: "First recorded by", width: 190, wrap: true, accessor: recordedWord, exportValue: recordedWord },
    { key: "reason", label: "Reason", width: 260, wrap: true, accessor: (r) => r.reason ?? "", searchValue: (r) => r.reason ?? "" },
  ], []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleHeader destinationHeader testId="corrections-destination-header" word="Corrections" docTitle="Corrections · Carres" />
      {query.isError ? <LoadFailed what="Corrections" onRetry={() => void query.refetch()} /> : <>
        <div className="grid shrink-0 grid-cols-2 gap-3 px-4 pt-3">
          <FinanceKpi testId="corrections-kpi-count" label="Payment actions" value={String(rows.length)} />
          <FinanceKpi testId="corrections-kpi-people" label="Done by" value={String(people)} />
        </div>
        <ListPageShell register>
          <DataGrid
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            storageKey="carres.finance.corrections.v1"
            appearance="reference"
            exportName="Corrections"
            isLoading={month !== "" && !query.isSuccess}
            searchPlaceholder="Search order, receipt, reason…"
            emptyMessage="No payment was corrected or voided in this month."
            toolbarStart={
              <input type="month" aria-label="Month" className={controlClass(false)} value={month} max={appTodayIso().slice(0, 7)}
                onChange={(e) => setMonth(e.target.value)} />
            }
            statusSummary={(visible) => (
              <span data-testid="corrections-summary">{visible.length} {visible.length === 1 ? "action" : "actions"}</span>
            )}
          />
        </ListPageShell>
      </>}
    </div>
  );
}
