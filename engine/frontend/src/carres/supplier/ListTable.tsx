// Carres only (not part of Houzs's code): the one list table every supplier list page draws.
//
// The owner's design (17 Nov 2026): the list never scrolls as a whole page. Its frame fills the height that is left
// and scrolls inside itself on both axes, with the header row and the totals row pinned. A row opens IN PLACE, under
// itself, across the visible width (one row open at a time); a document number goes straight to its full page.
// Column edges drag to resize (double-click resets), Wrap lets long cells wrap, Columns turns columns on and off,
// and Export writes the rows showing (or the ticked ones) with the columns showing. What a person sets here is kept
// for this browser only.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Columns3, Download, Search, WrapText } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge, EASE, ProgressBar, play, plural, type BadgeSpec } from "./ui";

// ── Columns and cells ───────────────────────────────────────────────────────────────────────────────────────────

export type Cell =
  | { kind: "doc"; v: string; go?: () => void }
  | { kind: "text"; v: ReactNode; title?: string; fg?: string; bold?: boolean }
  | { kind: "badge"; b: BadgeSpec }
  | { kind: "prog"; v: string; paid: number; late: number };

export interface Column<T> {
  key: string;
  label: string;
  /** The design's default width, in px. */
  width: number;
  align?: "left" | "right";
  /** Off until turned on in Columns. */
  hidden?: boolean;
  render: (row: T) => Cell;
  exportValue: (row: T) => string | number;
  /** The totals row's cell for this column, worked out from the rows showing. */
  foot?: (rows: T[]) => { v: ReactNode; fg?: string };
}

// ── What a person sets on a list, kept for this browser ─────────────────────────────────────────────────────────

export interface ListPrefs {
  widths: Record<string, number>;
  hidden: Record<string, boolean>;
  wrap: boolean;
  mode: "table" | "cards";
}

const read = (key: string): Partial<ListPrefs> => {
  try {
    const raw = window.localStorage.getItem(`carres.supplier.list.${key}`);
    return raw ? (JSON.parse(raw) as Partial<ListPrefs>) : {};
  } catch {
    return {};
  }
};

export function useListPrefs(key: string) {
  const [prefs, setPrefs] = useState<ListPrefs>(() => {
    const kept = read(key);
    return { widths: kept.widths ?? {}, hidden: kept.hidden ?? {}, wrap: !!kept.wrap, mode: kept.mode === "cards" ? "cards" : "table" };
  });
  useEffect(() => {
    try { window.localStorage.setItem(`carres.supplier.list.${key}`, JSON.stringify(prefs)); } catch { /* storage blocked: kept for this page only */ }
  }, [key, prefs]);
  const setWidth = useCallback((col: string, w: number | null) => setPrefs((p) => {
    const widths = { ...p.widths };
    if (w === null) delete widths[col];
    else widths[col] = w;
    return { ...p, widths };
  }), []);
  const setHidden = useCallback((col: string, off: boolean) => setPrefs((p) => ({ ...p, hidden: { ...p.hidden, [col]: off } })), []);
  const resetHidden = useCallback(() => setPrefs((p) => ({ ...p, hidden: {} })), []);
  const setWrap = useCallback((wrap: boolean) => setPrefs((p) => ({ ...p, wrap })), []);
  const setMode = useCallback((mode: "table" | "cards") => setPrefs((p) => ({ ...p, mode })), []);
  return { prefs, setWidth, setHidden, resetHidden, setWrap, setMode };
}
export type ListPrefsApi = ReturnType<typeof useListPrefs>;

/** Whether a column shows: its own setting when the person changed it, else its default. */
export const isShown = <T,>(c: Column<T>, prefs: ListPrefs): boolean => (c.key in prefs.hidden ? !prefs.hidden[c.key] : !c.hidden);

// ── Toolbar: search · counts · Export · Wrap · Columns ──────────────────────────────────────────────────────────

const TOOL_BTN = "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold uppercase tracking-wider transition-all duration-150 hover:border-primary/40 hover:bg-primary-soft hover:text-primary";

