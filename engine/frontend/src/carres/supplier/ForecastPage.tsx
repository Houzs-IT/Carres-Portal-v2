// Carres only (not part of Houzs's code): the supplier's Forecast.
//
// Units, never money: each of the supplier's items on Carres's open orders, split by stage and by the month the
// customer expects delivery. Collected goods are left out. An item opens in place to list every open Sales Order that
// carries it, soonest delivery first, and each of those opens in place again (owner's design, 17 Nov 2026): reading
// an order here never leaves the Forecast.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { supplierApi, type ForecastRow, type Order, type OrderLine } from "./api";
import { useOrders } from "./data";
import { ListCount, ListTable, Toolbar, exportList, useListPrefs, type Column } from "./ListTable";
import { addressText, saleTypeLabel } from "./OrdersPage";
import { PageBar, PageBody, useSupplierSession } from "./Shell";
import { Badge, EASE, LoadError, Loading, StatStrip, count, fmtDay, fmtMonth, orderPickupBadge, play, stageBadge, useLoad, useToast } from "./ui";

const OPEN = ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD"];
const keyOf = (r: Pick<ForecastRow, "itemCode" | "spec">) => `${r.itemCode}\u0000${r.spec ?? ""}`;
const monthLabel = (m: string) => (m ? fmtMonth(m) : "No date yet");
const num = (x: number, bold?: boolean) => ({ kind: "text" as const, v: x, fg: x ? undefined : "#9AA0A8", bold });

