// Carres only (not part of Houzs's code): the small parts the supplier pages share.
//
// Owner, 16 Nov 2026: the supplier pages look exactly like the staff list pages. So the lists are drawn with the
// staff page's OWN parts (components/DataTable, StatCard, FilterPills, ListPager, ResizableDetailDrawer), and what
// is here is only what the staff page keeps inside its own file: the page header's look (components/Layout's
// PageHeader sits in a file that loads the staff shell), the Table / Cards switch and the cards.
//
// A supplier page still never calls a staff route. The staff table syncs its column layouts with the server only
// after the STAFF sign-in starts that sync (auth/AuthContext hydrateTableLayouts), and the supplier pages are mounted
// outside the staff sign-in, so the table keeps its layout in this browser alone. supplierSurface.test.tsx renders
// every supplier page and fails on any request that is not the suppliers' own API.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, Table as TableIcon, X as XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ResizableDetailDrawer } from "../../components/ResizableDetailDrawer";
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

export const orderPickupLabel = (state: OrderPickupState | PickupLineState): string => ORDER_PICKUP[state].label;

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

/**
 * The staff page header (components/Layout PageHeader): a brass rule and an uppercase eyebrow, the title, one line
 * of what the page is, the actions on the right, a rule under it. The same classes, so the two read as one product.
 * Not pinned: on the staff pages it pins under the staff top bar, and the supplier pages have their own header.
 */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 sm:mb-6 sm:pb-5 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="min-w-0 md:flex-1 md:basis-72">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2 sm:mb-2">
            <span className="h-px w-5 bg-accent sm:w-6" />
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-brand text-accent sm:text-[10px]">{eyebrow}</span>
          </div>
        )}
        <h1 className="font-display text-[19px] font-extrabold leading-tight tracking-tight text-ink max-[359px]:text-[17px] sm:text-[26px] lg:text-[28px]">
          {title}
        </h1>
        {description && <div className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-secondary sm:mt-1.5 sm:text-sm">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:gap-2 md:shrink-0">{actions}</div>}
    </div>
  );
}

export type ViewMode = "table" | "cards";

/** The staff list's Table / Cards switch (pages/scm-v2/MfgSalesOrdersListV2 ViewToggle), the same classes. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (which: ViewMode, label: string, Icon: typeof TableIcon) => {
    const active = value === which;
    return (
      <button
        type="button"
        onClick={() => onChange(which)}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
          active ? "bg-primary text-white shadow-sm" : "text-ink-secondary hover:bg-primary-soft hover:text-primary",
        )}
      >
        <Icon size={13} />
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-stone">
      {btn("table", "Table", TableIcon)}
      {btn("cards", "Cards", LayoutGrid)}
    </div>
  );
}

/** The staff list's cards view (MfgSalesOrdersListV2 CardsGrid): one card a row, three across on a wide screen. */
export function CardsGrid<T>({ rows, rowKey, render, onOpen, empty }: {
  rows: T[];
  rowKey: (row: T) => string;
  render: (row: T) => ReactNode;
  onOpen: (row: T) => void;
  empty: ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center text-[12.5px] text-ink-muted shadow-stone">{empty}</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <button
          key={rowKey(r)}
          type="button"
          onClick={() => onOpen(r)}
          className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-surface px-4 py-4 text-left shadow-stone transition-all duration-200 hover:-translate-y-px hover:border-primary/40 hover:shadow-slab focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {render(r)}
        </button>
      ))}
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

// ── The quick-view drawer: the staff drawer's chrome (ResizableDetailDrawer: scrim, panel, drag to widen, the width
//    remembered) with the staff Sales Orders drawer's inside (dark header, scrolling body, footer) ────────────────

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
  return (
    <ResizableDetailDrawer open={open} onClose={onClose} ariaLabel={`${subtitle} ${title}`}>
      <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sidebar-ink-muted hover:text-sidebar-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40" aria-label="Close details">
          <XIcon size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[14px] font-bold tracking-wide">{title}</div>
          <div className="mt-0.5 text-[11px] text-sidebar-ink-muted">{subtitle}</div>
        </div>
        {headerRight}
      </div>
      <div className="thin-scroll flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
    </ResizableDetailDrawer>
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
