// Carres only (not part of Houzs's code): the supplier's Finance pages.
//
// Carres sells on subscription: the customer pays a monthly instalment (for example 60 of them) and the supplier is
// paid a share of each month collected. Collections lists each order with its term, what the customer paid, what is
// still to come, what is overdue and which orders are bad debt; By Month adds the instalments up by the month they
// fall due. Every figure is worked out by Carres's own books (the portal) and only shown here; what a person may see
// of it (names, their share, overdue and bad debt) is cut by the server before it leaves.
//
// Drawn to the owner's design of 17 Nov 2026.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Download } from "lucide-react";
import { cn } from "../../lib/utils";
import { supplierApi, type FinanceMonth, type FinanceOrder, type FinanceSummary, type FinanceVisible, type ScheduleItem } from "./api";
import { useFinance } from "./data";
import { statementPdf } from "./docs";
import { CardsCount, CardsView, ListCount, ListTable, SelectionBar, Toolbar, exportList, useListPrefs, type CardSpec, type Column } from "./ListTable";
import { BarButton, PageBar, PageBody, Stepper, useSupplierSession } from "./Shell";
import {
  Badge, EASE, Facts, Kpi, LoadError, Loading, MonthGrid, OpenFull, Pills, Section, StatStrip, TONE_TEXT, ViewToggle, count, finBadge, fmtDay,
  fmtMonth, instalmentBadge, money, play, todayMyt, useLoad, useToast, type FactSpec, type Stat,
} from "./ui";

const ALL_VISIBLE: FinanceVisible = { names: true, share: true, bad: true };
type Shared = Extract<FinanceSummary, { shared: true }>;

const RED = "rgb(var(--hz-err))";
const GREEN = "rgb(var(--hz-synced))";
const SOFT = "#9AA0A8";
const nameOf = (o: FinanceOrder, v: FinanceVisible) => (v.names && o.customerName ? o.customerName : o.soNo ?? o.agreementNo);
const docOf = (o: FinanceOrder) => o.soNo ?? o.agreementNo;
const late = (o: FinanceOrder) => o.overdueMonths;
const isFirstOpen = (s: ScheduleItem, all: ScheduleItem[]) => s.seq === all.find((x) => x.state === "due" || x.state === "upcoming")?.seq;

/** The finance answer, or the empty page when Carres shares no subscription money with this supplier. */
function useShared(): { s: Shared | null; v: FinanceVisible; error: string | null; reload: () => void; notShared: boolean } {
  const f = useFinance();
  const s = f.data && f.data.shared ? (f.data as Shared) : null;
  return { s, v: s?.visible ?? ALL_VISIBLE, error: f.error, reload: f.reload, notShared: !!f.data && !f.data.shared };
}

function NotShared() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center shadow-stone">
      <div className="text-[13px] font-semibold text-ink">No subscription orders are shared with your company.</div>
      <div className="mt-1 text-[12.5px] text-ink-muted">When Carres shares subscription collections with you, they appear here.</div>
    </div>
  );
}

/** The five figure cards over Collections and By Month. A card the person may not see is left out. */
function financeStats(s: Shared, v: FinanceVisible, active: "all" | "default" | null, go: (tab: "all" | "default") => void): Stat[] {
  const t = s.totals;
  const def = s.orders.filter((o) => o.state === "default");
  const badDebt = def.reduce((a, o) => a + o.overdueAmount, 0);
  return [
    { label: "Order Value", value: money(t.contractValue), rail: "rgb(var(--hz-primary))", active: active === "all", onClick: () => go("all") },
    { label: "Customers Paid", value: money(t.collected), rail: "rgb(var(--hz-primary-ink))" },
    ...(v.share ? [
      { label: "Your Share Earned", value: money(t.shareEarned), rail: GREEN, fg: GREEN },
      { label: "Your Share to Come", value: money(t.shareToCome), rail: "rgb(var(--hz-warning-text))" },
    ] : []),
    ...(v.bad ? [{ label: "Bad Debt", value: money(badDebt), rail: RED, fg: RED, active: active === "default", onClick: () => go("default") }] : []),
  ];
}

/** An order's schedule: from the summary, or read on its own when the summary came without it. */
function useSchedule(o: FinanceOrder): ScheduleItem[] | null {
  const own = useLoad(`fin-sched:${o.id}`, () => supplierApi.financeOrder(o.id), !o.schedule);
  if (o.schedule) return o.schedule;
  return own.data?.instalments.map((i) => ({ seq: i.seq, dueDate: i.dueDate, state: i.state as ScheduleItem["state"], amountDue: i.amountDue, share: i.share, paidOn: i.paidOn })) ?? null;
}

const cellTone = (s: ScheduleItem): "paid" | "late" | "rest" => (s.state === "paid" ? "paid" : s.state === "late" ? "late" : "rest");
const gridCells = (sched: ScheduleItem[]) => sched.map((s) => ({ tone: cellTone(s), tip: `#${s.seq} · ${fmtDay(s.dueDate)} · ${instalmentBadge(s.state, isFirstOpen(s, sched)).label}` }));

function moneyRows(o: FinanceOrder, v: FinanceVisible) {
  return [
    { label: "Collected", a: money(o.collected), b: money(o.shareEarned), fg: "rgb(var(--hz-ink))" },
    { label: "Still to come", a: money(o.toCollect), b: money(o.shareToCome), fg: "rgb(var(--hz-ink))" },
    ...(v.bad ? [{ label: "Overdue", a: late(o) ? money(o.overdueAmount) : "None", b: late(o) ? money(o.overdueShare) : "None", fg: late(o) ? RED : SOFT }] : []),
  ];
}

