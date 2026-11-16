// Carres only (not part of Houzs's code): the parts every supplier page shares.
//
// The supplier pages are drawn to the owner's design of 17 Nov 2026 (Claude Design, "Supplier Portal v2"): the
// design's own measurements, on the engine's own colours (theme.css), so a value here is the design's value and a
// colour is a token wherever the token is that colour. What a page needs twice lives here, once; ListTable.tsx holds
// the list table every list page draws.
//
// A supplier page still never calls a staff route: supplierSurface.test.tsx renders every supplier page and fails on
// any request that is not the suppliers' own API.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { fmtDate, fmtDateTime } from "../../vendor/shared/format";
import type { FinanceOrderState, InstalmentState, OrderPickupState, Pickup, PickupLineState } from "./api";

// ── Words and numbers ───────────────────────────────────────────────────────────────────────────────────────────

/* Dates are written by the engine's ONE date format (vendor/shared/format.ts: "2026/11/20", and "2026/11/20 10:30"
   in Kuala Lumpur time). That formatter answers a dash for a date that is not known; these answer "" instead, so each
   caller names the gap ("Not processed yet") rather than showing a mark. */
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

/** "2026-12" as "2026/12". */
export function fmtMonth(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? month.replace("-", "/") : month;
}

export const money = (n: number): string => `RM ${moneyFmt.format(n)}`;
export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-MY")} ${plural(n, one, many)}`;

/** "14:00" as "2:00 PM": the pickup time the way the warehouse says it. */
export function clock12(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026/11/20, 10:00 AM": the day Carres collects, with its time when Carres gave one. */
export const collectOn = (p: Pick<Pickup, "expectedDate" | "expectedTime">): string =>
  `${fmtDay(p.expectedDate)}${p.expectedTime ? `, ${clock12(p.expectedTime)}` : ""}`;

/** Today in Kuala Lumpur, YYYY-MM-DD: a pickup day is a calendar day there. */
export const todayMyt = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

// ── Motion (the design's own: one easing, every animation off when the person asks for less motion) ────────────

export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function play(el: Element | null | undefined, frames: Keyframe[], duration: number, easing = EASE): void {
  if (!el || reducedMotion() || typeof (el as HTMLElement).animate !== "function") return;
  (el as HTMLElement).animate(frames, { duration, easing });
}

/** Rise in (opacity and 8px) when `key` changes: a page arriving. */
export function useRise(ref: RefObject<HTMLElement | null>, key: unknown): void {
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], 420);
  }, [ref, key]);
}

// ── Badges ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type Tone = "accent" | "success" | "warning" | "error" | "neutral";
export interface BadgeSpec { label: string; tone: Tone; outline?: boolean }

const TONE: Record<Tone, string> = {
  accent: "bg-accent-soft text-primary-ink",
  success: "bg-synced/[0.12] text-synced",
  warning: "bg-warning-bg text-warning-text",
  error: "bg-err/10 text-err",
  neutral: "bg-ink-muted/10 text-ink-muted",
};
export const TONE_TEXT: Record<Tone, string> = {
  accent: "text-primary-ink",
  success: "text-synced",
  warning: "text-warning-text",
  error: "text-err",
  neutral: "text-ink-muted",
};

/** A status word in its pill. `size`: "sm" in a list cell (3px 8px), "md" in an expanded row (4px 9px), "xs" in a
 *  table inside an expanded row (10.5px). */
export function Badge({ b, size = "sm", className }: { b: BadgeSpec; size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full font-bold leading-none",
        size === "md" ? "px-[9px] py-1 text-[11px]" : size === "xs" ? "px-2 py-[3px] text-[10.5px]" : "px-2 py-[3px] text-[11px]",
        b.outline ? "bg-transparent text-ink-muted shadow-[inset_0_0_0_1px_rgba(107,114,128,.4)]" : TONE[b.tone],
        className,
      )}
    >
      {b.label}
    </span>
  );
}

