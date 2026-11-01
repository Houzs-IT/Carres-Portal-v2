import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";
import { useDeliveryOrdersRegister, type DeliveryOrderAttemptRow } from "@/lib/queries";
import type { DeliveryHandoverKind } from "@carres/shared";
import Panel from "@/components/kit/Panel";
import CouldNotLoad from "./components/CouldNotLoad";
import ModuleHeader from "./components/ModuleHeader";
import OperationKpiTile from "./components/OperationKpiTile";
import { buildDoRegisterRow, groupProofRecords } from "./delivery-orders-register";
import { NOT_ASSIGNED, planRows, type PlanFeed, type PlanRow } from "./delivery-planning";
import { dueBuckets, dueOf, groupFigures, monthsOf, notClosed, openOrders, periodFigures, weeksOf } from "./logistic-overview";

/* Follows Houzs LogisticOverview.tsx:186-348, Weisiang's decision 2026-11-01. */
// design-standard: not-a-list-page: a report of tiles and small summary tables, no register.

const TH = "px-2 py-1 text-right text-meta font-medium text-base-600";
const TD = "px-2 py-1 text-right text-body tabular-nums";
const LEFT = "text-left";
const INPUT = "h-7 rounded-control border border-kit-slate-6 bg-white px-2 text-body";

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-base-200">
          {head.map((h, i) => <th key={h} className={`${TH} ${i === 0 ? LEFT : ""}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function FigureRows({ rows }: { rows: Array<{ key: string; label?: string; issued: number; amount: number; delivered: number }> }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key} className="border-b border-base-100">
          <td className={`${TD} ${LEFT}`}>{r.label ?? r.key}</td>
          <td className={TD}>{r.issued}</td>
          <td className={TD}>{rm(r.amount)}</td>
          <td className={TD}>{r.issued ? rm(r.amount / r.issued) : ""}</td>
          <td className={TD}>{r.delivered}</td>
        </tr>
      ))}
    </>
  );
}

function OrderList({ rows, empty }: { rows: PlanRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-body text-base-600">{empty}</p>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <Table head={["Order", "Customer", "Delivery", "Lorry or Logistics", "Amount"]}>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-base-100">
            <td className={`${TD} ${LEFT}`}>
              <Link className="text-c-link underline" to={`/operation/orders/so/${encodeURIComponent(r.orderId)}`}>{r.so}</Link>
            </td>
            <td className={`${TD} ${LEFT}`}>{r.customer}</td>
            <td className={TD}>{dueOf(r) ? fmtDate(dueOf(r) as string) : "No date yet"}</td>
            <td className={TD}>{r.carrier}</td>
            <td className={TD}>{rm(r.amount)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function LogisticOverview() {
  const today = appTodayIso();
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const setDate = (key: "from" | "to", value: string) =>
    value && setParams((prev) => { const next = new URLSearchParams(prev); next.set(key, value); return next; }, { replace: true });
  const [picked, setPicked] = useState<string | null>(null);

  /* shortcut: the register reads the newest 500 documents, so a period or month
     older than those reads low; move these figures to an API read if it matters. */
  const register = useDeliveryOrdersRegister();
  const feed = useQuery({ queryKey: ["delivery-planning"], queryFn: () => apiFetch<PlanFeed>("/api/operation/delivery-planning") });

  const dos = useMemo(() => {
    const data = register.data;
    const attempts = new Map<string, DeliveryOrderAttemptRow[]>();
    for (const a of data?.attempts ?? []) if (a.do_number) attempts.set(a.do_number, [...(attempts.get(a.do_number) ?? []), a]);
    const handover = new Map<string, DeliveryHandoverKind[]>();
    for (const e of data?.handoverEvents ?? []) handover.set(e.delivery_order_id, [...(handover.get(e.delivery_order_id) ?? []), e.kind]);
    const proof = groupProofRecords(data?.proofReviews, data?.attemptEvidence);
    return (data?.deliveryOrders ?? []).map((r) => buildDoRegisterRow(r, attempts, handover, proof));
  }, [register.data]);
  const plan = useMemo(() => (feed.data ? planRows(feed.data) : []), [feed.data]);

  const open = useMemo(() => openOrders(plan, dos), [plan, dos]);
  const buckets = useMemo(() => dueBuckets(open, today), [open, today]);
  const period = useMemo(() => periodFigures(dos, from, to), [dos, from, to]);
  const weeks = useMemo(() => weeksOf(dos, from, to, today), [dos, from, to, today]);
  const months = useMemo(() => monthsOf(dos), [dos]);
  const regionOf = useMemo(() => new Map(plan.map((r) => [r.orderId, r.region])), [plan]);
  const byRegion = groupFigures(period.rows, (r) => regionOf.get(r.orderId) ?? r.location);
  const byLorry = groupFigures(period.rows, (r) => r.vehicle ?? r.logisticsPartner ?? NOT_ASSIGNED);
  const noPhone = open.filter((r) => !r.phone?.trim());
  const stuck = notClosed(dos, today);
  const unconfirmed = open
    .filter((r) => !r.scheduled)
    .sort((a, b) => (a.requested ?? "9999").localeCompare(b.requested ?? "9999"));
  const todays = open.filter((r) => r.day === today);
  const pickedBucket = buckets.find((b) => b.key === picked);
  const openAmount = open.reduce((n, r) => n + r.amount, 0);

  const failed = (register.isError && !register.data) || (feed.isError && !feed.data);
  const head = ["Group", "DO", "Amount", "Average order", "Marked delivered"];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="logistic-overview">
      <ModuleHeader
        destinationHeader
        testId="logistic-overview-header"
        word="Logistic Overview"
        docTitle="Logistic Overview · Delivery · Carres"
        right={
          <span className="flex items-center gap-2">
            <input type="date" aria-label="From" className={INPUT} value={from} onChange={(e) => setDate("from", e.target.value)} />
            <input type="date" aria-label="To" className={INPUT} value={to} onChange={(e) => setDate("to", e.target.value)} />
          </span>
        }
      />
      {failed ? (
        <CouldNotLoad detail="The Logistic Overview could not be loaded." onRetry={() => { void register.refetch(); void feed.refetch(); }} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="logistic-overview-period">
              <OperationKpiTile label="DO issued" value={period.issued} hint={`${fmtDate(from)} to ${fmtDate(to)}`} accent="primary" />
              <OperationKpiTile label="DO amount" value={rm(period.amount)} hint={period.issued ? `Average order ${rm(period.amount / period.issued)}` : "No documents in this period"} accent="success" />
              <OperationKpiTile label="Marked delivered" value={period.delivered} hint={`of ${period.issued} issued`} accent="success" />
              <OperationKpiTile label="Still to deliver" value={open.length} hint={`${rm(openAmount)} · as of today`} accent="warning" />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Delivered in the period, by region">
                <Table head={head}><FigureRows rows={byRegion} /></Table>
              </Panel>
              <Panel title="Delivered in the period, by lorry or Logistics">
                <Table head={head}><FigureRows rows={byLorry} /></Table>
              </Panel>
            </div>

            <Panel title="Outstanding delivery, by when it is due">
              <div data-testid="logistic-overview-due">
                <Table head={["Due", "Orders", "Amount", "Date agreed"]}>
                  {buckets.map((b) => (
                    <tr key={b.key} className="cursor-pointer border-b border-base-100 hover:bg-base-50" onClick={() => setPicked(picked === b.key ? null : b.key)}>
                      <td className={`${TD} ${LEFT}`}>{b.label}</td>
                      <td className={TD}>{b.rows.length}</td>
                      <td className={TD}>{rm(b.amount)}</td>
                      <td className={TD}>{b.agreed}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className={`${TD} ${LEFT}`}>Total</td>
                    <td className={TD}>{open.length}</td>
                    <td className={TD}>{rm(openAmount)}</td>
                    <td className={TD}>{buckets.reduce((n, b) => n + b.agreed, 0)}</td>
                  </tr>
                </Table>
                {pickedBucket ? (
                  <div className="mt-3"><OrderList rows={pickedBucket.rows} empty="No orders here." /></div>
                ) : null}
              </div>
            </Panel>

            <Panel title="Weekly logistic report">
              <Table head={["Week", "DO", "Amount", "Average order", "Marked delivered"]}>
                <FigureRows rows={weeks.map((w) => ({ ...w, label: `${w.label} (${fmtDate(w.from)} to ${fmtDate(w.to)})${w.current ? " · now" : ""}` }))} />
              </Table>
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Monthly delivery volume">
                <Table head={["Month", "DO", "Amount", "Average order", "Marked delivered"]}>
                  <FigureRows rows={months.map((m) => ({ ...m, key: m.month }))} />
                </Table>
                <p className="mt-2 text-meta text-base-600">Reads the newest 500 delivery orders, so an older month can read low.</p>
              </Panel>
              <Panel title="Process gaps">
                <ul className="flex flex-col gap-3 text-body" data-testid="logistic-overview-gaps">
                  <li>
                    <b>DO out for delivery, never closed: {stuck.length}</b>
                    <p className="text-base-600">Issued more than 7 days ago and no delivery result recorded.</p>
                  </li>
                  <li>
                    <b>Open orders without a phone number: {noPhone.length} of {open.length}</b>
                    <p className="text-base-600">The customer cannot be called to agree a delivery date.</p>
                  </li>
                </ul>
                <Link className="mt-3 inline-block text-c-link underline" to="/operation/delivery-orders">Open Delivery Orders</Link>
              </Panel>
            </div>

            <Panel title="No delivery date confirmed">
              <OrderList rows={unconfirmed} empty="Every open order has a confirmed delivery date." />
            </Panel>
            <Panel title="Delivering today">
              <OrderList rows={todays} empty="No order is dated today." />
              <Link className="mt-3 inline-block text-c-link underline" to="/operation?tab=fleet-day">Open Last Mile Delivery</Link>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