function MoneyGrid({ o, v, gapX = 18, gapY = 8 }: { o: FinanceOrder; v: FinanceVisible; gapX?: number; gapY?: number }) {
  return (
    <div className="grid text-[13px]" style={{ gridTemplateColumns: v.share ? "minmax(0,1fr) auto auto" : "minmax(0,1fr) auto", columnGap: gapX, rowGap: gapY }}>
      <span />
      <span className="text-right text-[12px] text-ink-muted">Customer</span>
      {v.share && <span className="text-right text-[12px] text-ink-muted">Your share</span>}
      {moneyRows(o, v).map((r) => (
        <div key={r.label} className="contents">
          <span className="text-ink-secondary">{r.label}</span>
          <span className="whitespace-nowrap text-right" style={{ color: r.fg }}>{r.a}</span>
          {v.share && <span className="whitespace-nowrap text-right font-bold" style={{ color: r.fg }}>{r.b}</span>}
        </div>
      ))}
    </div>
  );
}

function defaultNote(o: FinanceOrder, sched: ScheduleItem[] | null): string {
  const since = sched?.find((x) => x.state === "late")?.dueDate ?? null;
  return `${late(o)} instalments unpaid${since ? ` since ${fmtDay(since)}` : ""}. Carres treats this order as bad debt; your share at risk is ${money(o.overdueShare)} so far.`;
}

// ── Collections ─────────────────────────────────────────────────────────────────────────────────────────────────

type FTab = "all" | "on_time" | "behind" | "default" | "completed";