/** A Sales Order's stage, in the words Carres staff use for it. A stage that is not listed reads as its own name. */
const SO_STAGE: Partial<Record<string, BadgeSpec>> = {
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
export const stageBadge = (status: string): BadgeSpec =>
  SO_STAGE[status] ?? { label: status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), tone: "neutral" };

const PICKUP_NONE: BadgeSpec = { label: "Not requested", tone: "neutral", outline: true };
/** By the state the server sends; a state this page does not know yet reads as not requested. */
const ORDER_PICKUP: Partial<Record<string, BadgeSpec>> = {
  none: PICKUP_NONE,
  requested: { label: "Pickup requested", tone: "warning" },
  accepted: { label: "Pickup accepted", tone: "accent" },
  part_collected: { label: "Part collected", tone: "accent" },
  collected: { label: "Collected", tone: "success" },
};
export const orderPickupBadge = (state: OrderPickupState | PickupLineState): BadgeSpec => ORDER_PICKUP[state] ?? PICKUP_NONE;

/** A pickup request's status for the supplier. An accepted request with a change waiting for Carres says so. */
export function pickupBadge(p: Pick<Pickup, "status" | "cancelledBySupplier" | "ask">): BadgeSpec {
  if (p.status === "REQUESTED") return { label: "Waiting for you", tone: "warning" };
  if (p.status === "COLLECTED") return { label: "Collected", tone: "success" };
  if (p.status === "CANCELLED") return { label: p.cancelledBySupplier ? "Cancelled by you" : "Cancelled by Carres", tone: "error" };
  if (p.ask) return { label: "Waiting for Carres", tone: "warning" };
  return { label: "Accepted", tone: "accent" };
}

const FIN_STATE: Record<string, BadgeSpec> = {
  on_time: { label: "On time", tone: "success" },
  behind: { label: "Behind", tone: "warning" },
  default: { label: "In default", tone: "error" },
  completed: { label: "Paid in full", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  open: { label: "Open", tone: "neutral" },
};
export const finBadge = (state: FinanceOrderState | string): BadgeSpec => FIN_STATE[state] ?? { label: state, tone: "neutral" };

/** One instalment: paid, overdue, the next one due, or still to come. `next` marks the first one not yet paid that is
 *  not overdue. */
export function instalmentBadge(state: InstalmentState | string, next: boolean): BadgeSpec {
  if (state === "paid") return { label: "Paid", tone: "success" };
  if (state === "late") return { label: "Overdue", tone: "error" };
  if (state === "waived") return { label: "Not charged", tone: "neutral" };
  if (state === "unpaid") return { label: "Not paid", tone: "neutral", outline: true };
  if (next) return { label: "Next due", tone: "accent" };
  return { label: "To come", tone: "neutral", outline: true };
}

// ── Loading one answer ──────────────────────────────────────────────────────────────────────────────────────────

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; set: (next: T) => void }

/** Load once per `key`, keep the last good answer on screen while a reload runs, and never show a stale answer for a
 *  different key. `set` puts an answer the server just gave (after an act) in place without a second read. */
export function useLoad<T>(key: string, load: () => Promise<T>, enabled = true): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: enabled });
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => (s.key === key ? { ...s, loading: true, error: null } : { key, data: null, error: null, loading: true }));
    loader.current().then(
      (data) => { if (alive) setState({ key, data, error: null, loading: false }); },
      (e: unknown) => { if (alive) setState((s) => ({ key, data: s.key === key ? s.data : null, error: e instanceof Error ? e.message : "Could not load.", loading: false })); },
    );
    return () => { alive = false; };
  }, [key, nonce, enabled]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((next: T) => setState({ key, data: next, error: null, loading: false }), [key]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: state.loading || state.key !== key, reload, set };
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-[12.5px] text-err">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-ink-secondary transition-colors hover:border-primary hover:text-primary">
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-[12.5px] text-ink-muted shadow-stone">{label}</div>;
}

// ── The toast after an act: navy pill, bottom centre, gone after 2.6 s ──────────────────────────────────────────

