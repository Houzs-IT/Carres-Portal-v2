// Carres only (not part of Houzs's code): what the supplier's warehouse may have to hand over.
//
// Carres collects goods at the supplier's warehouse, and an order can be placed months before it is processed. This
// page adds up the supplier's lines on every open order (not processed yet, and in production but not collected)
// by item and by the month the customer expects delivery, so the warehouse can plan its stock.
import { useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "../../components/Button";
import { StatCard } from "../../components/StatCard";
import { supplierApi, type ForecastRow } from "./api";
import { LoadError, Loading, Missing, PageTitle, Table, downloadCsv, fmtMonth, useLoad, type Column } from "./ui";

const monthLabel = (m: string): string => (m ? fmtMonth(m) : "No date yet");

export function ForecastPage() {
  const forecast = useLoad("forecast", () => supplierApi.forecast());
  const data = forecast.data;

  const columns = useMemo<Column<ForecastRow>[]>(() => {
    const fixed: Column<ForecastRow>[] = [
      {
        key: "item", header: "Item", wrap: true, sortValue: (r) => r.description || r.itemCode,
        cell: (r) => (
          <div className="min-w-[200px]">
            <div className="font-semibold">{r.description || r.itemCode}</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{r.itemCode}{r.modelName ? ` · ${r.modelName}` : ""}</div>
          </div>
        ),
        csv: (r) => r.description || r.itemCode,
      },
      { key: "code", header: "Item Code", cell: () => null, className: "hidden", csv: (r) => r.itemCode },
      { key: "spec", header: "Specification", wrap: true, sortValue: (r) => r.spec, cell: (r) => r.spec || <Missing>Standard</Missing>, csv: (r) => r.spec },
      { key: "uom", header: "Unit", cell: (r) => r.uom, csv: (r) => r.uom },
      { key: "incoming", header: "Incoming", align: "right", sortValue: (r) => r.incoming, cell: (r) => r.incoming || <Missing>0</Missing>, csv: (r) => r.incoming },
      { key: "processing", header: "In Production", align: "right", sortValue: (r) => r.processing, cell: (r) => r.processing || <Missing>0</Missing>, csv: (r) => r.processing },
      { key: "total", header: "Total", align: "right", sortValue: (r) => r.total, cell: (r) => <span className="font-bold">{r.total}</span>, csv: (r) => r.total },
    ];
    const months: Column<ForecastRow>[] = (data?.months ?? []).map((m) => ({
      key: `m:${m}`, header: monthLabel(m), align: "right" as const, sortValue: (r: ForecastRow) => r.byMonth[m] ?? 0,
      cell: (r: ForecastRow) => r.byMonth[m] ?? <Missing>0</Missing>, csv: (r: ForecastRow) => r.byMonth[m] ?? 0,
    }));
    return [...fixed, ...months];
  }, [data?.months]);
  const screen = columns.filter((c) => c.key !== "code");

  return (
    <>
      <PageTitle
        title="Forecast"
        description="Your items on open Carres orders, by the month the customer expects delivery. Incoming orders are not processed yet; collected goods are left out."
        actions={<Button variant="secondary" icon={<Download size={14} />} disabled={!data?.rows.length} onClick={() => data && downloadCsv("forecast.csv", columns, data.rows)}>Download CSV</Button>}
      />
      {forecast.error && <div className="mb-3"><LoadError message={forecast.error} onRetry={forecast.reload} /></div>}
      {!data && !forecast.error && <Loading />}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Open orders" value={data.totals.orders} subtitle="Not delivered yet" />
            <StatCard label="Incoming" value={data.totals.incoming} subtitle="Units on orders not processed yet" />
            <StatCard label="In production" value={data.totals.processing} subtitle="Units processed, not collected" />
            <StatCard label="Total to prepare" value={data.totals.total} subtitle="Units across all open orders" />
          </div>
          <Table
            columns={screen}
            rows={data.rows}
            rowKey={(r) => `${r.itemCode}|${r.spec ?? ""}`}
            empty="No open orders carry your items right now."
            footer={(
              <tr className="bg-surface-2 font-bold">
                <td className="px-3 py-2.5" colSpan={3}>Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{data.totals.incoming}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{data.totals.processing}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{data.totals.total}</td>
                {data.months.map((m) => (
                  <td key={m} className="px-3 py-2.5 text-right tabular-nums">{data.rows.reduce((a, r) => a + (r.byMonth[m] ?? 0), 0)}</td>
                ))}
              </tr>
            )}
          />
        </>
      )}
    </>
  );
}