export function Toolbar<T>({
  search, onSearch, placeholder, rowCount, columns, api, onExport, exportCount, canExport = true,
}: {
  search: string;
  onSearch: (q: string) => void;
  placeholder: string;
  rowCount: number;
  columns: Column<T>[];
  api: ListPrefsApi;
  onExport: () => Promise<void> | void;
  /** Rows ticked: Export writes those. */
  exportCount: number;
  canExport?: boolean;
}) {
  const shown = columns.filter((c) => isShown(c, api.prefs)).length;
  const [busy, setBusy] = useState(false);
  const exportNow = async () => {
    if (busy) return;
    setBusy(true);
    try { await onExport(); } finally { setBusy(false); }
  };
  const ticked = exportCount > 0;
  return (
    <div className="mb-2.5 flex shrink-0 flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-[288px]">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-[34px] w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[12.5px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted focus:border-primary focus:shadow-[0_0_0_3px_rgba(27,27,57,0.12)]"
        />
      </div>
      <div className="whitespace-nowrap text-[11px] font-medium text-ink-secondary">
        <span className="text-ink">{rowCount}</span>
        <span className="ml-1 text-ink-muted">{plural(rowCount, "row")}</span>
        <span className="mx-2 text-ink-muted">·</span>
        <span className="text-ink">{shown}</span>
        <span className="ml-1 text-ink-muted">of {columns.length} cols</span>
      </div>
      <div className="flex-1" />
      {canExport && (
        <button
          type="button"
          onClick={exportNow}
          disabled={busy}
          className={cn(TOOL_BTN, ticked ? "border-primary bg-primary-soft/50 text-primary" : "border-border bg-surface text-ink-secondary")}
        >
          <Download size={13} aria-hidden="true" />
          {busy ? "Exporting…" : ticked ? `Export (${exportCount})` : "Export"}
        </button>
      )}
      <button
        type="button"
        aria-pressed={api.prefs.wrap}
        onClick={() => api.setWrap(!api.prefs.wrap)}
        className={cn(TOOL_BTN, api.prefs.wrap ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-surface text-ink-secondary")}
      >
        <WrapText size={13} aria-hidden="true" />
        Wrap
      </button>
      <ColumnsMenu columns={columns} api={api} shown={shown} />
    </div>
  );
}

function ColumnsMenu<T>({ columns, api, shown }: { columns: Column<T>[]; api: ListPrefsApi; shown: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface px-[14px] text-[12.5px] font-medium text-ink-secondary shadow-[0_1px_1px_rgba(17,20,15,.03)] transition-all duration-[120ms] hover:-translate-y-px hover:border-primary/45"
      >
        <Columns3 size={14} className="text-ink-muted" aria-hidden="true" />
        Columns
        <span className="text-ink-muted">·</span>
        <span className="text-[11.5px] font-bold">{shown}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[40px] z-20 w-[230px] rounded-[10px] border border-border bg-surface p-1.5 shadow-slab">
          {columns.map((c, i) => {
            const on = isShown(c, api.prefs);
            const fixed = i === 0;
            return (
              <label key={c.key} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] text-ink hover:bg-surface-2", fixed && "cursor-default opacity-60")}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={fixed}
                  onChange={() => api.setHidden(c.key, on)}
                  className="m-0 h-3.5 w-3.5 accent-primary"
                />
                {c.label}
              </label>
            );
          })}
          <div className="mt-1 flex justify-between border-t border-border-subtle px-1 pt-1.5">
            <button type="button" onClick={api.resetHidden} className="rounded-md px-2 py-1 text-[12px] font-semibold text-ink-secondary hover:bg-surface-2 hover:text-ink">Reset to default</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-primary hover:bg-primary-soft/50">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The rows showing (or ticked), with the columns showing, as an Excel file. */
export async function exportList<T>(name: string, columns: Column<T>[], prefs: ListPrefs, rows: T[]): Promise<void> {
  const cols = columns.filter((c) => isShown(c, prefs));
  const X = await import("../../lib/xlsx-runtime");
  const sheet = X.utils.aoa_to_sheet([cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => c.exportValue(r)))]);
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, sheet, "Sheet1");
  X.writeFileXLSX(book, `${name}.xlsx`);
}

// ── The table ───────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (i: number, n: number) => ({ paddingLeft: i === 0 ? 20 : 12, paddingRight: i === n - 1 ? 20 : 12 });

export interface ListTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  api: ListPrefsApi;
  /** The open row, drawn under itself by `expanded`. */
  openKey: string | null;
  onToggle: (key: string) => void;
  expanded: (row: T, width: number) => ReactNode;
  /** Ticking rows: off when not given. */
  picked?: Record<string, boolean>;
  onPick?: (next: Record<string, boolean>) => void;
  /** Draw the totals row. */
  totals?: boolean;
  empty: ReactNode;
  /** Under the table: the row count, or the ticked rows' summary. */
  footer: ReactNode;
}

