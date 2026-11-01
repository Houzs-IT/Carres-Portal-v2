import type { ReactNode } from "react";
import OperationKpiTile from "./components/OperationKpiTile";

/** The Houzs summary cards above a list (e.g. Houzs StockTakesListV2.tsx:376-385). */
export function KpiRow({ items }: { items: { label: string; value: number | string; hint: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 px-2 pt-2 lg:grid-cols-4" data-testid="kpi-row">
      {items.map((k) => <OperationKpiTile key={k.label} accent="muted" {...k} />)}
    </div>
  );
}

/** A labelled card section on a detail dialog, the Houzs detail-page layout. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h3 className="text-title">{title}</h3>
      {children}
    </section>
  );
}

export function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-2 text-body sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label}><dt className="text-c-muted">{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}