interface ToastMsg { msg: string; tone: "green" | "red"; n: number }
const ToastContext = createContext<(msg: string, tone?: "green" | "red") => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const show = useCallback((msg: string, tone: "green" | "red" = "green") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, tone, n: Date.now() });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (toast) play(ref.current, [{ opacity: 0, transform: "translate(-50%,12px) scale(.97)" }, { opacity: 1, transform: "translate(-50%,0) scale(1)" }], 260);
  }, [toast?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          ref={ref}
          role="status"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-[10px] bg-primary px-4 py-[11px] text-[13px] font-semibold text-white shadow-[0_16px_32px_-12px_rgba(17,24,16,.45)]"
        >
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", toast.tone === "red" ? "bg-err" : "bg-synced")}>
            <Check size={12} strokeWidth={3} className="text-white" />
          </span>
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ── Figure cards ────────────────────────────────────────────────────────────────────────────────────────────────

export interface Stat {
  label: string;
  value: ReactNode;
  /** The card's 4px left rail. */
  rail: string;
  /** The value's colour; ink when not given. */
  fg?: string;
  active?: boolean;
  onClick?: () => void;
}

/** The row of figure cards over a list. A card that filters the list is a button; the one filtering it now is marked. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const five = stats.length > 4;
  return (
    <div
      className="mb-[14px] grid shrink-0 grid-cols-2 gap-3 md:[grid-template-columns:repeat(var(--sp-cols),minmax(0,1fr))]"
      style={{ "--sp-cols": stats.length || 4 } as CSSProperties}
    >
      {stats.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={s.onClick}
          className={cn(
            "relative overflow-hidden rounded-lg border px-5 py-[18px] text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:shadow-slab",
            s.onClick ? "cursor-pointer" : "cursor-default",
            s.active
              ? "border-primary/60 bg-primary-soft/30 shadow-[0_0_0_1px_rgba(27,27,57,0.3),0_1px_0_rgba(17,24,16,.04),0_4px_18px_-8px_rgba(17,24,16,.12)]"
              : "border-border bg-surface shadow-stone",
          )}
        >
          <span className="absolute inset-y-0 left-0 w-1" style={{ background: s.rail }} />
          <div className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{s.label}</div>
          <div className={cn("mt-3 whitespace-nowrap font-extrabold leading-none tracking-[-0.025em]", five ? "text-[21px]" : "text-[26px]")} style={{ color: s.fg ?? "rgb(var(--hz-ink))" }}>
            {s.value}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Pills and the Table / Cards switch ──────────────────────────────────────────────────────────────────────────

const SEG_FRAME = "inline-block overflow-hidden rounded-md border border-border bg-surface shadow-stone";

export function Pills<K extends string>({ value, onChange, options }: { value: K; onChange: (k: K) => void; options: Array<{ key: K; label: string; count: number }> }) {
  return (
    <div className={SEG_FRAME}>
      <div className="flex items-center gap-0.5 p-1">
        {options.map((o) => {
          const on = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.key)}
              className={cn(
                "whitespace-nowrap rounded px-[14px] py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all duration-150",
                on ? "bg-primary text-white" : "bg-transparent text-ink-secondary",
              )}
            >
              {o.label}
              <span className={cn("ml-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[10px] font-bold", on ? "bg-white/20 text-white" : "bg-border-subtle text-ink-muted")}>
                {o.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type ViewMode = "table" | "cards";

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (which: ViewMode, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === which}
      onClick={() => onChange(which)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider",
        value === which ? "bg-primary text-white" : "bg-transparent text-ink-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className={SEG_FRAME}>
      <div className="flex items-center gap-0.5 p-1">
        {btn("table", "Table", <TableGlyph />)}
        {btn("cards", "Cards", <GridGlyph />)}
      </div>
    </div>
  );
}

/* The design's own two glyphs (lucide "table" and "layout-grid"), at its 13px. */
function TableGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />
    </svg>
  );
}
function GridGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

// ── Cards on a full page ────────────────────────────────────────────────────────────────────────────────────────

