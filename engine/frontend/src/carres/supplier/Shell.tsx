// Carres only (not part of Houzs's code): the signed-in frame of the supplier pages.
//
// The owner's design (17 Nov 2026): a white 56px header (the Carres wordmark, the tabs with an underline that slides
// to the open one, the role chip, the company and the person, Settings and Sign out), a grey bar under it that names
// the page, and the page. A list page never scrolls as a whole: the page fills the window and its table scrolls
// inside itself. A full page scrolls.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, LogOut, Settings } from "lucide-react";
import { cn } from "../../lib/utils";
import { usePublicCompany } from "../publicBranding";
import type { Department, Me } from "./api";
import { EASE, useRise } from "./ui";
import { BASE } from "./host";

export const LOGO = "/logo-wordmark.png";

// ── The session ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface Session {
  me: Me;
  refresh: () => void;
  signOut: () => void;
  /** Whether the person holds this permission in this department. */
  can: (dept: Department, key: string) => boolean;
}
const SessionContext = createContext<Session | null>(null);
export const SessionProvider = SessionContext.Provider;

export function useSupplierSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSupplierSession outside the supplier app");
  return s;
}

export function makeCan(me: Me) {
  // Every Me passes through normalizeMe (./api.ts), which gives both departments a list.
  return (dept: Department, key: string): boolean => me.user.perms[dept].includes(key);
}

export interface Tab { to: string; label: string; badge: number; dept: Department }

/** The tabs a person sees, in one order, each only when their access opens its page: Sales Orders, Collections right
 *  beside it (Loo, 19 Nov 2026), Forecast, Pickup Requests, By Month. */
export function tabsFor(me: Me): Tab[] {
  const can = makeCan(me);
  // A 3PL company sees its own deliveries, never Sales Orders, Forecast or Pickup Requests (owner, 19 Nov 2026).
  const logistics = me.user.canOperation && me.supplier.logistics;
  const operation = me.user.canOperation && !me.supplier.logistics;
  const finance = me.user.canFinance;
  const out: Tab[] = [];
  if (logistics && can("operation", "v_deliveries")) out.push({ to: `${BASE}/deliveries`, label: "Deliveries", badge: 0, dept: "operation" });
  if (operation && can("operation", "v_orders")) out.push({ to: `${BASE}/orders`, label: "Sales Orders", badge: 0, dept: "operation" });
  if (finance && can("finance", "v_coll")) out.push({ to: `${BASE}/collections`, label: "Collections", badge: 0, dept: "finance" });
  if (operation && can("operation", "v_forecast")) out.push({ to: `${BASE}/forecast`, label: "Forecast", badge: 0, dept: "operation" });
  if (operation && can("operation", "v_pickups")) out.push({ to: `${BASE}/pickups`, label: "Pickup Requests", badge: me.badges.pickupsToAccept, dept: "operation" });
  if (finance && can("finance", "v_month")) out.push({ to: `${BASE}/months`, label: "By Month", badge: 0, dept: "finance" });
  return out;
}

/** Where a person lands: the first page their access opens, else Settings. */
export const homeFor = (me: Me): string => (me.user.mustChangePassword ? `${BASE}/settings` : tabsFor(me)[0]?.to ?? `${BASE}/settings`);

export const ROLE_LABEL: Record<Department, string> = { operation: "Warehouse and Operation", finance: "Finance" };

/** A department's name as this person reads it: a 3PL company's Warehouse and Operation people are its Logistics. */
export const roleLabel = (d: Department, logistics: boolean): string => (logistics && d === "operation" ? "Logistics" : ROLE_LABEL[d]);

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("") || "?";

