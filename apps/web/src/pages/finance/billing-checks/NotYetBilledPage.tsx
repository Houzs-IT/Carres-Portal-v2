/**
 * Finance → Not Yet Billed, at `/finance/not-yet-billed`. READ ONLY. Delivered
 * orders against their live Sales Invoices, order by order: Carres has no
 * per-DO-line link to an invoice. Follows Houzs UnbilledDeliveriesV2.tsx.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { NotYetBilledRow } from "@carres/shared/not-yet-billed";
import { FinanceKpi } from "@/components/FinanceKpi";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Tabs from "@/components/kit/Tabs";
import { apiFetch } from "@/lib/api";
import { appDateIsoOf, appTodayIso, fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";
import ModuleHeader from "@/pages/operation/components/ModuleHeader";
import { LoadFailed } from "../other-money-in/parts";

const AGE_TABS = [
  { value: "all", label: "All ages", minAge: 0 },
  { value: "aged", label: "Aged 31+", minAge: 31 },
  { value: "over90", label: "Over 90 days", minAge: 91 },
  { value: "over365", label: "Over 12 months", minAge: 366 },
] as const;
type AgeTab = (typeof AGE_TABS)[number]["value"];

/** Whole days since delivery; null when the order holds no delivered date. */
export function ageDays(deliveredAt: string | null, today = appTodayIso()): number | null {
  const day = appDateIsoOf(deliveredAt);
  if (!day) return null;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
}

const doWords = (r: NotYetBilledRow) => r.do_numbers.join(", ");
const soWord = (r: NotYetBilledRow) => `SO-${r.so}`;

export default function NotYetBilledPage() {
  const query = useQuery({
    queryKey: ["finance", "not-yet-billed"],
    queryFn: () => apiFetch<{ rows: NotYetBilledRow[] }>("/api/finance/not-yet-billed"),
  });
  const [tab, setTab] = useState<AgeTab>("all");
  const all = useMemo(() => query.data?.rows ?? [], [query.data]);
  const rows = useMemo(() => {
    const min = AGE_TABS.find((t) => t.value === tab)?.minAge ?? 0;
    return min === 0 ? all : all.filter((r) => (ageDays(r.delivered_at) ?? -1) >= min);
  }, [all, tab]);
  const stats = useMemo(() => {
    const sum = (list: NotYetBilledRow[]) => list.reduce((s, r) => s + Number(r.not_billed), 0);
    const ages = rows.map((r) => ageDays(r.delivered_at) ?? 0);
    const partly = rows.filter((r) => Number(r.already_billed) > 0);
    return {
      over365: sum(all.filter((r) => (ageDays(r.delivered_at) ?? 0) >= 366)),
      notBilled: sum(rows),
      partly: sum(partly),
      oldest: ages.length > 0 ? Math.max(...ages) : 0,
    };
  }, [all, rows]);

  const columns = useMemo<DataGridColumn<NotYetBilledRow>[]>(() => [
    { key: "so", label: "SO No.", width: 120,
      accessor: (r) => <Link className="text-link" to={`/operation/orders/so/${r.order_id}`}>{soWord(r)}</Link>,
      searchValue: soWord, exportValue: soWord, filterType: "numbering" },
    { key: "do", label: "DO No.", width: 170, wrap: true, accessor: doWords, searchValue: doWords, exportValue: doWords },
    { key: "delivered", label: "Delivered", width: 130, accessor: (r) => fmtDate(r.delivered_at),
      dateValue: (r) => r.delivered_at, filterType: "date", exportValue: (r) => fmtDate(r.delivered_at) },
    { key: "age", label: "Age", width: 90, align: "right",
      accessor: (r) => { const a = ageDays(r.delivered_at); return a === null ? "" : `${a} days`; },
      numberValue: (r) => ageDays(r.delivered_at), exportValue: (r) => ageDays(r.delivered_at) ?? "" },
    { key: "customer", label: "Customer", width: 220, wrap: true, accessor: (r) => r.customer_name,
      searchValue: (r) => r.customer_name, filterType: "enum" },
    { key: "phone", label: "Phone", width: 130, defaultHidden: true, accessor: (r) => r.customer_phone ?? "",
      searchValue: (r) => r.customer_phone ?? "" },
    { key: "salesperson", label: "Salesperson", width: 150, accessor: (r) => r.salesperson ?? "",
      searchValue: (r) => r.salesperson ?? "", filterType: "enum" },
    { key: "not_billed", label: "Not billed", width: 130, align: "right", accessor: (r) => rm(Number(r.not_billed)),
      numberValue: (r) => Number(r.not_billed), exportValue: (r) => Number(r.not_billed), filterType: "number" },
    { key: "value", label: "Delivered value", width: 140, align: "right", accessor: (r) => rm(Number(r.delivered_value)),
      numberValue: (r) => Number(r.delivered_value), exportValue: (r) => Number(r.delivered_value) },
    { key: "billed", label: "Already billed", width: 130, align: "right", accessor: (r) => rm(Number(r.already_billed)),
      numberValue: (r) => Number(r.already_billed), exportValue: (r) => Number(r.already_billed) },
  ], []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleHeader destinationHeader testId="not-yet-billed-destination-header" word="Not Yet Billed" docTitle="Not Yet Billed · Carres" />
      {query.isError ? <LoadFailed what="Not Yet Billed" onRetry={() => void query.refetch()} /> : <>
        <div className="grid shrink-0 grid-cols-2 gap-3 px-4 pt-3 lg:grid-cols-4">
          <FinanceKpi testId="nyb-kpi-over365" label="Over 12 months" tone="danger" value={rm(stats.over365)} />
          <FinanceKpi testId="nyb-kpi-not-billed" label="Not billed" value={rm(stats.notBilled)} />
          <FinanceKpi testId="nyb-kpi-partly" label="Partly billed" value={rm(stats.partly)} />
          <FinanceKpi testId="nyb-kpi-oldest" label="Oldest" value={`${stats.oldest} days`} />
        </div>
        <div className="shrink-0 px-4 pt-2">
          <Tabs label="Age" value={tab} onValueChange={(v) => setTab(v as AgeTab)} tabs={AGE_TABS.map(({ value, label }) => ({ value, label }))} />
        </div>
        <ListPageShell register>
          <DataGrid
            rows={rows}
            columns={columns}
            rowKey={(r) => r.order_id}
            storageKey="carres.finance.not-yet-billed.v1"
            appearance="reference"
            exportName="Not Yet Billed"
            isLoading={!query.isSuccess}
            searchPlaceholder="Search SO, DO, customer, salesperson…"
            emptyMessage="Every delivered order is billed."
            statusSummary={(visible) => (
              <span data-testid="not-yet-billed-summary">
                {visible.length} {visible.length === 1 ? "order" : "orders"} · {rm(visible.reduce((s, r) => s + Number(r.not_billed), 0))} not billed
              </span>
            )}
          />
        </ListPageShell>
      </>}
    </div>
  );
}
