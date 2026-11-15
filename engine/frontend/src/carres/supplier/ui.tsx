// Carres only (not part of Houzs's code): the small set of parts the supplier pages are drawn from.
//
// They follow the engine's own look (the same tokens, table header, pills and drawer the staff Sales Orders page
// uses) but are self-contained on purpose: the staff table keeps its column layouts on the server through the
// STAFF client, and a supplier page must never call a staff route.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, X as XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { useEscapeLayer } from "../../lib/escapeStack";
import { fmtDate, fmtDateTime } from "../../vendor/shared/format";
import type { OrderPickupState, PickupLineState, PickupStatus } from "./api";

// ── Words and numbers ───────────────────────────────────────────────────────────────────────────────────────────

/* Dates are written by the engine's ONE date format (vendor/shared/format.ts: "2026/11/20", and "2026/11/20 10:30"
   in Kuala Lumpur time), the same as every staff page. That formatter answers a dash for a date that is not known;
   these answer "" instead, so each caller names the gap ("Not processed yet") rather than showing a mark. */
const NOT_KNOWN = fmtDate(null);
const known = (text: string): string => (text === NOT_KNOWN ? "" : text);
const moneyFmt = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A calendar day (YYYY-MM-DD) as "2026/11/20". */
export function fmtDay(day: string | null | undefined): string {
  return day ? known(fmtDate(day.slice(0, 10))) : "";
}

/** A moment as "2026/11/20 10:30", Kuala Lumpur time. */
export function fmtStamp(iso: string | null | undefined): string {
  return iso ? known(fmtDateTime(iso)) : "";
}

/** "2026-12" as "2026/12": a date's own digits in a date's own order, without the day. */
export function fmtMonth(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? month.replace("-", "/") : month;
}

export const money = (n: number): string => `RM ${moneyFmt.format(n)}`;
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-MY")} ${n === 1 ? one : many}`;

type Tone = "neutral" | "accent" | "success" | "warning" | "error";

/** A Sales Order's stage, in the words Carres staff use for it. A stage that is not listed reads as its own name. */
export const SO_STATUS: Partial<Record<string, { label: string; tone: Tone }>> = {
  CONFIRMED: { label: "Submitted", tone: "accent" },
  IN_PRODUCTION: { label: "In Production", tone: "warning" },
  READY_TO_SHIP: { label: "Ready to Ship", tone: "success" },
  SHIPPED: { label: "Shipped", tone: "success" },
  DELIVERED: { label: "Delivered", tone: "success" },
  INVOICED: { label: "Invoiced", tone: "neutral" },
  CLOSED: { label: "Closed", tone: "neutral" },
  ON_HOLD: { label: "On Hold", tone: "warning" },
  RETURNED: { label: "Returned", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "error" },
};
export const soStatusLabel = (status: string): string => SO_STATUS[status]?.label ?? status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function SoStatusBadge({ status }: { status: string }) {
  return <Badge tone={SO_STATUS[status]?.tone ?? "neutral"} size="sm" caseless>{soStatusLabel(status)}</Badge>;
}

export const PICKUP_STATUS: Record<PickupStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Waiting for you to accept", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "accent" },
  COLLECTED: { label: "Collected", tone: "success" },
  CANCELLED: { label: "Cancelled by Carres", tone: "error" },
};

export function PickupBadge({ status }: { status: PickupStatus }) {
  const s = PICKUP_STATUS[status];
  return <Badge tone={s.tone} size="sm" caseless>{s.label}</Badge>;
}

const ORDER_PICKUP: Record<OrderPickupState | PickupLineState, { label: string; tone: Tone }> = {
  none: { label: "Not requested", tone: "neutral" },
  requested: { label: "Pickup requested", tone: "warning" },
  accepted: { label: "Pickup accepted", tone: "accent" },
  part_collected: { label: "Part collected", tone: "accent" },
  collected: { label: "Collected", tone: "success" },
};

export function OrderPickupBadge({ state }: { state: OrderPickupState | PickupLineState }) {
  const s = ORDER_PICKUP[state];
  return <Badge tone={s.tone} size="sm" caseless variant={state === "none" ? "outline" : "soft"}>{s.label}</Badge>;
}

// ── Loading one answer ──────────────────────────────────────────────────────────────────────────────────────────

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Load once per `key`, keep the last good answer on screen while a reload runs, and never show a stale answer
 *  for a different key. */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let alive = true;
    setState((s) => (s.key === key ? { ...s, loading: true, error: null } : { key, data: null, error: null, loading: true }));
    loader.current().then(
      (data) => { if (alive) setState({ key, data, error: null, loading: false }); },
      (e: unknown) => { if (alive) setState((s) => ({ key, data: s.key === key ? s.data : null, error: e instanceof Error ? e.message : "Could not load.", loading: false })); },
    );
    return () => { alive = false; };
  }, [key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: state.loading || state.key !== key, reload };
}

// ── Page furniture ──────────────────────────────────────────────────────────────────────────────────────────────

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-[12.5px] text-err">
      <span>{message}</span>
      {onRetry && <Button variant="secondary" onClick={onRetry} className="h-8 px-3">Try again</Button>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-[12.5px] text-ink-muted">{label}</div>;
}