// ── The header ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Which tab a path belongs to: a full page sits under the tab it was opened from. */
function activeTab(pathname: string, search: string, tabs: Tab[]): string | null {
  if (pathname.startsWith(`${BASE}/settings`)) return null;
  const from = new URLSearchParams(search).get("from") ?? "";
  if (pathname.startsWith(`${BASE}/collections/`) && (from === "months" || from.startsWith("month:"))) return `${BASE}/months`;
  const hit = tabs.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`));
  return hit?.to ?? null;
}

function Header({ me, onSignOut, locked }: { me: Me; onSignOut: () => void; locked: boolean }) {
  const company = usePublicCompany();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const tabs = locked ? [] : tabsFor(me);
  const active = activeTab(pathname, search, tabs);
  const nav = useRef<HTMLElement | null>(null);
  const [bar, setBar] = useState({ x: 0, w: 0 });
  const inSettings = pathname.startsWith(`${BASE}/settings`);

  const measure = useCallback(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-tab="${active ?? ""}"]`);
    if (!el) return;
    setBar((b) => (b.x === el.offsetLeft && b.w === el.offsetWidth ? b : { x: el.offsetLeft, w: el.offsetWidth }));
  }, [active]);
  useLayoutEffect(() => { measure(); }, [measure, me.badges.pickupsToAccept]);
  useEffect(() => {
    const t = setTimeout(measure, 300); // the web font may land after the first measure
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [measure]);

  const depts: Department[] = [...(me.user.canOperation ? (["operation"] as const) : []), ...(me.user.canFinance ? (["finance"] as const) : [])];
  return (
    <header className="relative z-[6] flex h-14 shrink-0 items-center gap-5 border-b border-border bg-surface px-6">
      <img src={LOGO} alt={company.companyName} className="h-[22px] w-auto object-contain" draggable={false} />
      <span className="h-5 w-px bg-border" />
      <nav ref={nav} aria-label="Supplier pages" className="no-scrollbar relative flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            data-tab={t.to}
            className={cn("flex items-center gap-2 whitespace-nowrap px-3 text-[13px] font-semibold transition-colors duration-[160ms] hover:text-ink", active === t.to ? "text-ink" : "text-ink-muted")}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-err px-1.5 text-[10px] font-bold text-white" aria-label={`${t.badge} waiting`}>
                {t.badge}
              </span>
            )}
          </NavLink>
        ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-1px] left-0 h-0.5 rounded-sm bg-primary"
          style={{ width: active ? bar.w : 0, transform: `translateX(${bar.x}px)`, transition: `transform 320ms ${EASE}, width 320ms ${EASE}` }}
        />
      </nav>
      <div className="flex-1" />
      {depts.map((d) => (
        <span key={d} className={cn("hidden whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold md:inline", d === "finance" ? "bg-accent-soft text-primary-ink" : "bg-synced/[0.12] text-synced")}>
          {roleLabel(d, me.supplier.logistics)}
        </span>
      ))}
      <div className="hidden whitespace-nowrap text-right leading-[1.3] md:block">
        <div className="text-[12.5px] font-bold text-ink">{me.supplier.name}</div>
        <div className="text-[11px] text-ink-muted">{me.user.name}</div>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary" aria-hidden="true">{initials(me.user.name)}</span>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => navigate(`${BASE}/settings`, { state: { back: `${pathname}${search}` } })}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-all duration-[160ms] hover:border-primary hover:text-primary",
          inSettings ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-ink-secondary",
        )}
      >
        <Settings size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Sign out"
        aria-label="Sign out"
        onClick={onSignOut}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary transition-all duration-[160ms] hover:border-primary hover:text-primary"
      >
        <LogOut size={14} aria-hidden="true" />
      </button>
    </header>
  );
}

export function Shell({ me, onSignOut, children }: { me: Me; onSignOut: () => void; children: ReactNode }) {
  return (
    <div className="sp-root relative flex h-[100dvh] min-h-[640px] flex-col overflow-hidden bg-bg font-body text-ink antialiased">
      <Header me={me} onSignOut={onSignOut} locked={me.user.mustChangePassword} />
      {children}
    </div>
  );
}

// ── The bar that names the page ─────────────────────────────────────────────────────────────────────────────────

export function PageBar({ eyebrow, title, mono, back, backTip, badges, right }: {
  eyebrow: string;
  title: ReactNode;
  /** A document number in the title: drawn in the document face. */
  mono?: boolean;
  back?: () => void;
  backTip?: string;
  badges?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-bg">
      <div className="flex flex-wrap items-center gap-4 px-6 pb-[14px] pt-4">
        {back && (
          <button
            type="button"
            onClick={back}
            title={backTip}
            aria-label={backTip ?? "Back"}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-surface text-ink-secondary transition-all duration-[160ms] hover:border-primary hover:text-primary"
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-px w-4 bg-primary-ink" />
            <span className="whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-brand text-primary-ink">{eyebrow}</span>
          </div>
          <h1 className={cn("m-0 mt-[3px] whitespace-nowrap text-[22px] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink", mono && "font-docno")}>{title}</h1>
        </div>
        {badges}
        <div className="flex-1" />
        {right}
      </div>
    </div>
  );
}

/** "‹ 3 of 40 ›". */
export function Stepper({ pos, onPrev, onNext, what }: { pos: string; onPrev: () => void; onNext: () => void; what: string }) {
  const btn = "flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-surface text-ink-secondary hover:border-primary hover:text-primary";
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onPrev} title={`Previous ${what}`} aria-label={`Previous ${what}`} className={btn}><ChevronLeft size={14} aria-hidden="true" /></button>
      <span className="min-w-[56px] text-center text-[12px] text-ink-secondary">{pos}</span>
      <button type="button" onClick={onNext} title={`Next ${what}`} aria-label={`Next ${what}`} className={btn}><ChevronRight size={14} aria-hidden="true" /></button>
    </div>
  );
}

/** A plain button in the page bar (Relationship map, Statement PDF). */
export function BarButton({ icon, children, onClick, disabled }: { icon: ReactNode; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-secondary hover:border-primary/45 hover:text-primary disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

/** The page under the bar. A list fills the window and scrolls inside its table; a full page scrolls. The page rises
 *  into view when it changes. Every page uses the whole width of the window, edge to edge under the top bar and with
 *  the same side margin (Loo, 19 Nov 2026: "the view occupies the screen"), so a wide table shows its columns
 *  instead of scrolling sideways inside a narrow column. */
export function PageBody({ scroll, riseKey, children }: { scroll: boolean; riseKey: unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useRise(ref, riseKey);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [riseKey]);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={ref} className={cn("flex min-h-0 w-full flex-1 flex-col px-6 py-4", scroll ? "overflow-y-auto" : "overflow-y-hidden")}>
          {children}
        </div>
      </div>
    </div>
  );
}
