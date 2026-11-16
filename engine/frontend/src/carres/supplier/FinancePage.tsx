// Carres only (not part of Houzs's code): the supplier's Finance pages.
//
// Carres sells on subscription: the customer pays a monthly instalment (for example 60 of them) and the supplier is
// paid a share of each month collected. These pages let the supplier's Finance people see, for the orders they have
// a share in: what each is worth, which months came in, what is still to come, and which customers are behind.
// Every figure is worked out by Carres's own books (the portal) and only shown here.
//
// Drawn with the staff list's own parts (owner, 16 Nov 2026): the header, the figure cards, the pills and the staff
// table, whose foot adds up the rows showing and whose Export writes the columns showing.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "../../components/Badge";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { FilterPills } from "../../components/FilterPills";
import { StatCard } from "../../components/StatCard";
import { supplierApi, type FinanceInstalment, type FinanceMonth, type FinanceOrder } from "./api";
import { Card, Fact, LoadError, Loading, Missing, PageHeader, count, fmtDay, fmtMonth, money, useLoad } from "./ui";

type Tone = "neutral" | "accent" | "success" | "warning" | "error";
const ORDER_STATE: Partial<Record<string, { label: string; tone: Tone }>> = {
  on_time: { label: "On time", tone: "success" },
  behind: { label: "Behind", tone: "warning" },
  default: { label: "In default", tone: "error" },
  completed: { label: "Paid in full", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
};
const stateLabel = (state: string): string => ORDER_STATE[state]?.label ?? state;
function StateBadge({ state }: { state: string }) {
  const s = ORDER_STATE[state] ?? { label: state, tone: "neutral" as Tone };
  return <Badge tone={s.tone} size="sm" caseless>{s.label}</Badge>;
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "0%");
/** A column's foot: the rows showing added up, to the sen, so the column and its total can never disagree. */
const sumMoney = <T,>(rows: T[], value: (r: T) => number): string => money(Math.round(rows.reduce((a, r) => a + value(r), 0) * 100) / 100);

const ORDER_COLUMNS: Column<FinanceOrder>[] = [
  {
    key: "order", label: "Order", alwaysVisible: true, getValue: (o) => o.soNo ?? o.agreementNo,
    searchValue: (o) => `${o.soNo ?? ""} ${o.agreementNo} ${o.customerName} ${o.item}`,
    render: (o) => (
      <div>
        <div className="font-docno text-[12.5px] font-semibold text-primary-ink">{o.soNo ?? o.agreementNo}</div>
        {o.soNo && <div className="mt-0.5 font-docno text-[11px] text-ink-muted">{o.agreementNo}</div>}
      </div>
    ),
  },
  { key: "agreement", label: "Agreement No", defaultHidden: true, getValue: (o) => o.agreementNo, render: (o) => <span className="font-docno">{o.agreementNo}</span> },
  { key: "customer", label: "Customer", getValue: (o) => o.customerName, render: (o) => <span className="block min-w-[110px] whitespace-normal">{o.customerName}</span> },
  { key: "item", label: "Item", getValue: (o) => o.item, render: (o) => <span className="block min-w-[150px] whitespace-normal">{o.item}</span> },
  {
    key: "value", label: "Order Value", align: "right", getValue: (o) => o.contractValue, filterType: "number", numberValue: (o) => o.contractValue,
    render: (o) => money(o.contractValue), total: (rows) => sumMoney(rows, (o) => o.contractValue),
  },
  {
    // The money collected with the months it came from under it: one column, as Overdue is, so the table fits a
    // laptop screen. Months Paid and Months in Total are columns of their own in Columns, for the file.
    key: "collected", label: "Collected", align: "right", getValue: (o) => o.collected, filterType: "number", numberValue: (o) => o.collected,
    render: (o) => <div><div>{money(o.collected)}</div><div className="mt-0.5 text-[11px] text-ink-muted">{o.paidCount} of {count(o.termMonths, "month")}</div></div>,
    total: (rows) => sumMoney(rows, (o) => o.collected),
  },
  { key: "paid", label: "Months Paid", align: "right", defaultHidden: true, getValue: (o) => o.paidCount, render: (o) => o.paidCount },
  { key: "term", label: "Months in Total", align: "right", defaultHidden: true, getValue: (o) => o.termMonths, render: (o) => o.termMonths },
  {
    key: "earned", label: "Share Earned", align: "right", getValue: (o) => o.shareEarned, filterType: "number", numberValue: (o) => o.shareEarned,
    render: (o) => <span className="font-semibold">{money(o.shareEarned)}</span>, total: (rows) => sumMoney(rows, (o) => o.shareEarned),
  },
  {
    key: "tocome", label: "Share to Come", align: "right", getValue: (o) => o.shareToCome, filterType: "number", numberValue: (o) => o.shareToCome,
    render: (o) => money(o.shareToCome), total: (rows) => sumMoney(rows, (o) => o.shareToCome),
  },
  {
    key: "overdue", label: "Overdue", align: "right", getValue: (o) => o.overdueAmount, filterType: "number", numberValue: (o) => o.overdueAmount,
    render: (o) => (o.overdueMonths > 0
      ? <div><div className="font-semibold text-err">{money(o.overdueAmount)}</div><div className="mt-0.5 text-[11px] text-ink-muted">{count(o.overdueMonths, "month")}</div></div>
      : <Missing>None</Missing>),
    total: (rows) => <span className="text-err">{sumMoney(rows, (o) => o.overdueAmount)}</span>,
  },
  { key: "overdueMonths", label: "Months Overdue", align: "right", defaultHidden: true, getValue: (o) => o.overdueMonths, render: (o) => o.overdueMonths },
  {
    key: "overdueShare", label: "Your Share Overdue", align: "right", defaultHidden: true, getValue: (o) => o.overdueShare,
    render: (o) => (o.overdueShare > 0 ? money(o.overdueShare) : <Missing>None</Missing>), total: (rows) => sumMoney(rows, (o) => o.overdueShare),
  },
  {
    key: "next", label: "Next Due", getValue: (o) => o.nextDueDate, filterType: "date", dateValue: (o) => o.nextDueDate, filterLabel: (v) => fmtDay(v) || v,
    render: (o) => fmtDay(o.nextDueDate) || <Missing>Nothing due</Missing>,
  },
  { key: "state", label: "Status", getValue: (o) => stateLabel(o.state), render: (o) => <StateBadge state={o.state} /> },
];

const MONTH_COLUMNS: Column<FinanceMonth>[] = [
  { key: "month", label: "Month Due", alwaysVisible: true, getValue: (m) => m.month, filterLabel: fmtMonth, render: (m) => <span className="font-semibold">{fmtMonth(m.month)}</span> },
  { key: "due", label: "Instalments Due", align: "right", getValue: (m) => m.due, render: (m) => money(m.due), total: (rows) => sumMoney(rows, (m) => m.due) },
  { key: "collected", label: "Collected", align: "right", getValue: (m) => m.collected, render: (m) => money(m.collected), total: (rows) => sumMoney(rows, (m) => m.collected) },
  { key: "open", label: "Not Collected Yet", align: "right", getValue: (m) => m.open, render: (m) => (m.open > 0 ? money(m.open) : <Missing>None</Missing>), total: (rows) => sumMoney(rows, (m) => m.open) },
  { key: "earned", label: "Share Earned", align: "right", getValue: (m) => m.collectedShare, render: (m) => <span className="font-semibold">{money(m.collectedShare)}</span>, total: (rows) => sumMoney(rows, (m) => m.collectedShare) },
  { key: "tocome", label: "Share to Come", align: "right", getValue: (m) => m.openShare, render: (m) => (m.openShare > 0 ? money(m.openShare) : <Missing>None</Missing>), total: (rows) => sumMoney(rows, (m) => m.openShare) },
];

type Tab = "orders" | "overdue" | "months";

export function FinancePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("orders");
  const finance = useLoad("finance", () => supplierApi.finance());
  const data = finance.data;

  const overdue = useMemo(() => (data?.shared ? data.orders.filter((o) => o.overdueMonths > 0) : []), [data]);
  const header = (
    <PageHeader
      eyebrow="Finance"
      title="Finance"
      description={data?.shared
        ? <>Subscription orders you have a share in, as of {fmtDay(data.asOf)}. Your share of a month is earned when the customer's instalment is collected.</>
        : "Subscription orders you have a share in. Your share of a month is earned when the customer's instalment is collected."}
    />
  );

  if (finance.error && !data) return <>{header}<LoadError message={finance.error} onRetry={finance.reload} /></>;
  if (!data) return <>{header}<Loading /></>;
  if (!data.shared) {
    return (
      <>
        {header}
        <EmptyState message="No subscription orders are shared with your company." description="When Carres shares subscription collections with you, they appear here." />
      </>
    );
  }

  const t = data.totals;
  const rows = tab === "overdue" ? overdue : data.orders;
  return (
    <>
      {header}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Order Value" value={money(t.contractValue)} subtitle={count(t.orders, "order")} rail="bg-primary" active={tab === "orders"} onClick={() => setTab("orders")} />
        <StatCard label="Your Share in Full" value={money(t.shareTotal)} subtitle="Earned plus still to come" rail="bg-accent" />
        <StatCard label="Your Share Earned" value={money(t.shareEarned)} subtitle={`${money(t.collected)} collected · ${count(t.collectedCount, "month")}`} tone="success" rail="bg-synced" />
        <StatCard label="Your Share to Come" value={money(t.shareToCome)} subtitle={`${money(t.toCollect)} still to collect`} rail="bg-warning-text" />
        <StatCard
          label="Behind on Payment"
          value={`${t.overdueOrders} of ${t.orders}`}
          subtitle={t.overdueOrders ? `${pct(t.overdueOrders, t.orders)} of orders · ${money(t.overdueAmount)} overdue${t.defaultOrders ? ` · ${t.defaultOrders} in default` : ""}` : "Every order is on time"}
          tone={t.overdueOrders ? "error" : "default"}
          rail="bg-err"
          onClick={t.overdueOrders ? () => setTab("overdue") : undefined}
          active={tab === "overdue"}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterPills
          value={tab}
          onChange={setTab}
          options={[
            { value: "orders", label: "All orders", count: t.orders },
            { value: "overdue", label: "Behind on payment", count: t.overdueOrders },
            { value: "months", label: "By month", count: data.months.length },
          ]}
        />
      </div>
      {tab === "months" ? (
        <DataTable<FinanceMonth>
          tableId="carres-supplier-finance-months"
          documentLabel="Finance by month"
          exportName="subscription-by-month"
          columns={MONTH_COLUMNS}
          rows={data.months}
          getRowKey={(m) => m.month}
          emptyLabel="No instalments yet."
        />
      ) : (
        <DataTable<FinanceOrder>
          tableId="carres-supplier-finance-orders"
          documentLabel="Subscription orders"
          exportName={tab === "overdue" ? "subscription-orders-overdue" : "subscription-orders"}
          columns={ORDER_COLUMNS}
          rows={rows}
          getRowKey={(o) => o.id}
          onRowClick={(o) => navigate(`/supplier/finance/${o.id}`)}
          emptyLabel={tab === "overdue" ? "No customer is behind on payment." : "No subscription orders yet."}
          clientSearch={{ placeholder: "Search order, agreement, customer or item" }}
        />
      )}
      {tab === "overdue" && overdue.length > 0 && (
        <p className="mt-3 text-[11.5px] text-ink-muted">
          An instalment is overdue once its due day has passed with no payment. Six unpaid instalments put an order in default.
          Your share at risk on these orders: {money(t.overdueShare)}.
        </p>
      )}
    </>
  );
}