export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          {title && <h2 className="font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** A label over its value, for the fact grids. A value that is not known shows a named gap, never a blank. */
export function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export const Missing = ({ children }: { children: ReactNode }) => <span className="text-ink-muted">{children}</span>;

// ── The table ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align numbers. */
  align?: "left" | "right";
  /** Sort in the browser by this value. Leave out for a column that does not sort. */
  sortValue?: (row: T) => string | number | null;
  /** Sort on the server under this name (the table then only reports the choice). */
  serverSort?: string;
  /** Let this column's text break onto more lines. Every other cell stays on one line: a number, a date, a
   *  document number or a status never splits, and a table too wide for the screen scrolls sideways instead. */
  wrap?: boolean;
  className?: string;
  /** Text for the CSV download. Leave out to keep the column off the file. */
  csv?: (row: T) => string | number | null;
}

export interface SortChoice { key: string; dir: "asc" | "desc" }

export function Table<T>({
  columns, rows, rowKey, onRowClick, empty, sort, onSortChange, footer, selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty: ReactNode;
  /** Controlled sort, for a list the server sorts. Leave out to sort in the browser. */
  sort?: SortChoice | null;
  onSortChange?: (next: SortChoice) => void;
  footer?: ReactNode;
  selectedKey?: string | null;
}) {
  const [local, setLocal] = useState<SortChoice | null>(null);
  const active = sort !== undefined ? sort : local;
  const sorted = useMemo(() => {
    if (sort !== undefined || !local) return rows;
    const col = columns.find((c) => c.key === local.key);
    if (!col?.sortValue) return rows;
    const value = col.sortValue;
    const dir = local.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // unknown last, whichever way
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
    });
  }, [rows, columns, local, sort]);

  const choose = (c: Column<T>) => {
    const key = sort !== undefined ? c.serverSort : c.sortValue ? c.key : undefined;
    if (!key) return;
    const next: SortChoice = active?.key === key ? { key, dir: active.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
    if (sort !== undefined) onSortChange?.(next);
    else setLocal(next);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2">
              {columns.map((c) => {
                const key = sort !== undefined ? c.serverSort : c.sortValue ? c.key : undefined;
                const on = !!key && active?.key === key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={on ? (active.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("h-10 whitespace-nowrap border-b border-border px-3 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted", c.align === "right" ? "text-right" : "text-left")}
                  >
                    {key ? (
                      <button type="button" onClick={() => choose(c)} className={cn("group inline-flex items-center gap-1 uppercase hover:text-ink", on && "text-ink")}>
                        {c.header}
                        {on ? (active.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ChevronsUpDown size={11} className="opacity-0 group-hover:opacity-60" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const k = rowKey(r);
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r); } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    "border-b border-border-subtle last:border-b-0",
                    onRowClick && "cursor-pointer hover:bg-surface-2 focus:outline-none focus-visible:bg-primary-soft/40",
                    selectedKey === k && "bg-primary-soft/40",
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 align-top text-ink", !c.wrap && "whitespace-nowrap", c.align === "right" && "text-right tabular-nums", c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer && sorted.length > 0 && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {sorted.length === 0 && <div className="px-4 py-10 text-center text-[12.5px] text-ink-muted">{empty}</div>}
    </div>
  );
}

/** The rows as CSV text: only the columns that name a `csv` value. A text cell that starts like a formula gets a
 *  leading apostrophe, so a spreadsheet shows it as text instead of running it (a customer's name is typed by
 *  someone outside Carres). Numbers are left as numbers. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const cols = columns.filter((c) => c.csv);
  const cell = (v: string | number | null) => {
    if (typeof v === "number") return String(v);
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.header)).join(","), ...rows.map((r) => cols.map((c) => cell(c.csv!(r))).join(","))].join("\r\n");
}

/** Download the rows as a CSV file. */
export function downloadCsv<T>(filename: string, columns: Column<T>[], rows: T[]): void {
  const blob = new Blob([`﻿${toCsv(columns, rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-ink-secondary">
      <span><span className="font-mono text-ink">{from.toLocaleString()}–{to.toLocaleString()}</span> of {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="h-8 px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="font-mono text-ink">{page} / {pages}</span>
        <Button variant="secondary" className="h-8 px-3" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// ── The quick-view drawer (the staff Sales Orders drawer's shape: dark header, scrolling body) ────────────────────

export function Drawer({
  open, onClose, title, subtitle, headerRight, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscapeLayer(onClose, open);
  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn("fixed inset-0 z-[90] bg-ink/35 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${subtitle} ${title}`}
        className={cn(
          "fixed inset-y-0 right-0 z-[91] flex w-full max-w-[560px] flex-col bg-surface shadow-slab transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
          <button type="button" onClick={onClose} className="text-sidebar-ink-muted hover:text-sidebar-ink" aria-label="Close details">
            <XIcon size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[14px] font-bold tracking-wide">{title}</div>
            <div className="mt-0.5 text-[11px] text-sidebar-ink-muted">{subtitle}</div>
          </div>
          {headerRight}
        </div>
        <div className="thin-scroll flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

/** The lines of an order or a request: item, specification, unit and quantity. */
export function LineList({ lines }: { lines: Array<{ key: string; itemCode: string; description: string; spec: string | null; modelName?: string | null; uom: string; qty: number; right?: ReactNode; sub?: ReactNode }> }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{l.description || l.itemCode}</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{l.itemCode}{l.modelName ? ` · ${l.modelName}` : ""}</div>
            {l.spec && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{l.spec}</div>}
            {l.sub}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[13px] font-bold text-ink">{l.qty} <span className="text-[10.5px] font-semibold text-ink-muted">{l.uom}</span></div>
            {l.right && <div className="mt-1">{l.right}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
