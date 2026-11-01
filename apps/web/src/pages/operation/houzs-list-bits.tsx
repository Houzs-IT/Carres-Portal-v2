import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import Button from "@/components/kit/Button";
import Tabs from "@/components/kit/Tabs";
import { fmtDate } from "@/lib/fmt-date";
import type { WarehouseDocData } from "@/lib/pdf/warehouse-document-template";
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

/** Table / Cards on a register (the Goods Receipt pattern, OperationReceiving.tsx:978). */
export function TableCardsTabs({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <Tabs variant="segmented" label={`${label} display`} value={value} onValueChange={onChange}
    tabs={[{ value: "table", label: "Table", icon: "table" }, { value: "cards", label: "Cards", icon: "cards" }]} />;
}

/** DataGrid props for the Cards view; the cards take the grid's own filtered, sorted rows. */
export function cardsProps<T>(view: string, rowKey: (r: T) => string, onOpen: (r: T) => void, card: (r: T) => { title: string; facts: [string, ReactNode][] }) {
  return {
    presentationTools: true,
    presentationKey: view,
    renderResults: view === "cards" ? (rows: T[]) => (
      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3" data-testid="document-cards">
        {rows.map((r) => {
          const c = card(r);
          return (
            <div key={rowKey(r)} className="flex flex-col gap-2 rounded-lg border border-c-card-border bg-white p-3">
              <button type="button" className="self-start text-title text-c-ink underline-offset-2 hover:underline" onClick={() => onOpen(r)}>{c.title}</button>
              <Facts facts={c.facts} />
            </div>
          );
        })}
      </div>
    ) : undefined,
  };
}

export type HistoryEvent = { at: string | null | undefined; word: string; who?: string | null };

/** What happened to a document, newest first, read from its own dates; there is no audit log behind it. */
export function DocHistory({ events }: { events: HistoryEvent[] }) {
  const shown = events.filter((e): e is HistoryEvent & { at: string } => Boolean(e.at)).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <DetailSection title="History">
      <ul className="flex flex-col gap-1 text-body">
        {shown.map((e, i) => <li key={i}>{fmtDate(e.at)} · {e.word}{e.who ? ` · ${e.who}` : ""}</li>)}
      </ul>
    </DetailSection>
  );
}

export type DocLink = { kind: string; no: string; tab: string };

/** The documents around this one. Clicking one opens it on its own page. */
export function RelationshipMap({ current, links }: { current: { kind: string; no: string }; links: DocLink[] }) {
  const [, setParams] = useSearchParams();
  if (links.length === 0) return null;
  return (
    <DetailSection title="Relationship Map">
      <div className="flex flex-wrap items-center gap-2 text-body">
        <span className="rounded-control border border-c-line px-2 py-1 font-medium">{current.kind} {current.no}</span>
        {links.map((l) => (
          <Button key={`${l.tab}|${l.no}`} variant="neutral" onClick={() => setParams((p) => { p.set("tab", l.tab); p.set("open", l.no); return p; })}>
            {l.kind} {l.no}
          </Button>
        ))}
      </div>
    </DetailSection>
  );
}

/** Opens the row named by `?open=`, then drops it so closing the dialog stays closed. */
export function useOpenFromUrl<T>(rows: readonly T[] | undefined, noOf: (r: T) => string, open: (r: T) => void) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("open");
  const row = wanted ? rows?.find((r) => noOf(r) === wanted) : undefined;
  useEffect(() => {
    if (!row) return;
    open(row);
    setParams((p) => { p.delete("open"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
}

/** Print PDF: renders in the browser and saves the file; a failure says so instead of doing nothing. */
export function printDocument(data: WarehouseDocData | (() => Promise<WarehouseDocData>)) {
  void (async () => {
    try {
      const { downloadWarehouseDocument } = await import("@/lib/pdf/warehouse-document-pdf");
      await downloadWarehouseDocument(typeof data === "function" ? await data() : data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The PDF could not be made.");
    }
  })();
}