const INSTALMENT_STATE: Partial<Record<string, { label: string; tone: Tone }>> = {
  paid: { label: "Paid", tone: "success" },
  late: { label: "Overdue", tone: "error" },
  due: { label: "Due today", tone: "warning" },
  upcoming: { label: "To come", tone: "neutral" },
  waived: { label: "Not charged", tone: "neutral" },
};
const instalmentLabel = (state: string): string => INSTALMENT_STATE[state]?.label ?? state;

const INSTALMENT_COLUMNS: Column<FinanceInstalment>[] = [
  { key: "seq", label: "Month", align: "right", alwaysVisible: true, getValue: (i) => i.seq, disableFilter: true, render: (i) => i.seq },
  { key: "due", label: "Due Date", getValue: (i) => i.dueDate, filterType: "date", dateValue: (i) => i.dueDate, filterLabel: (v) => fmtDay(v) || v, render: (i) => fmtDay(i.dueDate) },
  { key: "amount", label: "Instalment", align: "right", getValue: (i) => i.amountDue, render: (i) => money(i.amountDue), total: (rows) => sumMoney(rows, (i) => i.amountDue) },
  {
    key: "state", label: "Status", getValue: (i) => instalmentLabel(i.state),
    render: (i) => {
      const s = INSTALMENT_STATE[i.state] ?? { label: i.state, tone: "neutral" as Tone };
      return (
        <span className="inline-flex items-center gap-2">
          <Badge tone={s.tone} size="sm" caseless variant={i.state === "upcoming" ? "outline" : "soft"}>{s.label}</Badge>
          {i.state === "late" && <span className="text-[11px] text-err">{count(i.daysLate, "day")} late</span>}
        </span>
      );
    },
  },
  { key: "paidOn", label: "Received On", getValue: (i) => i.paidOn, filterType: "date", dateValue: (i) => i.paidOn, filterLabel: (v) => fmtDay(v) || v, render: (i) => fmtDay(i.paidOn) || <Missing>Not received</Missing> },
  { key: "paid", label: "Received", align: "right", getValue: (i) => i.paidAmount ?? 0, render: (i) => (i.paidAmount == null ? <Missing>None</Missing> : money(i.paidAmount)), total: (rows) => sumMoney(rows, (i) => i.paidAmount ?? 0) },
  {
    key: "share", label: "Your Share", align: "right", getValue: (i) => i.share,
    render: (i) => (i.state === "paid" ? <span className="font-semibold">{money(i.share)}</span> : i.state === "waived" ? <Missing>None</Missing> : <span className="text-ink-muted">{money(i.share)}</span>),
    total: (rows) => sumMoney(rows, (i) => (i.state === "waived" ? 0 : i.share)),
  },
];