export function ListTable<T>({ columns, rows, rowKey, api, openKey, onToggle, expanded, picked, onPick, totals, empty, footer }: ListTableProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [visibleWidth, setVisibleWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // The visible width, rounded DOWN: clientWidth rounds a fractional width up, and an open row a fraction wider
    // than the table would put a scrollbar under a list that fits.
    const measure = () => setVisibleWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width) - (el.offsetWidth - el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = columns.filter((c) => isShown(c, api.prefs));
  const width = (c: Column<T>) => api.prefs.widths[c.key] ?? c.width;
  const canPick = !!onPick;
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const pickedCount = canPick ? keys.filter((k) => picked?.[k]).length : 0;
  const allPicked = canPick && keys.length > 0 && pickedCount === keys.length;
  const span = 1 + (canPick ? 1 : 0) + cols.length;
  const tableWidth = 36 + (canPick ? 44 : 0) + cols.reduce((a, c) => a + width(c), 0);
  const wrap = api.prefs.wrap;

  const togglePick = (k: string) => onPick?.({ ...(picked ?? {}), [k]: !picked?.[k] });
  const toggleAll = () => {
    const next = { ...(picked ?? {}) };
    for (const k of keys) next[k] = !allPicked;
    onPick?.(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-stone">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="min-w-full border-separate border-spacing-0" style={{ tableLayout: "fixed", width: tableWidth }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-[3] w-9 border-b border-border bg-surface-2 p-0" style={{ width: 36 }} />
              {canPick && (
                <th className="sticky top-0 z-[3] border-b border-border bg-surface-2 py-2.5 pl-5 pr-0 text-left" style={{ width: 44 }}>
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all rows" className="m-0 h-3.5 w-3.5 cursor-pointer align-middle accent-primary" />
                </th>
              )}
              {cols.map((c, i) => (
                <HeadCell key={c.key} label={c.label} align={c.align ?? "left"} width={width(c)} resized={c.key in api.prefs.widths} pad={pad(i, cols.length)}
                  onResize={(w) => api.setWidth(c.key, w)} onReset={() => api.setWidth(c.key, null)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={span} className="px-5 py-14 text-center text-[12.5px] text-ink-muted">{empty}</td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const k = keys[idx]!;
              const open = openKey === k;
              const ticked = !!picked?.[k];
              const bg = open ? "rgba(220,230,253,0.4)" : ticked ? "rgba(27,27,57,0.06)" : "#fff";
              return (
                <Fragment key={k}>
                  <tr
                    onClick={() => onToggle(k)}
                    aria-expanded={open}
                    className="cursor-pointer transition-colors duration-[160ms] hover:!bg-primary-soft/35"
                    style={{ background: bg }}
                  >
                    <td className="align-middle" style={{ width: 36, padding: "0 0 0 14px", borderBottom: `1px solid ${open ? "transparent" : "rgb(var(--hz-border-subtle))"}`, color: open ? "rgb(var(--hz-primary))" : "#9AA0A8" }}>
                      <ChevronRight size={14} className="block" style={{ transform: open ? "rotate(90deg)" : "none", transition: `transform 220ms ${EASE}` }} aria-hidden="true" />
                    </td>
                    {canPick && (
                      <td onClick={(e) => e.stopPropagation()} className="border-b border-border-subtle py-[9px] pl-5 pr-0 align-middle" style={{ width: 44 }}>
                        <input type="checkbox" checked={ticked} onChange={() => togglePick(k)} aria-label="Select row" className="m-0 h-3.5 w-3.5 cursor-pointer align-middle accent-primary" />
                      </td>
                    )}
                    {cols.map((c, i) => (
                      <BodyCell key={c.key} cell={c.render(r)} align={c.align ?? "left"} pad={pad(i, cols.length)} wrap={wrap} first={i === 0} open={open} />
                    ))}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={span} className="border-b border-border bg-[#FBFBFC] p-0 shadow-[inset_3px_0_0_rgb(var(--hz-primary))]">
                        <Expansion width={visibleWidth}>{expanded(r, visibleWidth)}</Expansion>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky bottom-0 border-t border-border bg-surface-2" />
                {canPick && <td className="sticky bottom-0 border-t border-border bg-surface-2" />}
                {cols.map((c, i) => {
                  const f = c.foot?.(rows);
                  return (
                    <td
                      key={c.key}
                      className="sticky bottom-0 overflow-hidden text-ellipsis whitespace-nowrap border-t border-border bg-surface-2 py-2.5 text-[13px] font-bold"
                      style={{ ...pad(i, cols.length), textAlign: c.align ?? "left", color: f?.fg ?? "rgb(var(--hz-ink))" }}
                    >
                      {f?.v ?? ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {footer}
    </div>
  );
}

/** The open row's content, pinned to the visible width so it stays in view however far the table is scrolled
 *  sideways, and faded in as it opens. */
function Expansion({ width, children }: { width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], 260);
  }, []);
  return (
    <div ref={ref} className="sticky left-0 whitespace-normal" style={{ width: width ? `${width}px` : "100%" }}>
      {children}
    </div>
  );
}

function HeadCell({ label, align, width, resized, pad: p, onResize, onReset }: {
  label: string; align: "left" | "right"; width: number; resized: boolean; pad: { paddingLeft: number; paddingRight: number };
  onResize: (w: number) => void; onReset: () => void;
}) {
  const start = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => onResize(Math.max(56, Math.round(w0 + ev.clientX - x0)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <th
      className="sticky top-0 z-[2] overflow-hidden text-ellipsis whitespace-nowrap border-b border-border bg-surface-2 py-2.5 text-[11.5px] font-semibold text-ink-secondary"
      style={{ ...p, textAlign: align, width }}
    >
      {label}
      <span
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to reset"
        onPointerDown={start}
        onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
        className="absolute right-0 top-0 flex h-full w-2 cursor-col-resize justify-center hover:bg-primary/[0.08]"
      >
        <span className="my-auto h-1/2 w-px" style={{ background: resized ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border-strong))" }} />
      </span>
    </th>
  );
}

function BodyCell({ cell, align, pad: p, wrap, first, open }: { cell: Cell; align: "left" | "right"; pad: { paddingLeft: number; paddingRight: number }; wrap: boolean; first: boolean; open: boolean }) {
  const ws = wrap ? "normal" : "nowrap";
  const fg = cell.kind === "text" && cell.fg ? cell.fg : "rgb(var(--hz-ink))";
  return (
    <td
      className="overflow-hidden text-ellipsis border-b border-border-subtle py-[9px] align-middle text-[13px] leading-[1.3]"
      style={{ ...p, textAlign: align, whiteSpace: ws, color: fg, boxShadow: first && cell.kind === "doc" && open ? "inset 3px 0 0 rgb(var(--hz-primary))" : "none" }}
    >
      {cell.kind === "doc" && (
        <div
          onClick={cell.go ? (e) => { e.stopPropagation(); cell.go?.(); } : undefined}
          title={cell.go ? "Open full page" : undefined}
          className={cn("inline-block font-docno text-[12.5px] font-semibold text-primary-ink", cell.go ? "cursor-pointer hover:underline" : "cursor-[inherit]")}
        >
          {cell.v}
        </div>
      )}
      {cell.kind === "text" && (
        <div title={cell.title ?? (typeof cell.v === "string" ? cell.v : undefined)} className="overflow-hidden text-ellipsis" style={{ whiteSpace: ws, fontWeight: cell.bold ? 600 : 400 }}>
          {cell.v}
        </div>
      )}
      {cell.kind === "badge" && <Badge b={cell.b} />}
      {cell.kind === "prog" && (
        <div className="flex items-center gap-2">
          <span className="min-w-[44px] font-semibold">{cell.v}</span>
          <ProgressBar paid={cell.paid} late={cell.late} width={72} />
        </div>
      )}
    </td>
  );
}

// ── Under the table ─────────────────────────────────────────────────────────────────────────────────────────────

/** "40 sales orders". */
export function ListCount({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-3 whitespace-nowrap border-t border-border bg-surface px-5 py-2 text-[11.5px] text-ink-secondary">{children}</div>;
}

/** The dark bar that replaces the count while rows are ticked. */
export function SelectionBar({ n, items, onClear, rounded }: { n: number; items: Array<{ v: ReactNode; label: string; fg?: string }>; onClear: () => void; rounded?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-5 whitespace-nowrap bg-primary px-5 py-2.5 text-white", rounded && "mt-2.5 rounded-lg")}>
      <span className="text-[12.5px] font-bold">{n} selected</span>
      <span className="h-4 w-px bg-white/25" />
      {items.map((t) => (
        <span key={t.label} className="inline-flex items-baseline gap-1.5">
          <span className="text-[15px] font-extrabold" style={{ color: t.fg ?? "#fff" }}>{t.v}</span>
          <span className="text-[11.5px] text-white/70">{t.label}</span>
        </span>
      ))}
      <span className="flex-1" />
      <button type="button" onClick={onClear} className="rounded-md border border-white/30 bg-transparent px-2.5 py-[5px] text-[12px] font-semibold text-white hover:bg-white/10">Clear</button>
    </div>
  );
}

// ── The Cards view ──────────────────────────────────────────────────────────────────────────────────────────────

export interface CardSpec {
  key: string;
  doc: string;
  badge: BadgeSpec;
  title: string;
  line: string;
  progress?: { paid: number; late: number };
  footLabel: string;
  footValue: string;
  rightLabel: string;
  rightLabelFg?: string;
  right: string;
  rightFg?: string;
  onOpen: () => void;
}

export function CardsView({ cards, picked, onPick, empty, footer }: {
  cards: CardSpec[];
  picked?: Record<string, boolean>;
  onPick?: (next: Record<string, boolean>) => void;
  empty: ReactNode;
  footer: ReactNode;
}) {
  return (
    <>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
        {cards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center text-[12.5px] text-ink-muted">{empty}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((k) => {
              const ticked = !!picked?.[k.key];
              return (
                <div
                  key={k.key}
                  role="button"
                  tabIndex={0}
                  onClick={k.onOpen}
                  onKeyDown={(e) => { if (e.key === "Enter") k.onOpen(); }}
                  className={cn(
                    "relative cursor-pointer overflow-hidden rounded-lg border px-4 py-[14px] shadow-stone transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-primary/40 hover:shadow-slab",
                    ticked ? "border-primary bg-primary-soft/35" : "border-border bg-surface",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {onPick && (
                      <span onClick={(e) => e.stopPropagation()} className="flex">
                        <input type="checkbox" checked={ticked} onChange={() => onPick({ ...(picked ?? {}), [k.key]: !ticked })} aria-label="Select" className="m-0 h-3.5 w-3.5 cursor-pointer accent-primary" />
                      </span>
                    )}
                    <span className="flex-1 truncate font-docno text-[12.5px] font-semibold text-primary-ink">{k.doc}</span>
                    <Badge b={k.badge} className="shrink-0" />
                  </div>
                  <div className="mt-2.5 truncate text-[15px] font-semibold text-ink">{k.title}</div>
                  <div className="mt-[3px] truncate text-[12px] text-ink-secondary">{k.line}</div>
                  {k.progress && <div className="mt-2.5"><ProgressBar paid={k.progress.paid} late={k.progress.late} /></div>}
                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-border-subtle pt-2.5">
                    <div className="min-w-0">
                      <div className="whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{k.footLabel}</div>
                      <div className="mt-[3px] whitespace-nowrap text-[12.5px] font-semibold text-ink-secondary">{k.footValue}</div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="whitespace-nowrap text-[11px] font-semibold" style={{ color: k.rightLabelFg ?? "rgb(var(--hz-ink-muted))" }}>{k.rightLabel}</div>
                      <div className="mt-[3px] whitespace-nowrap text-[15px] font-bold" style={{ color: k.rightFg ?? "rgb(var(--hz-ink))" }}>{k.right}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {footer}
    </>
  );
}

/** The plain count under the cards (the table draws it inside its frame). */
export function CardsCount({ children }: { children: ReactNode }) {
  return <div className="shrink-0 pt-2.5 text-[11.5px] text-ink-secondary">{children}</div>;
}