export function ForecastPage() {
  const toast = useToast();
  const { can } = useSupplierSession();
  const forecast = useLoad("forecast", () => supplierApi.forecast());
  const orders = useOrders(can("operation", "v_orders"));
  const api = useListPrefs("forecast");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const f = forecast.data;
  const rows = useMemo(() => {
    const all = f?.rows ?? [];
    const s = q.trim().toLowerCase();
    return s ? all.filter((r) => `${r.description} ${r.itemCode} ${r.spec ?? ""} ${r.modelName ?? ""}`.toLowerCase().includes(s)) : all;
  }, [f, q]);

  const columns = useMemo<Column<ForecastRow>[]>(() => {
    const months = f?.months ?? [];
    const sum = (rs: ForecastRow[], g: (r: ForecastRow) => number) => rs.reduce((a, r) => a + g(r), 0);
    return [
      { key: "item", label: "Item", width: 240, shrink: true, render: (r) => ({ kind: "text", v: r.description, bold: true }), exportValue: (r) => r.description, foot: (rs) => ({ v: `Total · ${count(rs.length, "item")}` }) },
      { key: "code", label: "Item Code", width: 120, render: (r) => ({ kind: "text", v: r.itemCode, fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (r) => r.itemCode },
      { key: "model", label: "Model", width: 120, hidden: true, render: (r) => ({ kind: "text", v: r.modelName || "No model", fg: r.modelName ? undefined : "rgb(var(--hz-ink-muted))" }), exportValue: (r) => r.modelName ?? "" },
      { key: "spec", label: "Specification", width: 160, shrink: true, render: (r) => ({ kind: "text", v: r.spec || "Standard", fg: r.spec ? undefined : "rgb(var(--hz-ink-muted))" }), exportValue: (r) => r.spec || "Standard" },
      { key: "unit", label: "Unit", width: 70, render: (r) => ({ kind: "text", v: r.uom, fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (r) => r.uom },
      { key: "incoming", label: "Incoming", width: 96, align: "right", render: (r) => num(r.incoming), exportValue: (r) => r.incoming, foot: (rs) => ({ v: sum(rs, (r) => r.incoming) }) },
      { key: "processing", label: "In Production", width: 110, align: "right", render: (r) => num(r.processing), exportValue: (r) => r.processing, foot: (rs) => ({ v: sum(rs, (r) => r.processing) }) },
      { key: "total", label: "Total", width: 80, align: "right", render: (r) => num(r.total, true), exportValue: (r) => r.total, foot: (rs) => ({ v: sum(rs, (r) => r.total) }) },
      ...months.map<Column<ForecastRow>>((m) => ({
        key: `m:${m}`, label: monthLabel(m), width: 110, align: "right",
        render: (r) => num(r.byMonth[m] ?? 0), exportValue: (r) => r.byMonth[m] ?? 0, foot: (rs) => ({ v: sum(rs, (r) => r.byMonth[m] ?? 0) }),
      })),
    ];
  }, [f]);

  const doExport = async () => {
    try { await exportList("forecast", columns, api.prefs, rows); } catch (e) { toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red"); }
  };

  const t = f?.totals;
  return (
    <>
      <PageBar eyebrow="Warehouse and Operation" title="Forecast" />
      <PageBody scroll={false} riseKey="forecast">
        <StatStrip
          stats={[
            { label: "Open Orders", value: t?.orders ?? 0, rail: "rgb(var(--hz-primary))" },
            { label: "Incoming", value: t?.incoming ?? 0, rail: "rgb(var(--hz-primary-ink))" },
            { label: "In Production", value: t?.processing ?? 0, rail: "rgb(var(--hz-warning-text))" },
            { label: "Total to Prepare", value: t?.total ?? 0, rail: "rgb(var(--hz-synced))", fg: "rgb(var(--hz-synced))" },
          ]}
        />
        <Toolbar search={q} onSearch={setQ} placeholder="Search item, code or specification" rowCount={rows.length} columns={columns} api={api}
          onExport={doExport} exportCount={0} canExport={can("operation", "a_export")} />
        {forecast.error && !f ? (
          <LoadError message={forecast.error} onRetry={forecast.reload} />
        ) : !f ? (
          <Loading />
        ) : (
          <ListTable<ForecastRow>
            columns={columns} rows={rows} rowKey={keyOf} api={api} totals
            openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
            expanded={(r) => <ItemOrders row={r} orders={orders.data} canOrders={can("operation", "v_orders")} loading={orders.loading} />}
            empty={q.trim() ? `No item matches "${q.trim()}".` : "No open orders carry your items right now."}
            footer={<ListCount>{count(rows.length, "item")}</ListCount>}
          />
        )}
      </PageBody>
    </>
  );
}

const TH = "sticky top-0 whitespace-nowrap bg-border-subtle px-3 py-[7px] text-left text-[11px] font-semibold text-ink-secondary";
const TD = "whitespace-nowrap border-t border-surface-dim px-3 py-[7px] text-[12.5px]";

/** Every open Sales Order carrying this item (and specification), soonest delivery first. */
function ItemOrders({ row, orders, canOrders, loading }: { row: ForecastRow; orders: Order[] | null; canOrders: boolean; loading: boolean }) {
  const [openSo, setOpenSo] = useState<string | null>(null);
  const hits = useMemo(() => {
    const out: Array<{ o: Order; l: OrderLine }> = [];
    for (const o of orders ?? []) {
      if (!OPEN.includes(o.status)) continue;
      for (const l of o.lines) {
        if (l.itemCode === row.itemCode && (l.spec ?? "") === (row.spec ?? "") && l.pickup.state !== "collected") out.push({ o, l });
      }
    }
    return out.sort((a, b) => (a.o.deliveryDate ?? "9").localeCompare(b.o.deliveryDate ?? "9"));
  }, [orders, row]);
  const units = hits.reduce((a, x) => a + x.l.qty, 0);

  return (
    <div className="px-5 pb-4 pt-[14px]">
      <div className="mb-2 flex justify-between text-[12px] font-semibold text-ink-muted">
        <span>Sales orders with {row.description}</span>
        <span>{canOrders && orders ? `${count(hits.length, "order")} · ${count(units, "unit")}` : ""}</span>
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border bg-surface">
        {!canOrders ? (
          <div className="px-3 py-3 text-[12.5px] text-ink-muted">Your account does not open the Sales Orders.</div>
        ) : !orders ? (
          <div className="px-3 py-3 text-[12.5px] text-ink-muted">{loading ? "Loading" : "The orders could not be loaded."}</div>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={TH}>SO No</th><th className={TH}>SO Date</th><th className={TH}>Customer</th><th className={TH}>Specification</th>
                <th className={TH}>Stage</th><th className={TH}>Delivery</th><th className={cn(TH, "text-right")}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {hits.length === 0 && (
                <tr><td colSpan={7} className={cn(TD, "text-ink-muted")}>No open order carries this item right now.</td></tr>
              )}
              {hits.map(({ o, l }) => {
                const on = openSo === o.docNo;
                return (
                  <OrderRow key={`${o.docNo}-${l.soItemId}`} order={o} line={l} item={row} open={on} onToggle={() => setOpenSo(on ? null : o.docNo)} />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OrderRow({ order: o, line: l, item, open, onToggle }: { order: Order; line: OrderLine; item: ForecastRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:!bg-primary-soft/35" style={{ background: open ? "rgba(220,230,253,0.4)" : "#fff" }}>
        <td className={TD}>
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={12} style={{ color: open ? "rgb(var(--hz-primary))" : "#9AA0A8", transform: open ? "rotate(90deg)" : "none", transition: `transform 220ms ${EASE}` }} aria-hidden="true" />
            <span className="font-docno text-[12px] font-semibold text-primary-ink">{o.docNo}</span>
          </span>
        </td>
        <td className={cn(TD, "text-ink-secondary")}>{fmtDay(o.soDate)}</td>
        <td className={cn(TD, "font-semibold text-ink")}>{o.customerName || "No name"}</td>
        <td className={cn(TD, "text-ink-secondary")}>{l.spec || "Standard"}</td>
        <td className={TD}><Badge b={stageBadge(o.status)} size="xs" /></td>
        <td className={TD} style={{ color: o.deliveryDate ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>{fmtDay(o.deliveryDate) || "Not set"}</td>
        <td className={cn(TD, "text-right font-bold text-ink")}>{l.qty} <span className="text-[10.5px] font-semibold text-ink-muted">{l.uom}</span></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="whitespace-normal border-t border-surface-dim bg-surface-2 pb-[14px] pl-8 pr-[14px] pt-3">
            <OrderInside order={o} item={item} />
          </td>
        </tr>
      )}
    </>
  );
}

/** An order opened inside the Forecast: its facts, all its items (this one in bold), and where it has got to. */
function OrderInside({ order: o, item }: { order: Order; item: ForecastRow }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 240);
  }, []);
  const pk = orderPickupBadge(o.pickupState);
  const pkLine = o.lines.find((l) => l.pickup.expectedDate);
  const trail: Array<[string, string]> = [["Submitted", fmtDay(o.soDate)]];
  if (o.processingDate) trail.push(["In Production", fmtDay(o.processingDate)]);
  if (o.pickupState !== "none") trail.push([pk.label, pkLine?.pickup.expectedDate ? fmtDay(pkLine.pickup.expectedDate) : ""]);
  const facts: Array<{ label: string; v: string; fg: string }> = [
    { label: "Processing", v: fmtDay(o.processingDate) || "Not processed yet", fg: o.processingDate ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" },
    { label: "Sale Type", v: saleTypeLabel(o.saleType), fg: "rgb(var(--hz-ink))" },
    { label: "Pickup", v: pk.label, fg: pk.outline ? "rgb(var(--hz-ink-muted))" : pk.tone === "warning" ? "rgb(var(--hz-warning-text))" : pk.tone === "success" ? "rgb(var(--hz-synced))" : "rgb(var(--hz-primary-ink))" },
    { label: "Address", v: addressText(o) || "No address", fg: "rgb(var(--hz-ink))" },
  ];
  return (
    <div ref={ref} className="grid gap-5" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr)" }}>
      <dl className="m-0 grid gap-x-3 gap-y-1.5 text-[12.5px]" style={{ gridTemplateColumns: "110px minmax(0,1fr)" }}>
        {facts.map((x) => (
          <div key={x.label} className="contents">
            <dt className="text-ink-muted">{x.label}</dt>
            <dd className="m-0" style={{ color: x.fg }}>{x.v}</dd>
          </div>
        ))}
      </dl>
      <div className="min-w-0">
        <div className="mb-1 text-[11.5px] font-semibold text-ink-muted">All items on this order</div>
        {o.lines.map((x, i) => {
          const mine = x.itemCode === item.itemCode;
          return (
            <div key={x.soItemId} className="flex justify-between gap-3 py-[5px] text-[12.5px]" style={{ borderTop: i ? "1px solid rgb(var(--hz-surface-dim))" : "0", fontWeight: mine ? 700 : 400, color: mine ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-secondary))" }}>
              <span className="min-w-0 truncate">{x.description} <span className="font-normal text-ink-muted">· {x.itemCode}</span></span>
              <span className="whitespace-nowrap">{x.qty} {x.uom}</span>
            </div>
          );
        })}
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[11.5px] font-semibold text-ink-muted">History</div>
        {trail.map(([label, at]) => (
          <div key={label} className="flex justify-between gap-3 py-[5px] text-[12.5px]">
            <span className="font-semibold text-ink">{label}</span>
            <span className="whitespace-nowrap text-ink-muted">{at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
