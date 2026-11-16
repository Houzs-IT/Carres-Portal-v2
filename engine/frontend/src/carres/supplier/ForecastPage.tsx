// Carres only (not part of Houzs's code): what the supplier's warehouse may have to hand over.
//
// Carres collects goods at the supplier's warehouse, and an order can be placed months before it is processed. This
// page adds up the supplier's lines on every open order (not processed yet, and in production but not collected)
// by item and by the month the customer expects delivery, so the warehouse can plan its stock.
//
// Drawn with the staff list's own parts (owner, 16 Nov 2026): the header, the figure cards and the staff table, whose
// search, Export, Wrap and Columns work on the rows here, and whose foot adds up the rows showing.
import { useMemo } from "react";
import { DataTable, type Column } from "../../components/DataTable";
import { StatCard } from "../../components/StatCard";
import { supplierApi, type ForecastRow } from "./api";
import { LoadError, Missing, PageHeader, fmtMonth, useLoad } from "./ui";

const monthLabel = (m: string): string => (m ? fmtMonth(m) : "No date yet");
const sum = (rows: ForecastRow[], value: (r: ForecastRow) => number): string => rows.reduce((a, r) => a + value(r), 0).toLocaleString("en-MY");

export function ForecastPage() {
  const forecast = useLoad("forecast", () => supplierApi.forecast());
  const data = forecast.data;

  const columns = useMemo<Column<ForecastRow>[]>(() => {
    const fixed: Column<ForecastRow>[] = [
      {
        key: "item", label: "Item", alwaysVisible: true, getValue: (r) => r.description || r.itemCode,
        searchValue: (r) => `${r.description} ${r.itemCode} ${r.modelName ?? ""}`,
        render: (r) => (
          <div className="min-w-[200px] whitespace-normal">
            <div className="font-semibold">{r.description || r.itemCode}</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{r.itemCode}{r.modelName ? ` · ${r.modelName}` : ""}</div>
          </div>
        ),
      },
      { key: "code", label: "Item Code", defaultHidden: true, getValue: (r) => r.itemCode, render: (r) => <span className="font-mono">{r.itemCode}</span> },
      { key: "spec", label: "Specification", getValue: (r) => r.spec ?? "", render: (r) => <span className="whitespace-normal">{r.spec || <Missing>Standard</Missing>}</span> },
      { key: "uom", label: "Unit", getValue: (r) => r.uom, render: (r) => r.uom },
      {
        key: "incoming", label: "Incoming", align: "right", getValue: (r) => r.incoming, filterType: "number", numberValue: (r) => r.incoming,
        render: (r) => r.incoming || <Missing>0</Missing>, total: (rows) => sum(rows, (r) => r.incoming),
      },
      {
        key: "processing", label: "In Production", align: "right", getValue: (r) => r.processing, filterType: "number", numberValue: (r) => r.processing,
        render: (r) => r.processing || <Missing>0</Missing>, total: (rows) => sum(rows, (r) => r.processing),
      },
      {
        key: "total", label: "Total", align: "right", getValue: (r) => r.total, filterType: "number", numberValue: (r) => r.total,
        render: (r) => <span className="font-bold">{r.total}</span>, total: (rows) => sum(rows, (r) => r.total),
      },
    ];
    const months: Column<ForecastRow>[] = (data?.months ?? []).map((m) => ({
      key: `m:${m}`, label: monthLabel(m), align: "right" as const, disableFilter: true,
      getValue: (r: ForecastRow) => r.byMonth[m] ?? 0,
      render: (r: ForecastRow) => r.byMonth[m] ?? <Missing>0</Missing>,
      total: (rows: ForecastRow[]) => sum(rows, (r) => r.byMonth[m] ?? 0),
    }));
    return [...fixed, ...months];
  }, [data?.months]);

  const unknown = !data;
  const failed = unknown && !!forecast.error;
  return (
    <>
      <PageHeader
        eyebrow="Warehouse and Operation"
        title="Forecast"
        description="Your items on open Carres orders, by the month the customer expects delivery. Incoming orders are not processed yet; collected goods are left out."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open Orders" value={data?.totals.orders.toLocaleString("en-MY")} subtitle="Not delivered yet" rail="bg-primary" active pending={unknown && !failed} failed={failed} onRetry={forecast.reload} />
        <StatCard label="Incoming" value={data?.totals.incoming.toLocaleString("en-MY")} subtitle="Units on orders not processed yet" rail="bg-accent" pending={unknown && !failed} failed={failed} onRetry={forecast.reload} />
        <StatCard label="In Production" value={data?.totals.processing.toLocaleString("en-MY")} subtitle="Units processed, not collected" rail="bg-warning-text" pending={unknown && !failed} failed={failed} onRetry={forecast.reload} />
        <StatCard label="Total to Prepare" value={data?.totals.total.toLocaleString("en-MY")} subtitle="Units across all open orders" rail="bg-synced" tone="success" pending={unknown && !failed} failed={failed} onRetry={forecast.reload} />
      </div>
      {failed && <div className="mb-3"><LoadError message={forecast.error!} onRetry={forecast.reload} /></div>}
      <DataTable<ForecastRow>
        tableId="carres-supplier-forecast"
        documentLabel="Forecast"
        exportName="forecast"
        columns={columns}
        rows={data?.rows ?? null}
        loading={unknown && !failed}
        getRowKey={(r) => `${r.itemCode}|${r.spec ?? ""}`}
        emptyLabel="No open orders carry your items right now."
        clientSearch={{ placeholder: "Search item, code or specification" }}
      />
    </>
  );
}