export function CollectionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { can } = useSupplierSession();
  const { s, v, error, reload, notShared } = useShared();
  const api = useListPrefs("collections");
  const [tab, setTab] = useState<FTab>(() => ((location.state as { tab?: FTab } | null)?.tab ?? "all"));
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const orders = s?.orders ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders.filter((o) => (tab === "all" || o.state === tab) && (!t || `${o.soNo ?? ""} ${o.agreementNo} ${o.customerName} ${o.item}`.toLowerCase().includes(t)));
  }, [orders, tab, q]);
  const n = (st: string) => orders.filter((o) => o.state === st).length;
  const open = (o: FinanceOrder) => navigate(`/supplier/collections/${encodeURIComponent(o.id)}?from=collections`);

  const columns = useMemo<Column<FinanceOrder>[]>(() => {
    const sum = (rs: FinanceOrder[], g: (o: FinanceOrder) => number) => money(Math.round(rs.reduce((a, o) => a + g(o), 0) * 100) / 100);
    return [
      { key: "order", label: "Order", width: 140, render: (o) => ({ kind: "doc", v: docOf(o), go: () => open(o) }), exportValue: docOf, foot: (rs) => ({ v: `Total · ${count(rs.length, "order")}` }) },
      { key: "agreement", label: "Agreement No", width: 140, hidden: true, render: (o) => ({ kind: "text", v: o.agreementNo, fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (o) => o.agreementNo },
      ...(v.names ? [{ key: "customer", label: "Customer", width: 200, shrink: true, render: (o: FinanceOrder) => ({ kind: "text" as const, v: o.customerName, bold: true }), exportValue: (o: FinanceOrder) => o.customerName }] : []),
      { key: "item", label: "Item", width: 240, shrink: true, render: (o) => ({ kind: "text", v: o.item, fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (o) => o.item },
      {
        key: "term", label: "Term", width: 150,
        render: (o) => ({ kind: "prog", v: `${o.paidCount} / ${o.termMonths}`, paid: o.termMonths ? o.paidCount / o.termMonths : 0, late: o.termMonths ? late(o) / o.termMonths : 0 }),
        exportValue: (o) => `${o.paidCount} / ${o.termMonths}`,
      },
      { key: "monthly", label: "Monthly", width: 100, align: "right", render: (o) => ({ kind: "text", v: money(o.monthlyFee), fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (o) => o.monthlyFee },
      { key: "value", label: "Order Value", width: 120, align: "right", render: (o) => ({ kind: "text", v: money(o.contractValue) }), exportValue: (o) => o.contractValue, foot: (rs) => ({ v: sum(rs, (o) => o.contractValue) }) },
      { key: "paid", label: "Paid So Far", width: 120, align: "right", render: (o) => ({ kind: "text", v: money(o.collected) }), exportValue: (o) => o.collected, foot: (rs) => ({ v: sum(rs, (o) => o.collected) }) },
      { key: "tocome", label: "Still to Come", width: 120, align: "right", render: (o) => ({ kind: "text", v: money(o.toCollect), fg: o.toCollect ? undefined : SOFT }), exportValue: (o) => o.toCollect, foot: (rs) => ({ v: sum(rs, (o) => o.toCollect) }) },
      ...(v.bad ? [{
        key: "overdue", label: "Overdue", width: 140, align: "right" as const,
        render: (o: FinanceOrder) => ({ kind: "text" as const, v: late(o) ? `${money(o.overdueAmount)} · ${late(o)} mo` : "None", fg: late(o) ? RED : SOFT, bold: !!late(o) }),
        exportValue: (o: FinanceOrder) => o.overdueAmount, foot: (rs: FinanceOrder[]) => ({ v: sum(rs, (o) => o.overdueAmount), fg: RED }),
      }] : []),
      ...(v.share ? [
        { key: "earned", label: "Share Earned", width: 120, align: "right" as const, render: (o: FinanceOrder) => ({ kind: "text" as const, v: money(o.shareEarned), bold: true }), exportValue: (o: FinanceOrder) => o.shareEarned, foot: (rs: FinanceOrder[]) => ({ v: sum(rs, (o) => o.shareEarned) }) },
        { key: "sharetocome", label: "Share to Come", width: 120, align: "right" as const, render: (o: FinanceOrder) => ({ kind: "text" as const, v: money(o.shareToCome), fg: o.shareToCome ? undefined : SOFT }), exportValue: (o: FinanceOrder) => o.shareToCome, foot: (rs: FinanceOrder[]) => ({ v: sum(rs, (o) => o.shareToCome) }) },
      ] : []),
      { key: "status", label: "Status", width: 170, render: (o) => ({ kind: "badge", b: finBadge(o.state) }), exportValue: (o) => finBadge(o.state).label },
    ];
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticked = shown.filter((o) => picked[o.id]);
  const t2 = (g: (o: FinanceOrder) => number) => ticked.reduce((a, o) => a + g(o), 0);
  const footer = ticked.length ? (
    <SelectionBar
      n={ticked.length}
      rounded={api.prefs.mode === "cards"}
      onClear={() => setPicked({})}
      items={[
        { v: money(t2((o) => o.contractValue)), label: "order value" },
        { v: money(t2((o) => o.collected)), label: "paid" },
        { v: money(t2((o) => o.toCollect)), label: "to come" },
        ...(v.bad ? [{ v: money(t2((o) => o.overdueAmount)), label: "overdue", fg: t2((o) => o.overdueAmount) ? "#FCA5A5" : "#fff" }] : []),
        ...(v.share ? [{ v: money(t2((o) => o.shareEarned)), label: "your share", fg: "#86EFAC" }] : []),
      ]}
    />
  ) : null;

  const doExport = async () => {
    try { await exportList("collections", columns, api.prefs, ticked.length ? ticked : shown); }
    catch (e) { toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red"); }
  };

  const cards: CardSpec[] = shown.map((o) => ({
    key: o.id, doc: docOf(o), badge: finBadge(o.state), title: nameOf(o, v), line: `${o.item} · ${o.paidCount} of ${o.termMonths} months paid`,
    progress: { paid: o.termMonths ? o.paidCount / o.termMonths : 0, late: o.termMonths ? late(o) / o.termMonths : 0 },
    footLabel: late(o) && v.bad ? "Overdue" : "Next Due", footValue: late(o) && v.bad ? `${money(o.overdueAmount)} · ${late(o)} mo` : fmtDay(o.nextDueDate) || "Nothing due",
    rightLabel: v.share ? "Share Earned" : "Paid So Far", right: money(v.share ? o.shareEarned : o.collected), onOpen: () => open(o),
  }));

  const pills = [
    { key: "all" as const, label: "All", count: orders.length },
    { key: "on_time" as const, label: "On time", count: n("on_time") },
    ...(v.bad ? [{ key: "behind" as const, label: "Behind", count: n("behind") }, { key: "default" as const, label: "In default", count: n("default") }] : []),
    { key: "completed" as const, label: "Paid in full", count: n("completed") },
  ];
  const empty = q.trim() ? `No order matches "${q.trim()}".` : "No subscription orders here.";

  return (
    <>
      <PageBar eyebrow="Finance" title="Collections" />
      <PageBody scroll={false} riseKey="collections">
        {error && !s && !notShared ? <LoadError message={error} onRetry={reload} /> : notShared ? <NotShared /> : !s ? <Loading /> : (
          <>
            <StatStrip stats={financeStats(s, v, tab === "all" || tab === "default" ? tab : null, (t) => setTab(t))} />
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
              <Pills<FTab> value={tab} onChange={setTab} options={pills} />
              <div className="flex-1" />
              <ViewToggle value={api.prefs.mode} onChange={api.setMode} />
            </div>
            <Toolbar search={q} onSearch={setQ} placeholder="Search order, agreement, customer or item" rowCount={shown.length} columns={columns} api={api}
              onExport={doExport} exportCount={ticked.length} canExport={can("finance", "a_export")} />
            {api.prefs.mode === "cards" ? (
              <CardsView cards={cards} picked={picked} onPick={setPicked} empty={empty} footer={footer ?? <CardsCount>{count(shown.length, "subscription order")}</CardsCount>} />
            ) : (
              <ListTable<FinanceOrder>
                columns={columns} rows={shown} rowKey={(o) => o.id} api={api} totals
                openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
                expanded={(o) => <OrderExpansion o={o} v={v} onOpenFull={() => open(o)} />}
                picked={picked} onPick={setPicked} empty={empty}
                footer={footer ?? <ListCount>{count(shown.length, "subscription order")}</ListCount>}
              />
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

/** An order opened in its row: the collection grid and the money, its facts, and every instalment. */
function OrderExpansion({ o, v, onOpenFull }: { o: FinanceOrder; v: FinanceVisible; onOpenFull: () => void }) {
  const sched = useSchedule(o);
  const list = useRef<HTMLDivElement | null>(null);
  // The list opens at the last months paid, so what comes next is in view.
  useEffect(() => {
    const el = list.current;
    if (!el || !sched) return;
    const rows = el.querySelectorAll<HTMLElement>(":scope > div");
    const all = Array.from(rows);
    const row = all.at(Math.max(0, o.paidCount - 2));
    const top = all.at(0);
    if (row && top) el.scrollTop = row.offsetTop - top.offsetTop;
  }, [sched, o.paidCount]);
  const facts: FactSpec[] = [
    { label: "Sales Order", value: o.soNo ?? "Not linked", muted: !o.soNo },
    { label: "Agreement No", value: o.agreementNo },
    { label: "Last Received", value: fmtDay(o.lastPaidOn) || "Nothing yet", muted: !o.lastPaidOn },
    { label: "Next Due", value: fmtDay(o.nextDueDate) || "Nothing due", muted: !o.nextDueDate },
  ];
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr)" }}>
      <div className="min-w-0 px-5 py-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="m-0 text-[12px] font-semibold text-ink-muted">Collection · {o.paidCount} of {o.termMonths} months</h3>
          <Badge b={finBadge(o.state)} size="md" />
        </div>
        {sched ? <MonthGrid cells={gridCells(sched)} /> : <div className="text-[12.5px] text-ink-muted">Loading</div>}
        <div className="mt-[14px]"><MoneyGrid o={o} v={v} /></div>
        {o.state === "default" && v.bad && (
          <div className="mt-3 rounded-md bg-err/[0.07] px-2.5 py-2 text-[12px] leading-[1.5] text-err">{defaultNote(o, sched)}</div>
        )}
      </div>
      <div className="min-w-0 border-l border-border-subtle px-5 py-4">
        <OpenFull onClick={onOpenFull} className="mb-3" />
        <Facts facts={facts} />
      </div>
      <div className="min-w-0 border-l border-border-subtle px-5 py-4">
        <h3 className="m-0 mb-1.5 flex justify-between text-[12px] font-semibold text-ink-muted">
          <span>Instalments</span>
          <span>{o.termMonths} months</span>
        </h3>
        <div ref={list} className="-mr-2 overflow-y-auto pr-2" style={{ maxHeight: 28 * 12 + 2 }}>
          {(sched ?? []).map((x, k) => {
            const b = instalmentBadge(x.state, isFirstOpen(x, sched!));
            return (
              <div key={x.seq} className="grid items-center gap-2 py-1.5 text-[12.5px]" style={{ gridTemplateColumns: "30px minmax(0,1fr) auto 84px", borderTop: k ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                <span className="text-[#9AA0A8]">#{x.seq}</span>
                <span className="text-ink">{fmtDay(x.dueDate)}</span>
                <span className={cn("whitespace-nowrap text-[11.5px] font-bold", b.outline ? "text-ink-muted" : TONE_TEXT[b.tone])}>{b.label}</span>
                <span className="text-right font-semibold" style={{ color: x.state === "late" ? RED : x.state === "paid" ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>{money(x.amountDue)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── One subscription order's full page ──────────────────────────────────────────────────────────────────────────

export function SubscriptionPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { me, can } = useSupplierSession();
  const { s, v, error, reload, notShared } = useShared();
  const from = new URLSearchParams(location.search).get("from") ?? "collections";
  const o = s?.orders.find((x) => x.id === id) ?? null;
  const sched = useOrderSchedule(o, id);

  const all = s?.orders ?? [];
  const idx = all.findIndex((x) => x.id === id);
  const step = (d: number) => {
    if (!all.length) return;
    const next = all[(idx + d + all.length) % all.length]!;
    navigate(`/supplier/collections/${encodeURIComponent(next.id)}?from=${encodeURIComponent(from)}`, { replace: true });
  };
  const backTo = from === "months" ? { to: "/supplier/months", tip: "Back to By Month" }
    : from.startsWith("month:") ? { to: `/supplier/months/${from.slice(6)}`, tip: `Back to ${fmtMonth(from.slice(6))}` }
      : { to: "/supplier/collections", tip: "Back to Collections" };

  const header = (
    <PageBar
      eyebrow="Subscription Order"
      title={o ? docOf(o) : ""}
      mono
      back={() => navigate(backTo.to)}
      backTip={backTo.tip}
      badges={o && <Badge b={finBadge(o.state)} />}
      right={(
        <>
          <Stepper pos={idx >= 0 ? `${idx + 1} of ${all.length}` : ""} onPrev={() => step(-1)} onNext={() => step(1)} what="order" />
          {can("finance", "a_stmt") && (
            <BarButton
              icon={<Download size={14} aria-hidden="true" />}
              disabled={!o || !sched}
              onClick={() => { if (o && sched) void statementPdf(o, sched, v, me.supplier.name).catch(() => toast("The statement could not be made.", "red")); }}
            >
              Statement PDF
            </BarButton>
          )}
        </>
      )}
    />
  );

  if (notShared) return <>{header}<PageBody scroll riseKey={id}><NotShared /></PageBody></>;
  if (error && !s) return <>{header}<PageBody scroll riseKey={id}><LoadError message={error} onRetry={reload} /></PageBody></>;
  if (!s) return <>{header}<PageBody scroll riseKey={id}><Loading /></PageBody></>;
  if (!o) return <>{header}<PageBody scroll riseKey={id}><LoadError message="Order not found." /></PageBody></>;

  const pageFacts: FactSpec[] = [
    { label: "Sales Order", value: o.soNo ?? "Not linked", muted: !o.soNo },
    { label: "Agreement No", value: o.agreementNo },
    ...(v.names ? [{ label: "Customer", value: o.customerName }] : []),
    { label: "Item", value: o.item },
    { label: "Start Date", value: fmtDay(o.startDate) || "Not started", muted: !o.startDate },
    { label: "Monthly", value: money(o.monthlyFee) },
    ...(v.share ? [{ label: "Your Share", value: `${o.ratePct}% of each month` }] : []),
    { label: "Last Received", value: fmtDay(o.lastPaidOn) || "Nothing yet", muted: !o.lastPaidOn },
    { label: "Next Due", value: fmtDay(o.nextDueDate) || "Nothing due", muted: !o.nextDueDate },
  ];

  return (
    <>
      {header}
      <PageBody scroll riseKey={id}>
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3 whitespace-nowrap">
            <div className="text-[22px] font-bold tracking-[-0.01em] text-ink">{nameOf(o, v)}</div>
            <div className="text-[13px] text-ink-muted">{o.item}</div>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${2 + (v.share ? 1 : 0) + (v.bad ? 1 : 0)},minmax(0,1fr))` }}>
            <Kpi label="Order Value" value={money(o.contractValue)} sub={`${o.termMonths} × ${money(o.monthlyFee)}`} rail="rgb(var(--hz-primary))" />
            <Kpi label="Paid So Far" value={money(o.collected)} sub={`${o.paidCount} of ${o.termMonths} months`} rail="rgb(var(--hz-primary-ink))" />
            {v.share && <Kpi label="Your Share Earned" value={money(o.shareEarned)} sub={`${money(o.shareToCome)} still to come`} rail={GREEN} fg={GREEN} />}
            {v.bad && (
              <Kpi
                label={o.state === "default" ? "Bad Debt" : "Overdue"}
                value={late(o) ? money(o.overdueAmount) : "None"}
                sub={late(o) ? `${late(o)} month${late(o) > 1 ? "s" : ""} unpaid` : "Up to date"}
                rail={RED}
                fg={late(o) ? RED : SOFT}
              />
            )}
          </div>
          {o.state === "default" && v.bad && (
            <div className="rounded-lg border border-err/25 bg-err/[0.06] px-4 py-3 text-[13px] leading-[1.5] text-err">{defaultNote(o, sched)}</div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Section title="Collection" aside={<span className="text-[12px] font-semibold text-ink-secondary">{o.paidCount} of {o.termMonths} months paid</span>} bodyClassName="p-4">
                {sched ? <MonthGrid cells={gridCells(sched)} height={14} gap={4} radius={3} /> : <div className="text-[12.5px] text-ink-muted">Loading</div>}
                <div className="mt-2.5 flex gap-4 text-[11.5px] text-ink-secondary">
                  {[{ c: GREEN, t: "Paid" }, { c: RED, t: "Overdue" }, { c: "rgb(var(--hz-border))", t: "To come" }].map((l) => (
                    <span key={l.t} className="inline-flex items-center gap-1.5"><span className="h-[9px] w-[9px] rounded-sm" style={{ background: l.c }} />{l.t}</span>
                  ))}
                </div>
              </Section>
              <Section title="Instalments" aside={<span className="text-[12px] text-ink-secondary">{o.termMonths} months</span>} className="overflow-hidden">
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        {["Month", "Due Date", "Status", "Received On", "Instalment", ...(v.share ? ["Your Share"] : [])].map((h, i) => (
                          <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-4 py-[9px] text-[11.5px] font-semibold text-ink-secondary" style={{ textAlign: i >= 4 ? "right" : "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(sched ?? []).map((x) => {
                        const b = instalmentBadge(x.state, isFirstOpen(x, sched!));
                        const rcv = x.paidOn ? fmtDay(x.paidOn) : x.state === "late" ? "Not received" : "Not yet";
                        return (
                          <tr key={x.seq} style={{ background: x.state === "late" ? "rgba(178,58,58,0.04)" : "#fff" }}>
                            <td className="border-b border-border-subtle px-4 py-2 text-[12.5px] text-[#9AA0A8]">#{x.seq}</td>
                            <td className="border-b border-border-subtle px-4 py-2 text-[13px] text-ink">{fmtDay(x.dueDate)}</td>
                            <td className="border-b border-border-subtle px-4 py-2"><Badge b={b} size="xs" /></td>
                            <td className="border-b border-border-subtle px-4 py-2 text-[13px]" style={{ color: x.paidOn ? "rgb(var(--hz-ink))" : x.state === "late" ? RED : SOFT }}>{rcv}</td>
                            <td className="border-b border-border-subtle px-4 py-2 text-right text-[13px] font-semibold" style={{ color: x.state === "late" ? RED : x.state === "paid" ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>{money(x.amountDue)}</td>
                            {v.share && <td className="border-b border-border-subtle px-4 py-2 text-right text-[13px] font-bold" style={{ color: x.state === "paid" ? GREEN : SOFT }}>{money(x.share)}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>
            <div className="flex flex-col gap-4">
              <Section title="Order" bodyClassName="p-4">
                <Facts facts={pageFacts} labelWidth={130} gap={10} />
              </Section>
              <Section title="Money" bodyClassName="p-4">
                <MoneyGrid o={o} v={v} gapY={10} />
              </Section>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function useOrderSchedule(o: FinanceOrder | null, id: string): ScheduleItem[] | null {
  const own = useLoad(`fin-sched:${id}`, () => supplierApi.financeOrder(id), !!o && !o.schedule);
  if (!o) return null;
  if (o.schedule) return o.schedule;
  return own.data?.instalments.map((i) => ({ seq: i.seq, dueDate: i.dueDate, state: i.state as ScheduleItem["state"], amountDue: i.amountDue, share: i.share, paidOn: i.paidOn })) ?? null;
}

// ── By Month ────────────────────────────────────────────────────────────────────────────────────────────────────

interface DueItem { o: FinanceOrder; x: ScheduleItem; next: boolean }

/** Every instalment that falls due in a month (YYYY-MM), order by order. Waived ones are not money due. */
function dueIn(orders: FinanceOrder[], month: string): DueItem[] {
  const out: DueItem[] = [];
  for (const o of orders) {
    const sched = o.schedule ?? [];
    for (const x of sched) {
      if (x.state === "waived" || x.dueDate.slice(0, 7) !== month) continue;
      out.push({ o, x, next: isFirstOpen(x, sched) });
    }
  }
  return out.sort((a, b) => a.x.dueDate.localeCompare(b.x.dueDate) || docOf(a.o).localeCompare(docOf(b.o)));
}

const thisMonth = () => todayMyt().slice(0, 7);

export function MonthsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useSupplierSession();
  const { s, v, error, reload, notShared } = useShared();
  const api = useListPrefs("months");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const months = s?.months ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? months.filter((m) => fmtMonth(m.month).includes(t) || m.month.includes(t)) : months;
  }, [months, q]);
  const now = thisMonth();

  const columns = useMemo<Column<FinanceMonth>[]>(() => {
    const sum = (rs: FinanceMonth[], g: (m: FinanceMonth) => number) => rs.reduce((a, m) => a + g(m), 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return [
      { key: "month", label: "Month Due", width: 120, render: (m) => ({ kind: "text", v: fmtMonth(m.month), bold: true }), exportValue: (m) => fmtMonth(m.month), foot: (rs) => ({ v: `Total · ${count(rs.length, "month")}` }) },
      { key: "due", label: "Instalments Due", width: 140, align: "right", render: (m) => ({ kind: "text", v: money(m.due) }), exportValue: (m) => m.due, foot: (rs) => ({ v: money(r2(sum(rs, (m) => m.due))) }) },
      { key: "collected", label: "Collected", width: 120, align: "right", render: (m) => ({ kind: "text", v: money(m.collected) }), exportValue: (m) => m.collected, foot: (rs) => ({ v: money(r2(sum(rs, (m) => m.collected))) }) },
      {
        key: "open", label: "Not Collected", width: 130, align: "right",
        render: (m) => ({ kind: "text", v: m.open > 0 ? money(m.open) : "None", fg: m.open > 0 ? (v.bad && m.month < now ? RED : undefined) : SOFT }),
        exportValue: (m) => m.open, foot: (rs) => ({ v: money(r2(sum(rs, (m) => m.open))) }),
      },
      {
        key: "rate", label: "Collection Rate", width: 120, align: "right",
        render: (m) => ({ kind: "text", v: m.due ? `${Math.round((m.collected / m.due) * 100)}%` : "None", fg: "rgb(var(--hz-ink-secondary))" }),
        exportValue: (m) => (m.due ? Math.round((m.collected / m.due) * 100) : 0),
        foot: (rs) => { const d = sum(rs, (m) => m.due); return { v: d ? `${Math.round((sum(rs, (m) => m.collected) / d) * 100)}%` : "None" }; },
      },
      ...(v.share ? [
        { key: "earned", label: "Your Share Earned", width: 150, align: "right" as const, render: (m: FinanceMonth) => ({ kind: "text" as const, v: money(m.collectedShare), bold: true }), exportValue: (m: FinanceMonth) => m.collectedShare, foot: (rs: FinanceMonth[]) => ({ v: money(r2(sum(rs, (m) => m.collectedShare))) }) },
        { key: "openShare", label: "Your Share Open", width: 140, align: "right" as const, render: (m: FinanceMonth) => ({ kind: "text" as const, v: m.openShare > 0 ? money(m.openShare) : "None", fg: m.openShare > 0 ? undefined : SOFT }), exportValue: (m: FinanceMonth) => m.openShare, foot: (rs: FinanceMonth[]) => ({ v: money(r2(sum(rs, (m) => m.openShare))) }) },
        { key: "dueShare", label: "Your Share Due", width: 140, align: "right" as const, hidden: true, render: (m: FinanceMonth) => ({ kind: "text" as const, v: money(m.dueShare) }), exportValue: (m: FinanceMonth) => m.dueShare, foot: (rs: FinanceMonth[]) => ({ v: money(r2(sum(rs, (m) => m.dueShare))) }) },
      ] : []),
    ];
  }, [v, now]);

  const doExport = async () => {
    try { await exportList("by-month", columns, api.prefs, shown); } catch (e) { toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red"); }
  };

  return (
    <>
      <PageBar eyebrow="Finance" title="By Month" />
      <PageBody scroll={false} riseKey="months">
        {error && !s && !notShared ? <LoadError message={error} onRetry={reload} /> : notShared ? <NotShared /> : !s ? <Loading /> : (
          <>
            <StatStrip stats={financeStats(s, v, null, (t) => navigate("/supplier/collections", { state: { tab: t } }))} />
            <Toolbar search={q} onSearch={setQ} placeholder="Search month" rowCount={shown.length} columns={columns} api={api}
              onExport={doExport} exportCount={0} canExport={can("finance", "a_export")} />
            <ListTable<FinanceMonth>
              columns={columns} rows={shown} rowKey={(m) => m.month} api={api} totals
              openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
              expanded={(m) => <MonthExpansion month={m.month} orders={s.orders} v={v} />}
              empty={q.trim() ? `No month matches "${q.trim()}".` : "No instalments yet."}
              footer={<ListCount>{count(shown.length, "month")}</ListCount>}
            />
          </>
        )}
      </PageBody>
    </>
  );
}

const MTH = "sticky top-0 whitespace-nowrap bg-border-subtle px-3 py-[7px] text-left text-[11px] font-semibold text-ink-secondary";
const MTD = "whitespace-nowrap border-t border-surface-dim px-3 py-[7px] text-[12.5px]";

/** A month opened in its row: every order due in it, each opening in place again. */
function MonthExpansion({ month, orders, v }: { month: string; orders: FinanceOrder[]; v: FinanceVisible }) {
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const items = useMemo(() => dueIn(orders, month), [orders, month]);
  const due = items.reduce((a, d) => a + d.x.amountDue, 0);
  const cols = 6 + (v.names ? 1 : 0) + (v.share ? 1 : 0);
  return (
    <div className="px-5 pb-4 pt-[14px]">
      <div className="mb-2 flex justify-between text-[12px] font-semibold text-ink-muted">
        <span>Instalments due in {fmtMonth(month)}</span>
        <span className="flex items-center gap-[14px]">
          <span>{count(items.length, "order")} · {money(due)} due</span>
          <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/supplier/months/${month}`); }}
            className="inline-flex items-center gap-[3px] rounded-md border border-primary-ink/35 px-2.5 py-1 text-[12px] font-semibold text-primary-ink hover:bg-accent-soft hover:no-underline">
            All of {fmtMonth(month)}<ChevronRight size={12} aria-hidden="true" />
          </a>
        </span>
      </div>
      <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={MTH}>Sales Order</th>
              {v.names && <th className={MTH}>Customer</th>}
              <th className={MTH}>Item</th><th className={MTH}>Month</th><th className={MTH}>Due Date</th><th className={MTH}>Status</th>
              <th className={cn(MTH, "text-right")}>Instalment</th>
              {v.share && <th className={cn(MTH, "text-right")}>Your Share</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={cols} className={cn(MTD, "text-ink-muted")}>Nothing falls due this month.</td></tr>}
            {items.map((d) => {
              const key = `${d.o.id}|${d.x.seq}`;
              const on = openKey === key;
              const b = instalmentBadge(d.x.state, d.next);
              return (
                <MonthRow key={key} d={d} on={on} b={b} v={v} cols={cols} onToggle={() => setOpenKey(on ? null : key)}
                  onOpen={() => navigate(`/supplier/collections/${encodeURIComponent(d.o.id)}?from=months`)} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthRow({ d, on, b, v, cols, onToggle, onOpen }: { d: DueItem; on: boolean; b: ReturnType<typeof instalmentBadge>; v: FinanceVisible; cols: number; onToggle: () => void; onOpen: () => void }) {
  const o = d.o;
  const sched = o.schedule ?? [];
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:!bg-primary-soft/35" style={{ background: on ? "rgba(220,230,253,0.4)" : "#fff" }}>
        <td className={MTD}>
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={12} style={{ color: on ? "rgb(var(--hz-primary))" : SOFT, transform: on ? "rotate(90deg)" : "none", transition: `transform 220ms ${EASE}` }} aria-hidden="true" />
            <span className="font-docno text-[12px] font-semibold text-primary-ink">{docOf(o)}</span>
          </span>
        </td>
        {v.names && <td className={cn(MTD, "font-semibold text-ink")}>{o.customerName}</td>}
        <td className={cn(MTD, "max-w-[220px] truncate text-ink-secondary")}>{o.item}</td>
        <td className={cn(MTD, "text-ink-secondary")}>{d.x.seq} of {o.termMonths}</td>
        <td className={cn(MTD, "text-ink")}>{fmtDay(d.x.dueDate)}</td>
        <td className={MTD}><Badge b={b} size="xs" /></td>
        <td className={cn(MTD, "text-right font-semibold")} style={{ color: d.x.state === "late" ? RED : "rgb(var(--hz-ink))" }}>{money(d.x.amountDue)}</td>
        {v.share && <td className={cn(MTD, "text-right font-bold")} style={{ color: d.x.state === "paid" ? GREEN : SOFT }}>{money(d.x.share)}</td>}
      </tr>
      {on && (
        <tr>
          <td colSpan={cols} className="whitespace-normal border-t border-surface-dim bg-surface-2 pb-[14px] pl-8 pr-[14px] pt-3">
            <MonthOrderInside o={o} sched={sched} v={v} onOpen={onOpen} />
          </td>
        </tr>
      )}
    </>
  );
}

function MonthOrderInside({ o, sched, v, onOpen }: { o: FinanceOrder; sched: ScheduleItem[]; v: FinanceVisible; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 240);
  }, []);
  const rows = [
    { label: "Paid so far", v: money(o.collected), fg: "rgb(var(--hz-ink))" },
    { label: "Still to come", v: money(o.toCollect), fg: "rgb(var(--hz-ink))" },
    ...(v.bad ? [{ label: "Overdue", v: late(o) ? money(o.overdueAmount) : "None", fg: late(o) ? RED : SOFT }] : []),
  ];
  return (
    <div ref={ref} className="grid items-start gap-6" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) auto" }}>
      <div>
        <div className="mb-1.5 flex justify-between text-[11.5px] font-semibold text-ink-muted"><span>Collection</span><span>{o.paidCount} of {o.termMonths} months paid</span></div>
        <MonthGrid cells={sched.map((x) => ({ tone: cellTone(x) }))} height={7} />
      </div>
      <dl className="m-0 grid gap-x-4 gap-y-[5px] text-[12.5px]" style={{ gridTemplateColumns: "auto auto" }}>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-ink-muted">{r.label}</dt>
            <dd className="m-0 text-right font-semibold" style={{ color: r.fg }}>{r.v}</dd>
          </div>
        ))}
      </dl>
      <OpenFull onClick={onOpen} boxed />
    </div>
  );
}

// ── One month's full page ───────────────────────────────────────────────────────────────────────────────────────

export function MonthPage() {
  const { month = "" } = useParams();
  const navigate = useNavigate();
  const { s, v, error, reload, notShared } = useShared();
  const months = (s?.months ?? []).map((m) => m.month);
  const idx = months.indexOf(month);
  const step = (d: number) => {
    if (!months.length) return;
    navigate(`/supplier/months/${months[(idx + d + months.length) % months.length]}`, { replace: true });
  };
  const header = (
    <PageBar
      eyebrow="Month Due"
      title={fmtMonth(month)}
      back={() => navigate("/supplier/months")}
      backTip="Back to By Month"
      right={<Stepper pos={idx >= 0 ? `${idx + 1} of ${months.length}` : ""} onPrev={() => step(-1)} onNext={() => step(1)} what="month" />}
    />
  );
  if (notShared) return <>{header}<PageBody scroll riseKey={month}><NotShared /></PageBody></>;
  if (error && !s) return <>{header}<PageBody scroll riseKey={month}><LoadError message={error} onRetry={reload} /></PageBody></>;
  if (!s) return <>{header}<PageBody scroll riseKey={month}><Loading /></PageBody></>;

  const items = dueIn(s.orders, month);
  const sumBy = (pred: (d: DueItem) => boolean) => Math.round(items.filter(pred).reduce((a, d) => a + d.x.amountDue, 0) * 100) / 100;
  const shareBy = (pred: (d: DueItem) => boolean) => Math.round(items.filter(pred).reduce((a, d) => a + d.x.share, 0) * 100) / 100;
  const due = sumBy(() => true);
  const paid = sumBy((d) => d.x.state === "paid");
  const lateAmt = v.bad ? sumBy((d) => d.x.state === "late") : 0;
  const rest = Math.round((due - paid - lateAmt) * 100) / 100;
  const pct = (n: number) => (due ? (n / due) * 100 : 0);
  const kpiCount = 3 + (v.share ? 2 : 0);

  return (
    <>
      {header}
      <PageBody scroll={false} riseKey={month}>
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${kpiCount},minmax(0,1fr))` }}>
            <Kpi size={21} label="Instalments Due" value={money(due)} sub={count(items.length, "order")} rail="rgb(var(--hz-primary))" />
            <Kpi size={21} label="Collected" value={money(paid)} sub={`${items.filter((d) => d.x.state === "paid").length} paid`} rail="rgb(var(--hz-primary-ink))" />
            <Kpi size={21} label="Not Collected" value={money(Math.round((due - paid) * 100) / 100)} sub={lateAmt ? `${money(lateAmt)} overdue` : "Nothing overdue"} rail={RED} fg={lateAmt ? RED : undefined} />
            {v.share && <Kpi size={21} label="Your Share Earned" value={money(shareBy((d) => d.x.state === "paid"))} sub="Paid out to you" rail={GREEN} fg={GREEN} />}
            {v.share && <Kpi size={21} label="Your Share Open" value={money(shareBy((d) => d.x.state !== "paid"))} sub="Paid when collected" rail="rgb(var(--hz-warning-text))" />}
          </div>
          <div className="rounded-lg border border-border bg-surface px-[18px] py-[14px] shadow-stone">
            <div className="flex justify-between text-[12px] font-semibold text-ink-secondary">
              <span>Collected {Math.round(pct(paid))}% of {money(due)}</span>
              <span className="text-ink-muted">{money(paid)} collected{v.bad ? ` · ${money(lateAmt)} overdue` : ""} · {money(rest)} still due</span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-dim">
              <span className="h-full bg-synced" style={{ width: `${pct(paid)}%` }} />
              <span className="h-full bg-err" style={{ width: `${pct(lateAmt)}%` }} />
              <span className="h-full bg-[#9DB4F5]" style={{ width: `${pct(rest)}%` }} />
            </div>
            <div className="mt-2 flex gap-4 text-[11.5px] text-ink-secondary">
              {[{ c: GREEN, t: "Collected" }, ...(v.bad ? [{ c: RED, t: "Overdue" }] : []), { c: "#9DB4F5", t: "Still due" }].map((l) => (
                <span key={l.t} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-[9px] w-[9px] rounded-sm" style={{ background: l.c }} />{l.t}</span>
              ))}
            </div>
          </div>
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-stone">
            <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 className="m-0 text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Orders due this month</h2>
              <span className="text-[12px] text-ink-secondary">{count(items.length, "order")}</span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    {["Sales Order", ...(v.names ? ["Customer"] : []), "Item", "Month", "Due Date", "Status", "Received On", "Instalment", ...(v.share ? ["Your Share"] : [])].map((h) => (
                      <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-[14px] py-[9px] text-[11.5px] font-semibold text-ink-secondary" style={{ textAlign: h === "Instalment" || h === "Your Share" ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => {
                    const st = d.x.state;
                    const rcv = d.x.paidOn ? fmtDay(d.x.paidOn) : st === "late" ? "Not received" : "Not yet";
                    return (
                      <tr key={`${d.o.id}|${d.x.seq}`} onClick={() => navigate(`/supplier/collections/${encodeURIComponent(d.o.id)}?from=month:${month}`)}
                        className="cursor-pointer hover:!bg-primary-soft/35" style={{ background: st === "late" ? "rgba(178,58,58,0.04)" : "#fff" }}>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px]"><span className="font-docno text-[12.5px] font-semibold text-primary-ink">{docOf(d.o)}</span></td>
                        {v.names && <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px] font-semibold text-ink">{d.o.customerName}</td>}
                        <td className="max-w-[240px] truncate whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px] text-ink-secondary">{d.o.item}</td>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px] text-ink-secondary">{d.x.seq} of {d.o.termMonths}</td>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px] text-ink">{fmtDay(d.x.dueDate)}</td>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px]"><Badge b={instalmentBadge(st, d.next)} size="xs" /></td>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-[13px]" style={{ color: d.x.paidOn ? "rgb(var(--hz-ink))" : st === "late" ? RED : SOFT }}>{rcv}</td>
                        <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-right text-[13px] font-semibold" style={{ color: st === "late" ? RED : "rgb(var(--hz-ink))" }}>{money(d.x.amountDue)}</td>
                        {v.share && <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-[9px] text-right text-[13px] font-bold" style={{ color: st === "paid" ? GREEN : SOFT }}>{money(d.x.share)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5 + (v.names ? 1 : 0) + 1} className="sticky bottom-0 border-t border-border bg-surface-2 px-[14px] py-2.5 text-[13px] font-bold text-ink">Total · {count(items.length, "order")}</td>
                    <td className="sticky bottom-0 border-t border-border bg-surface-2 px-[14px] py-2.5 text-right text-[13px] font-bold text-ink">{money(due)}</td>
                    {v.share && <td className="sticky bottom-0 border-t border-border bg-surface-2 px-[14px] py-2.5 text-right text-[13px] font-bold text-synced">{money(shareBy((d) => d.x.state === "paid"))}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      </PageBody>
    </>
  );
}
