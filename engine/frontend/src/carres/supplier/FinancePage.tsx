// Carres only (not part of Houzs's code): the supplier's Finance pages.
//
// Carres sells on subscription: the customer pays a monthly instalment (for example 60 of them) and the supplier is
// paid a share of each month collected. These pages let the supplier's Finance people see, for the orders they have
// a share in: what each is worth, which months came in, what is still to come, and which customers are behind.
// Every figure is worked out by Carres's own books (the portal) and only shown here.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { StatCard } from "../../components/StatCard";
import { TabStrip } from "../../components/TabStrip";
import { supplierApi, type FinanceInstalment, type FinanceMonth, type FinanceOrder } from "./api";
import { Card, Fact, LoadError, Loading, Missing, PageTitle, Table, count, downloadCsv, fmtDay, fmtMonth, money, useLoad, type Column } from "./ui";

type Tone = "neutral" | "accent" | "success" | "warning" | "error";
const ORDER_STATE: Partial<Record<string, { label: string; tone: Tone }>> = {
  on_time: { label: "On time", tone: "success" },
  behind: { label: "Behind", tone: "warning" },
  default: { label: "In default", tone: "error" },
  completed: { label: "Paid in full", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
};
function StateBadge({ state }: { state: string }) {
  const s = ORDER_STATE[state] ?? { label: state, tone: "neutral" as Tone };
  return <Badge tone={s.tone} size="sm" caseless>{s.label}</Badge>;
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "0%");

const ORDER_COLUMNS: Column<FinanceOrder>[] = [
  {
    key: "order", header: "Order", sortValue: (o) => o.agreementNo,
    cell: (o) => (
      <div>
        <div className="font-mono text-[12.5px] font-bold text-primary-ink">{o.soNo ?? o.agreementNo}</div>
        {o.soNo && <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{o.agreementNo}</div>}
      </div>
    ),
    csv: (o) => o.soNo ?? o.agreementNo,
  },
  { key: "agreement", header: "Agreement No", cell: () => null, className: "hidden", csv: (o) => o.agreementNo },
  { key: "customer", header: "Customer", wrap: true, sortValue: (o) => o.customerName, cell: (o) => <span className="block min-w-[110px]">{o.customerName}</span>, csv: (o) => o.customerName },
  { key: "item", header: "Item", wrap: true, sortValue: (o) => o.item, cell: (o) => <span className="block min-w-[150px]">{o.item}</span>, csv: (o) => o.item },
  { key: "value", header: "Order Value", align: "right", sortValue: (o) => o.contractValue, cell: (o) => money(o.contractValue), csv: (o) => o.contractValue },
  {
    // The money collected with the months it came from under it: one column, as Overdue is, so the table fits a
    // laptop screen. The file keeps the two as separate columns.
    key: "collected", header: "Collected", align: "right", sortValue: (o) => o.collected,
    cell: (o) => <div><div>{money(o.collected)}</div><div className="mt-0.5 text-[11px] text-ink-muted">{o.paidCount} of {count(o.termMonths, "month")}</div></div>,
    csv: (o) => o.collected,
  },
  { key: "paid", header: "Months Paid", cell: () => null, className: "hidden", csv: (o) => o.paidCount },
  { key: "term", header: "Months in Total", cell: () => null, className: "hidden", csv: (o) => o.termMonths },
  { key: "earned", header: "Share Earned", align: "right", sortValue: (o) => o.shareEarned, cell: (o) => <span className="font-semibold">{money(o.shareEarned)}</span>, csv: (o) => o.shareEarned },
  { key: "tocome", header: "Share to Come", align: "right", sortValue: (o) => o.shareToCome, cell: (o) => money(o.shareToCome), csv: (o) => o.shareToCome },
  {
    key: "overdue", header: "Overdue", align: "right", sortValue: (o) => o.overdueAmount,
    cell: (o) => (o.overdueMonths > 0
      ? <div><div className="font-semibold text-err">{money(o.overdueAmount)}</div><div className="mt-0.5 text-[11px] text-ink-muted">{count(o.overdueMonths, "month")}</div></div>
      : <Missing>None</Missing>),
    csv: (o) => o.overdueAmount,
  },
  { key: "overdueMonths", header: "Months Overdue", cell: () => null, className: "hidden", csv: (o) => o.overdueMonths },
  { key: "next", header: "Next Due", sortValue: (o) => o.nextDueDate, cell: (o) => fmtDay(o.nextDueDate) || <Missing>Nothing due</Missing>, className: "whitespace-nowrap", csv: (o) => o.nextDueDate },
  { key: "state", header: "Status", sortValue: (o) => o.state, cell: (o) => <StateBadge state={o.state} />, csv: (o) => ORDER_STATE[o.state]?.label ?? o.state },
];
/** The columns that ride on the file only: the screen shows each beside the figure it belongs to. */
const FILE_ONLY = new Set(["agreement", "paid", "term", "overdueMonths"]);
const ORDER_SCREEN = ORDER_COLUMNS.filter((c) => !FILE_ONLY.has(c.key));
/** Where Overdue sits on screen: the foot of the "Behind on payment" list puts its total under that column. */
const OVERDUE_AT = ORDER_SCREEN.findIndex((c) => c.key === "overdue");

const MONTH_COLUMNS: Column<FinanceMonth>[] = [
  { key: "month", header: "Month Due", sortValue: (m) => m.month, cell: (m) => <span className="font-semibold">{fmtMonth(m.month)}</span>, csv: (m) => m.month },
  { key: "due", header: "Instalments Due", align: "right", sortValue: (m) => m.due, cell: (m) => money(m.due), csv: (m) => m.due },
  { key: "collected", header: "Collected", align: "right", sortValue: (m) => m.collected, cell: (m) => money(m.collected), csv: (m) => m.collected },
  { key: "open", header: "Not Collected Yet", align: "right", sortValue: (m) => m.open, cell: (m) => (m.open > 0 ? money(m.open) : <Missing>None</Missing>), csv: (m) => m.open },
  { key: "earned", header: "Share Earned", align: "right", sortValue: (m) => m.collectedShare, cell: (m) => <span className="font-semibold">{money(m.collectedShare)}</span>, csv: (m) => m.collectedShare },
  { key: "tocome", header: "Share to Come", align: "right", sortValue: (m) => m.openShare, cell: (m) => (m.openShare > 0 ? money(m.openShare) : <Missing>None</Missing>), csv: (m) => m.openShare },
];

type Tab = "orders" | "overdue" | "months";

export function FinancePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("orders");
  const finance = useLoad("finance", () => supplierApi.finance());
  const data = finance.data;

  const overdue = useMemo(() => (data?.shared ? data.orders.filter((o) => o.overdueMonths > 0) : []), [data]);

  if (finance.error) return <><PageTitle title="Finance" /><LoadError message={finance.error} onRetry={finance.reload} /></>;
  if (!data) return <><PageTitle title="Finance" /><Loading /></>;
  if (!data.shared) {
    return (
      <>
        <PageTitle title="Finance" />
        <EmptyState message="No subscription orders are shared with your company." description="When Carres shares subscription collections with you, they appear here." />
      </>
    );
  }

  const t = data.totals;
  const rows = tab === "overdue" ? overdue : data.orders;
  return (
    <>
      <PageTitle
        title="Finance"
        description={<>Subscription orders you have a share in, as of {fmtDay(data.asOf)}. Your share of a month is earned when the customer's instalment is collected.</>}
        actions={(
          <Button
            variant="secondary"
            icon={<Download size={14} />}
            disabled={tab === "months" ? !data.months.length : !rows.length}
            onClick={() => (tab === "months" ? downloadCsv("subscription-by-month.csv", MONTH_COLUMNS, data.months) : downloadCsv(`subscription-orders${tab === "overdue" ? "-overdue" : ""}.csv`, ORDER_COLUMNS, rows))}
          >
            Download CSV
          </Button>
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total order value" value={money(t.contractValue)} subtitle={count(t.orders, "order")} />
        <StatCard label="Your share in full" value={money(t.shareTotal)} subtitle="Earned plus still to come" />
        <StatCard label="Your share earned" value={money(t.shareEarned)} subtitle={`${money(t.collected)} collected · ${count(t.collectedCount, "month")}`} tone="success" />
        <StatCard label="Your share to come" value={money(t.shareToCome)} subtitle={`${money(t.toCollect)} still to collect`} />
        <StatCard
          label="Behind on payment"
          value={`${t.overdueOrders} of ${t.orders}`}
          subtitle={t.overdueOrders ? `${pct(t.overdueOrders, t.orders)} of orders · ${money(t.overdueAmount)} overdue${t.defaultOrders ? ` · ${t.defaultOrders} in default` : ""}` : "Every order is on time"}
          tone={t.overdueOrders ? "error" : "default"}
          onClick={t.overdueOrders ? () => setTab("overdue") : undefined}
          active={tab === "overdue"}
        />
      </div>
      <TabStrip
        value={tab}
        onChange={setTab}
        options={[
          { value: "orders", label: "All orders", count: t.orders },
          { value: "overdue", label: "Behind on payment", count: t.overdueOrders },
          { value: "months", label: "By month" },
        ]}
      />
      {tab === "months" ? (
        <Table
          columns={MONTH_COLUMNS}
          rows={data.months}
          rowKey={(m) => m.month}
          empty="No instalments yet."
          footer={(
            // The foot adds up the rows above it, so the column and its total can never disagree.
            <tr className="bg-surface-2 font-bold">
              <td className="px-3 py-2.5">Total</td>
              {(["due", "collected", "open", "collectedShare", "openShare"] as const).map((k) => (
                <td key={k} className="px-3 py-2.5 text-right tabular-nums">{money(Math.round(data.months.reduce((a, m) => a + m[k], 0) * 100) / 100)}</td>
              ))}
            </tr>
          )}
        />
      ) : (
        <Table
          columns={ORDER_SCREEN}
          rows={rows}
          rowKey={(o) => o.id}
          onRowClick={(o) => navigate(`/supplier/finance/${o.id}`)}
          empty={tab === "overdue" ? "No customer is behind on payment." : "No subscription orders yet."}
          footer={tab === "overdue" ? (
            <tr className="bg-surface-2 font-bold">
              <td className="px-3 py-2.5" colSpan={OVERDUE_AT}>Total overdue · your share at risk {money(t.overdueShare)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-err">{money(t.overdueAmount)}</td>
              <td className="px-3 py-2.5" colSpan={ORDER_SCREEN.length - OVERDUE_AT - 1} />
            </tr>
          ) : undefined}
        />
      )}
      {tab === "overdue" && overdue.length > 0 && (
        <p className="mt-3 text-[11.5px] text-ink-muted">
          An instalment is overdue once its due day has passed with no payment. Six unpaid instalments put an order in default.
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

const INSTALMENT_COLUMNS: Column<FinanceInstalment>[] = [
  { key: "seq", header: "Month", align: "right", sortValue: (i) => i.seq, cell: (i) => i.seq, csv: (i) => i.seq },
  { key: "due", header: "Due Date", sortValue: (i) => i.dueDate, cell: (i) => fmtDay(i.dueDate), className: "whitespace-nowrap", csv: (i) => i.dueDate },
  { key: "amount", header: "Instalment", align: "right", sortValue: (i) => i.amountDue, cell: (i) => money(i.amountDue), csv: (i) => i.amountDue },
  {
    key: "state", header: "Status", sortValue: (i) => i.state,
    cell: (i) => {
      const s = INSTALMENT_STATE[i.state] ?? { label: i.state, tone: "neutral" as Tone };
      return (
        <span className="inline-flex items-center gap-2">
          <Badge tone={s.tone} size="sm" caseless variant={i.state === "upcoming" ? "outline" : "soft"}>{s.label}</Badge>
          {i.state === "late" && <span className="text-[11px] text-err">{count(i.daysLate, "day")} late</span>}
        </span>
      );
    },
    csv: (i) => INSTALMENT_STATE[i.state]?.label ?? i.state,
  },
  { key: "paidOn", header: "Received On", sortValue: (i) => i.paidOn, cell: (i) => fmtDay(i.paidOn) || <Missing>Not received</Missing>, className: "whitespace-nowrap", csv: (i) => i.paidOn },
  { key: "paid", header: "Received", align: "right", sortValue: (i) => i.paidAmount ?? 0, cell: (i) => (i.paidAmount == null ? <Missing>None</Missing> : money(i.paidAmount)), csv: (i) => i.paidAmount },
  {
    key: "share", header: "Your Share", align: "right", sortValue: (i) => i.share,
    cell: (i) => (i.state === "paid" ? <span className="font-semibold">{money(i.share)}</span> : i.state === "waived" ? <Missing>None</Missing> : <span className="text-ink-muted">{money(i.share)}</span>),
    csv: (i) => i.share,
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
          <PageTitle
            title={o.soNo ?? o.agreementNo}
            description={<span className="flex flex-wrap items-center gap-2"><StateBadge state={o.state} /><span>{o.customerName}</span><span className="text-ink-muted">· {o.item}</span></span>}
            actions={<Button variant="secondary" icon={<Download size={14} />} onClick={() => downloadCsv(`${o.agreementNo}-instalments.csv`, INSTALMENT_COLUMNS, one.data!.instalments)}>Download CSV</Button>}
          />
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Order value" value={money(o.contractValue)} subtitle={`${o.termMonths} months × ${money(o.monthlyFee)}`} />
            <StatCard label="Your share earned" value={money(o.shareEarned)} subtitle={`${o.paidCount} of ${o.termMonths} months collected`} tone="success" />
            <StatCard label="Your share to come" value={money(o.shareToCome)} subtitle={`${money(o.toCollect)} still to collect`} />
            <StatCard
              label="Overdue"
              value={o.overdueMonths ? money(o.overdueAmount) : "None"}
              subtitle={o.overdueMonths ? `${count(o.overdueMonths, "month")} · your share ${money(o.overdueShare)}` : "Up to date"}
              tone={o.overdueMonths ? "error" : "default"}
            />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
            <Card title="Order">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4">
                <Fact label="Agreement No"><span className="font-mono">{o.agreementNo}</span></Fact>
                <Fact label="Sales Order">{o.soNo ? <span className="font-mono">{o.soNo}</span> : <Missing>Not linked</Missing>}</Fact>
                <Fact label="Customer" wide>{o.customerName}</Fact>
                <Fact label="Item" wide>{o.item}</Fact>
                <Fact label="Start Date">{fmtDay(o.startDate) || <Missing>Not started</Missing>}</Fact>
                <Fact label="Your Share">{o.ratePct}% of each month</Fact>
                <Fact label="Last Received">{fmtDay(o.lastPaidOn) || <Missing>Nothing yet</Missing>}</Fact>
                <Fact label="Next Due">{fmtDay(o.nextDueDate) || <Missing>Nothing due</Missing>}</Fact>
              </dl>
            </Card>
            <Table columns={INSTALMENT_COLUMNS} rows={one.data.instalments} rowKey={(i) => String(i.seq)} empty="No instalments." />
          </div>
        </>
      )}
    </>
  );
}