/** A white section with its uppercase name in a header strip, as the full pages draw every block. */
export function Section({ title, aside, children, className, bodyClassName }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface shadow-stone", className)}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="m-0 text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{title}</h2>
        {aside}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A figure card on a full page: rail, label, value, and one line under it. */
export function Kpi({ label, value, sub, rail, fg, size = 22 }: { label: string; value: ReactNode; sub: ReactNode; rail: string; fg?: string; size?: 21 | 22 }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface px-[18px] py-4 shadow-stone">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: rail }} />
      <div className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{label}</div>
      <div className={cn("mt-2.5 whitespace-nowrap font-extrabold leading-none tracking-[-0.02em]", size === 21 ? "text-[21px]" : "text-[22px]")} style={{ color: fg ?? "rgb(var(--hz-ink))" }}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-ink-muted">{sub}</div>
    </div>
  );
}

/** label / value pairs, the design's fact list. A value not known is said in words, in the muted ink. */
export interface FactSpec { label: string; value: ReactNode; muted?: boolean; fg?: string }

export function Facts({ facts, labelWidth = 118, size = 13, gap = 8 }: { facts: FactSpec[]; labelWidth?: number; size?: 12.5 | 13; gap?: 6 | 8 | 10 }) {
  return (
    <dl
      className="m-0 grid"
      style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)`, rowGap: gap, columnGap: labelWidth >= 128 ? 16 : labelWidth <= 110 ? 12 : 14, fontSize: size }}
    >
      {facts.map((f) => (
        <FactPair key={f.label} f={f} />
      ))}
    </dl>
  );
}
function FactPair({ f }: { f: FactSpec }) {
  return (
    <>
      <dt className="text-ink-muted">{f.label}</dt>
      <dd className="m-0 whitespace-normal leading-[1.45]" style={{ color: f.fg ?? (f.muted ? "rgb(var(--hz-ink-muted))" : "rgb(var(--hz-ink))") }}>{f.value}</dd>
    </>
  );
}

/** "Open full page ↗". */
export function OpenFull({ onClick, className, boxed }: { onClick: () => void; className?: string; boxed?: boolean }) {
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-semibold text-primary-ink",
        boxed ? "rounded-md border border-primary-ink/35 px-2.5 py-[5px] text-[12px] hover:bg-accent-soft hover:no-underline" : "text-[12.5px] hover:underline",
        className,
      )}
    >
      Open full page
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    </a>
  );
}

/** The small PDF mark beside a document's name. */
export function PdfMark({ w = 28, h = 32, fs = 8.5 }: { w?: number; h?: number; fs?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded border border-border bg-surface-2 font-bold text-err" style={{ width: w, height: h, fontSize: fs }}>
      PDF
    </span>
  );
}

/** A collection grid: one cell a month, twelve to a row (green paid, red overdue, grey still to come). */
export function MonthGrid({ cells, height = 8, gap = 3, radius = 2 }: { cells: Array<{ tone: "paid" | "late" | "rest"; tip?: string }>; height?: number; gap?: number; radius?: number }) {
  return (
    <div className="grid grid-cols-12" style={{ gap }}>
      {cells.map((c, i) => (
        <span
          key={i}
          title={c.tip}
          style={{ height, borderRadius: radius, background: c.tone === "paid" ? "rgb(var(--hz-synced))" : c.tone === "late" ? "rgb(var(--hz-err))" : "rgb(var(--hz-border))" }}
        />
      ))}
    </div>
  );
}

/** The paid / overdue bar. `paid` and `late` are parts of 1. */
export function ProgressBar({ paid, late, width, height = 6 }: { paid: number; late: number; width?: number; height?: number }) {
  return (
    <span className="flex overflow-hidden rounded-full bg-surface-dim" style={{ height, width }}>
      <span className="h-full bg-synced" style={{ width: `${Math.max(0, Math.min(1, paid)) * 100}%` }} />
      <span className="h-full bg-err" style={{ width: `${Math.max(0, Math.min(1, late)) * 100}%` }} />
    </span>
  );
}