export function FinanceOrderPage() {
  const { id = "" } = useParams();
  const one = useLoad(`finance:${id}`, () => supplierApi.financeOrder(id));
  const o = one.data?.order;

  return (
    <>
      <Link to="/supplier/finance" className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft size={13} /> Finance
      </Link>
      {one.error && <LoadError message={one.error} onRetry={one.reload} />}
      {!one.data && !one.error && <Loading />}
      {one.data && o && (
        <>
          <PageHeader
            eyebrow="Subscription Order"
            title={<span className="font-docno">{o.soNo ?? o.agreementNo}</span>}
            description={<span className="flex flex-wrap items-center gap-2"><StateBadge state={o.state} /><span>{o.customerName}</span><span className="text-ink-muted">· {o.item}</span></span>}
          />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Order Value" value={money(o.contractValue)} subtitle={`${o.termMonths} months × ${money(o.monthlyFee)}`} rail="bg-primary" />
            <StatCard label="Your Share Earned" value={money(o.shareEarned)} subtitle={`${o.paidCount} of ${o.termMonths} months collected`} tone="success" rail="bg-synced" />
            <StatCard label="Your Share to Come" value={money(o.shareToCome)} subtitle={`${money(o.toCollect)} still to collect`} rail="bg-warning-text" />
            <StatCard
              label="Overdue"
              value={o.overdueMonths ? money(o.overdueAmount) : "None"}
              subtitle={o.overdueMonths ? `${count(o.overdueMonths, "month")} · your share ${money(o.overdueShare)}` : "Up to date"}
              tone={o.overdueMonths ? "error" : "default"}
              rail="bg-err"
            />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
            <Card title="Order">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4">
                <Fact label="Agreement No"><span className="font-docno">{o.agreementNo}</span></Fact>
                <Fact label="Sales Order">{o.soNo ? <span className="font-docno">{o.soNo}</span> : <Missing>Not linked</Missing>}</Fact>
                <Fact label="Customer" wide>{o.customerName}</Fact>
                <Fact label="Item" wide>{o.item}</Fact>
                <Fact label="Start Date">{fmtDay(o.startDate) || <Missing>Not started</Missing>}</Fact>
                <Fact label="Your Share">{o.ratePct}% of each month</Fact>
                <Fact label="Last Received">{fmtDay(o.lastPaidOn) || <Missing>Nothing yet</Missing>}</Fact>
                <Fact label="Next Due">{fmtDay(o.nextDueDate) || <Missing>Nothing due</Missing>}</Fact>
              </dl>
            </Card>
            <DataTable<FinanceInstalment>
              tableId="carres-supplier-finance-instalments"
              documentLabel="Instalments"
              exportName={`${o.agreementNo}-instalments`}
              columns={INSTALMENT_COLUMNS}
              rows={one.data.instalments}
              getRowKey={(i) => String(i.seq)}
              emptyLabel="No instalments."
            />
          </div>
        </>
      )}
    </>
  );
}
