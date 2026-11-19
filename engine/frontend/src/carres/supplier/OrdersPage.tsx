// Carres only (not part of Houzs's code): the supplier's Sales Orders, as a list and one order's full page.
//
// What the supplier reads of an order is decided by the server (migration 2012, ./orders.ts on the engine): no price,
// cost, phone, email, payment or remark; the customer's name and delivery address are allowed. Drawn to the owner's
// design of 17 Nov 2026: figure cards, pills, the list table, a row opening in place, and the order's full page.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, Share2 } from "lucide-react";
import { DocumentRelationshipMapModal, type ChainNode } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { supplierApi, type MapNode, type Order, type OrderDetail, type OrderView, type Pickup, type TrailEntry } from "./api";
import { useOrders, usePickups } from "./data";
import { orderPdf, pickupPdf } from "./docs";
import { CardsCount, CardsView, ListCount, ListTable, SelectionBar, Toolbar, exportList, isShown, useListPrefs, type CardSpec, type Column } from "./ListTable";
import { BarButton, PageBar, PageBody, Stepper, useSupplierSession } from "./Shell";
import {
  Badge, Facts, LoadError, Loading, OpenFull, PdfMark, Pills, Section, StatStrip, ViewToggle, collectOn, count, fmtDay, fmtStamp,
  orderPickupBadge, pickupBadge, plural, stageBadge, useLoad, useToast, type FactSpec,
} from "./ui";
import { BASE } from "./host";

// ── Shared words ────────────────────────────────────────────────────────────────────────────────────────────────

const INCOMING = ["CONFIRMED"];
const PROCESSING = ["IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD"];
const DELIVERED = ["SHIPPED", "DELIVERED", "INVOICED", "CLOSED"];

export const inView = (o: Order, v: OrderView): boolean =>
  v === "all" || (v === "incoming" && INCOMING.includes(o.status)) || (v === "processing" && PROCESSING.includes(o.status)) || (v === "delivered" && DELIVERED.includes(o.status));

export const saleTypeLabel = (t: string): string => (t.toLowerCase() === "subscription" ? "Subscription" : "Outright");
export const addressText = (o: Pick<Order, "addressLines">): string => o.addressLines.join(", ");
export const unitsWord = (n: number) => `${n} ${plural(n, "unit")}`;

/** One line of the item's code, model and specification: "MT-QPS-183 · Aurora · 183 x 190 · Firm". */
export const codeLine = (l: { itemCode: string; modelName: string | null; spec: string | null }) =>
  [l.itemCode, l.modelName, l.spec].filter(Boolean).join(" · ");

/** The history in words: what happened and when; a pickup event names its request. */
export function trailWords(t: TrailEntry): { label: string; at: string } {
  const at = fmtStamp(t.at);
  const withRef = (s: string) => (t.ref ? `${s} · ${t.ref}` : s);
  switch (t.code) {
    case "RECEIVED": return { label: "Order received", at };
    case "PICKUP_REQUESTED": return { label: t.detail ? `Pickup requested for ${fmtDay(t.detail)}` : "Pickup requested", at: withRef(at) };
    case "PICKUP_ACCEPTED": return { label: "Pickup accepted", at: withRef(at) };
    case "PICKUP_COLLECTED": return { label: "Collected by Carres", at: withRef(at) };
    case "PICKUP_CANCELLED": return { label: "Pickup request cancelled", at: withRef(at) };
    case "PICKUP_DATE_CHANGED": return { label: t.detail ? `Pickup moved to ${fmtDay(t.detail)}` : "Pickup date changed", at: withRef(at) };
    default: return { label: stageBadge(t.code).label, at };
  }
}

// ── The list ────────────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNS = (open: (o: Order) => void): Column<Order>[] => [
  { key: "doc", label: "SO No", width: 140, render: (o) => ({ kind: "doc", v: o.docNo, go: () => open(o) }), exportValue: (o) => o.docNo },
  { key: "date", label: "SO Date", width: 104, render: (o) => ({ kind: "text", v: fmtDay(o.soDate) || "No date", fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (o) => fmtDay(o.soDate) },
  { key: "customer", label: "Customer", width: 200, shrink: true, render: (o) => ({ kind: "text", v: o.customerName || "No name", bold: true }), exportValue: (o) => o.customerName },
  {
    key: "items", label: "Items", width: 260,
    render: (o) => ({ kind: "text", v: o.lines.length > 1 ? `${o.lines[0]!.description} +${o.lines.length - 1}` : o.lines[0]?.description ?? "" }),
    exportValue: (o) => o.lines.map((l) => `${l.qty} ${l.uom} ${l.description}${l.spec ? ` (${l.spec})` : ""}`).join("; "),
  },
  { key: "qty", label: "Qty", width: 64, align: "right", render: (o) => ({ kind: "text", v: o.unitCount }), exportValue: (o) => o.unitCount },
  { key: "processing", label: "Processing Date", width: 120, hidden: true, render: (o) => ({ kind: "text", v: fmtDay(o.processingDate) || "Not processed", fg: o.processingDate ? undefined : "rgb(var(--hz-ink-muted))" }), exportValue: (o) => fmtDay(o.processingDate) },
  { key: "delivery", label: "Delivery", width: 104, render: (o) => ({ kind: "text", v: fmtDay(o.deliveryDate) || "Not set", fg: o.deliveryDate ? undefined : "rgb(var(--hz-ink-muted))" }), exportValue: (o) => fmtDay(o.deliveryDate) },
  { key: "address", label: "Delivery Address", width: 260, hidden: true, shrink: true, render: (o) => ({ kind: "text", v: addressText(o) || "No address" }), exportValue: (o) => addressText(o) },
  { key: "stage", label: "Stage", width: 130, render: (o) => ({ kind: "badge", b: stageBadge(o.status) }), exportValue: (o) => stageBadge(o.status).label },
  { key: "pickup", label: "Pickup", width: 140, render: (o) => ({ kind: "badge", b: orderPickupBadge(o.pickupState) }), exportValue: (o) => orderPickupBadge(o.pickupState).label },
];

const matches = (o: Order, q: string): boolean => {
  if (!q) return true;
  const hay = `${o.docNo} ${o.customerName} ${o.lines.map((l) => `${l.itemCode} ${l.description} ${l.modelName ?? ""} ${l.spec ?? ""}`).join(" ")}`.toLowerCase();
  return hay.includes(q.toLowerCase());
};

export function OrdersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, can } = useSupplierSession();
  const orders = useOrders();
  const api = useListPrefs("orders");
  const [view, setView] = useState<OrderView>("all");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const all = orders.data ?? [];
  const shown = useMemo(() => all.filter((o) => inView(o, view) && matches(o, q.trim())), [all, view, q]);
  const cnt = (v: OrderView) => all.filter((o) => inView(o, v)).length;
  const waiting = me.badges.pickupsToAccept;
  const openFull = (o: Order) => navigate(`${BASE}/orders/${encodeURIComponent(o.docNo)}`);
  const columns = useMemo(() => COLUMNS(openFull), []); // eslint-disable-line react-hooks/exhaustive-deps

  const tickedRows = shown.filter((o) => picked[o.docNo]);
  const tickedLines = tickedRows.flatMap((o) => o.lines);
  const skus = new Set(tickedLines.map((l) => l.itemCode)).size;
  const units = tickedLines.reduce((a, l) => a + l.qty, 0);
  const clear = () => setPicked({});
  const footer = tickedRows.length
    ? <SelectionBar n={tickedRows.length} items={[{ v: skus, label: plural(skus, "SKU") }, { v: units, label: "units" }]} onClear={clear} rounded={api.prefs.mode === "cards"} />
    : null;

  const doExport = async () => {
    try {
      await exportList("sales-orders", columns, api.prefs, tickedRows.length ? tickedRows : shown);
    } catch (e) {
      toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red");
    }
  };

  const cards: CardSpec[] = shown.map((o) => ({
    key: o.docNo, doc: o.docNo, badge: stageBadge(o.status), title: o.customerName || "No name",
    line: o.lines.map((l) => l.description).join(", "), footLabel: "Delivery Date", footValue: fmtDay(o.deliveryDate) || "Not set",
    rightLabel: orderPickupBadge(o.pickupState).label, rightLabelFg: pickupFg(o.pickupState), right: unitsWord(o.unitCount), onOpen: () => openFull(o),
  }));

  const empty = q.trim() ? `No sales order matches "${q.trim()}".` : view === "incoming" ? "No incoming orders right now." : "No sales orders are shared with you yet.";

  return (
    <>
      <PageBar eyebrow="Warehouse and Operation" title="Sales Orders" />
      <PageBody scroll={false} riseKey="orders">
        <StatStrip
          stats={[
            { label: "Total Orders", value: all.length, rail: "rgb(var(--hz-primary))", active: view === "all", onClick: () => setView("all") },
            { label: "Incoming", value: cnt("incoming"), rail: "rgb(var(--hz-primary-ink))", active: view === "incoming", onClick: () => setView("incoming") },
            { label: "In Production", value: cnt("processing"), rail: "rgb(var(--hz-warning-text))", active: view === "processing", onClick: () => setView("processing") },
            {
              label: "Pickups to Accept", value: waiting, rail: waiting ? "rgb(var(--hz-err))" : "rgb(var(--hz-synced))", fg: waiting ? "rgb(var(--hz-warning-text))" : undefined,
              onClick: can("operation", "v_pickups") ? () => navigate(`${BASE}/pickups`) : undefined,
            },
          ]}
        />
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
          <Pills<OrderView>
            value={view}
            onChange={setView}
            options={[
              { key: "all", label: "All", count: cnt("all") },
              { key: "incoming", label: "Incoming", count: cnt("incoming") },
              { key: "processing", label: "In production", count: cnt("processing") },
              { key: "delivered", label: "Delivered", count: cnt("delivered") },
            ]}
          />
          <div className="flex-1" />
          <ViewToggle value={api.prefs.mode} onChange={api.setMode} />
        </div>
        <Toolbar
          search={q} onSearch={setQ} placeholder="Search SO No, customer or item" rowCount={shown.length} columns={columns} api={api}
          onExport={doExport} exportCount={tickedRows.length} canExport={can("operation", "a_export")}
        />
        {orders.error && !orders.data ? (
          <LoadError message={orders.error} onRetry={orders.reload} />
        ) : !orders.data ? (
          <Loading />
        ) : api.prefs.mode === "cards" ? (
          <CardsView cards={cards} picked={picked} onPick={setPicked} empty={empty} footer={footer ?? <CardsCount>{count(shown.length, "sales order")}</CardsCount>} />
        ) : (
          <ListTable<Order>
            columns={columns} rows={shown} rowKey={(o) => o.docNo} api={api}
            openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
            expanded={(o) => <OrderExpansion order={o} onOpenFull={() => openFull(o)} />}
            picked={picked} onPick={setPicked} empty={empty}
            footer={footer ?? <ListCount>{count(shown.length, "sales order")}</ListCount>}
          />
        )}
      </PageBody>
    </>
  );
}

const pickupFg = (state: Order["pickupState"]): string => {
  const b = orderPickupBadge(state);
  return b.outline ? "rgb(var(--hz-ink-muted))" : b.tone === "warning" ? "rgb(var(--hz-warning-text))" : b.tone === "success" ? "rgb(var(--hz-synced))" : "rgb(var(--hz-primary-ink))";
};

export function orderFacts(o: Order): FactSpec[] {
  return [
    { label: "SO Date", value: fmtDay(o.soDate) || "No date", muted: !o.soDate },
    { label: "Sale Type", value: saleTypeLabel(o.saleType) },
    { label: "Processing Date", value: fmtDay(o.processingDate) || "Not processed yet", muted: !o.processingDate },
    { label: "Delivery Date", value: fmtDay(o.deliveryDate) || "Not set yet", muted: !o.deliveryDate },
    { label: "Delivery Address", value: addressText(o) || "No address on the order", muted: !o.addressLines.length },
  ];
}

/** An order opened in its row: its facts, the supplier's items on it, and its history. */
function OrderExpansion({ order: o, onOpenFull }: { order: Order; onOpenFull: () => void }) {
  const detail = useLoad(`order:${o.docNo}`, () => supplierApi.order(o.docNo));
  const trail = detail.data?.order.trail ?? null;
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1fr)" }}>
      <div className="min-w-0 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge b={stageBadge(o.status)} size="md" />
          <Badge b={orderPickupBadge(o.pickupState)} size="md" />
        </div>
        <Facts facts={orderFacts(o)} />
        <OpenFull onClick={onOpenFull} className="mt-[14px]" />
      </div>
      <div className="min-w-0 border-l border-border-subtle px-5 py-4">
        <h3 className="m-0 mb-1.5 flex justify-between text-[12px] font-semibold text-ink-muted">
          <span>Your items</span>
          <span>{count(o.lineCount, "line")} · {count(o.unitCount, "unit")}</span>
        </h3>
        <div className="-mr-2 max-h-[200px] overflow-y-auto pr-2">
          {o.lines.map((l, i) => {
            const pk = orderPickupBadge(l.pickup.state);
            return (
              <div key={l.soItemId} className="grid items-center gap-x-3 py-2" style={{ gridTemplateColumns: "minmax(0,1fr) auto", borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                <div className="min-w-0 truncate text-[13px] font-semibold text-ink">{l.description}{l.modelName ? ` · ${l.modelName}` : ""}</div>
                <div className="whitespace-nowrap text-right text-[13px] font-bold text-ink">{l.qty} <span className="text-[11px] font-semibold text-ink-muted">{l.uom}</span></div>
                <div className="mt-0.5 min-w-0 truncate text-[12px] text-ink-muted"><span className="font-docno">{l.itemCode}</span> · {l.spec || "Standard"}</div>
                <div className="mt-0.5 whitespace-nowrap text-right text-[11px] font-semibold" style={{ color: pickupFg(l.pickup.state) }}>{pk.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="min-w-0 border-l border-border-subtle px-5 py-4">
        <h3 className="m-0 mb-2.5 text-[12px] font-semibold text-ink-muted">History</h3>
        <div className="-mr-2 max-h-[200px] overflow-y-auto pr-2">
          {trail === null ? (
            <div className="text-[12.5px] text-ink-muted">{detail.error ?? "Loading"}</div>
          ) : (
            trail.map((t, i) => {
              const w = trailWords(t);
              const last = i === trail.length - 1;
              return (
                <div key={`${t.code}-${t.at}-${i}`} className="relative flex gap-2.5" style={{ paddingBottom: last ? 0 : 14 }}>
                  {!last && <span className="absolute bottom-[-2px] left-1 top-4 w-px bg-border" />}
                  <span className="relative mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: last ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border-strong))" }} />
                  <div>
                    <div className="text-[13px] font-semibold text-ink">{w.label}</div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">{w.at}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── One order's full page ───────────────────────────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = { CONFIRMED: 0, ON_HOLD: 1, IN_PRODUCTION: 1, READY_TO_SHIP: 3, SHIPPED: 4, DELIVERED: 4, INVOICED: 4, CLOSED: 4 };
const PICKUP_RANK: Record<string, number> = { none: 0, requested: 2, accepted: 2, part_collected: 2, collected: 3 };

function steps(o: Order) {
  const at = Math.max(RANK[o.status] ?? 0, PICKUP_RANK[o.pickupState] ?? 0);
  const delivered = ["DELIVERED", "INVOICED", "CLOSED"].includes(o.status);
  const list: Array<[string, string]> = [
    ["Submitted", fmtDay(o.soDate) || "No date"],
    ["In Production", fmtDay(o.processingDate) || "Not processed yet"],
    ["Pickup", o.pickupState === "none" ? "Not requested" : orderPickupBadge(o.pickupState).label],
    ["Collected", o.pickupState === "collected" ? "By Carres" : "Not yet"],
    ["Delivered", delivered ? fmtDay(o.deliveryDate) || "Delivered" : o.deliveryDate ? `Planned ${fmtDay(o.deliveryDate)}` : "Date not set"],
  ];
  return list.map(([label, when], i) => ({ n: i + 1, label, when, done: i < at, cur: i === at, barOn: i < at, last: i === 4 }));
}

/** The engine's own relationship map, given this order's five tiles. */
function OrderMap({ open, onClose, nodes }: { open: boolean; onClose: () => void; nodes: MapNode[] }) {
  const navigate = useNavigate();
  const chain: ChainNode[] = nodes.map((n) => ({
    type: n.type,
    doc: n.doc,
    // The stage in Carres's words; a day in the one date format; anything else is already words.
    meta: n.type === "Sales Order" ? stageBadge(n.meta).label : /^\d{4}-\d{2}-\d{2}$/.test(n.meta) ? fmtDay(n.meta) : n.meta,
    state: n.state,
    actionable: n.type === "Pickup Request" && !!n.requestId,
  }));
  return (
    <DocumentRelationshipMapModal
      open={open}
      onClose={onClose}
      nodes={chain}
      rowLabels={{ primary: "Order to pickup", secondary: "After collection" }}
      onNodeClick={(node) => {
        const id = nodes.find((n) => n.type === node.type)?.requestId;
        if (node.type === "Pickup Request" && id) navigate(`${BASE}/pickups?open=${encodeURIComponent(id)}&tab=all`);
      }}
    />
  );
}

export function OrderPage() {
  const { docNo = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { me, can } = useSupplierSession();
  const list = useOrders();
  const pickups = usePickups(can("operation", "v_pickups"));
  const one = useLoad(`order:${docNo}`, () => supplierApi.order(docNo));
  const [mapOpen, setMapOpen] = useState(false);
  const o: OrderDetail | null = one.data?.order ?? null;

  const all = list.data ?? [];
  const idx = all.findIndex((x) => x.docNo === docNo);
  const go = (i: number) => {
    if (!all.length) return;
    const next = all[(i + all.length) % all.length]!;
    navigate(`${BASE}/orders/${encodeURIComponent(next.docNo)}`, { replace: true });
  };

  // The requests that carry this order: from the pickup list when the person may read it, else from the lines.
  const reqs: Pickup[] = (pickups.data ?? []).filter((p) => p.soDocNos.includes(docNo));
  const lineReqs = o ? [...new Map(o.lines.filter((l) => l.pickup.requestNo).map((l) => [l.pickup.requestId ?? l.pickup.requestNo!, l])).values()] : [];

  const back = () => navigate(`${BASE}/orders`);
  const header = (
    <PageBar
      eyebrow="Sales Order"
      title={docNo}
      mono
      back={back}
      backTip="Back to Sales Orders"
      badges={o && (
        <div className="flex gap-1.5">
          <Badge b={stageBadge(o.status)} />
          <Badge b={orderPickupBadge(o.pickupState)} />
        </div>
      )}
      right={(
        <>
          <Stepper pos={idx >= 0 ? `${idx + 1} of ${all.length}` : all.length ? `– of ${all.length}` : ""} onPrev={() => go(idx - 1)} onNext={() => go(idx + 1)} what="order" />
          <BarButton icon={<Share2 size={14} aria-hidden="true" />} onClick={() => setMapOpen(true)} disabled={!o}>Relationship map</BarButton>
        </>
      )}
    />
  );

  if (one.error && !o) return <>{header}<PageBody scroll riseKey={docNo}><LoadError message={one.error} onRetry={one.reload} /></PageBody></>;
  if (!o) return <>{header}<PageBody scroll riseKey={docNo}><Loading /></PageBody></>;

  const notes = reqs.filter((p) => p.note && p.note.trim());
  const docs: Array<{ key: string; name: string; meta: string; get: () => Promise<void> | void }> = [
    { key: "so", name: `${o.docNo}.pdf`, meta: "Sales Order · your items only", get: () => orderPdf(o, me.supplier.name) },
    ...reqs.map((p) => ({ key: `pr-${p.id}`, name: `${p.requestNo}.pdf`, meta: "Pickup Request", get: () => pickupPdf(p, me.supplier.name) })),
    ...reqs.filter((p) => p.deliveryOrder).map((p) => ({ key: `do-${p.id}`, name: p.deliveryOrder!.name, meta: `Delivery Order · ${p.requestNo}`, get: () => supplierApi.deliveryOrder(p.id, p.deliveryOrder!.name) })),
  ];
  const fetchDoc = async (d: (typeof docs)[number]) => {
    try { await d.get(); } catch (e) { toast(e instanceof Error ? e.message : "The file could not be made.", "red"); }
  };

  return (
    <>
      {header}
      <PageBody scroll riseKey={docNo}>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-baseline gap-3 whitespace-nowrap">
              <div className="text-[22px] font-bold tracking-[-0.01em] text-ink">{o.customerName || "No name"}</div>
              <div className="text-[13px] text-ink-muted">{saleTypeLabel(o.saleType)} · {fmtDay(o.soDate) || "No date"}</div>
            </div>

            <section className="rounded-lg border border-border bg-surface px-5 py-[18px] shadow-stone">
              <div className="grid grid-cols-5">
                {steps(o).map((p) => (
                  <div key={p.n} className="relative pr-2">
                    <div className="flex items-center">
                      <span
                        className="relative z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 text-[10.5px] font-bold"
                        style={{
                          borderColor: p.done || p.cur ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border-strong))",
                          background: p.done ? "rgb(var(--hz-primary))" : "#fff",
                          color: p.done ? "#fff" : p.cur ? "rgb(var(--hz-primary))" : "#9AA0A8",
                        }}
                      >
                        {p.n}
                      </span>
                      <span className="ml-2 h-0.5 flex-1 rounded-sm" style={{ background: p.barOn ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border))", opacity: p.last ? 0 : 1 }} />
                    </div>
                    <div className="mt-2.5 whitespace-nowrap text-[12.5px] font-bold" style={{ color: p.done || p.cur ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>{p.label}</div>
                    <div className="mt-0.5 whitespace-nowrap text-[11.5px] text-ink-muted">{p.when}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-stone">
              <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="m-0 text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Your items</h2>
                <span className="text-[12px] text-ink-secondary">{count(o.lineCount, "line")} · {count(o.unitCount, "unit")}</span>
              </header>
              <table className="w-full border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="text-left text-[11.5px] font-semibold text-ink-secondary">
                    <th className="w-10 border-b border-border bg-surface-2 py-[9px] pl-4 pr-0 font-semibold">#</th>
                    <th className="border-b border-border bg-surface-2 px-3 py-[9px] font-semibold">Item</th>
                    <th className="w-[120px] border-b border-border bg-surface-2 px-3 py-[9px] font-semibold">Item Code</th>
                    <th className="w-[150px] border-b border-border bg-surface-2 px-3 py-[9px] font-semibold">Specification</th>
                    <th className="w-[70px] border-b border-border bg-surface-2 px-3 py-[9px] text-right font-semibold">Qty</th>
                    <th className="w-[150px] border-b border-border bg-surface-2 py-[9px] pl-3 pr-4 font-semibold">Pickup</th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines.map((l, i) => (
                    <tr key={l.soItemId}>
                      <td className="border-b border-border-subtle py-2.5 pl-4 pr-0 text-[12.5px] text-ink-muted">{i + 1}</td>
                      <td className="truncate border-b border-border-subtle px-3 py-2.5 text-[13px] font-semibold text-ink">{l.description}{l.modelName ? ` · ${l.modelName}` : ""}</td>
                      <td className="truncate border-b border-border-subtle px-3 py-2.5 font-docno text-[12px] text-ink-secondary">{l.itemCode}</td>
                      <td className="truncate border-b border-border-subtle px-3 py-2.5 text-[13px]" style={{ color: l.spec ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>{l.spec || "Standard"}</td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-3 py-2.5 text-right text-[13px] font-bold text-ink">{l.qty} <span className="text-[10.5px] font-semibold text-ink-muted">{l.uom}</span></td>
                      <td className="whitespace-nowrap border-b border-border-subtle py-2.5 pl-3 pr-4"><Badge b={orderPickupBadge(l.pickup.state)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <Section title="History">
              <ol className="m-0 list-none p-4">
                {o.trail.map((t, i) => {
                  const w = trailWords(t);
                  const last = i === o.trail.length - 1;
                  return (
                    <li key={`${t.code}-${t.at}-${i}`} className="relative flex gap-3" style={{ paddingBottom: last ? 0 : 14 }}>
                      {!last && <span className="absolute left-[5px] top-3 h-full w-px bg-border" />}
                      <span
                        className="relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2"
                        style={{ borderColor: last ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border-strong))", background: last ? "rgb(var(--hz-primary))" : "#fff" }}
                      />
                      <div className="flex flex-1 justify-between gap-3">
                        <span className="text-[13px] font-semibold text-ink">{w.label}</span>
                        <span className="whitespace-nowrap text-[12px] text-ink-muted">{w.at}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section title="Note from Carres">
              <div className="px-4 py-[14px] text-[13px] leading-[1.6]" style={{ color: notes.length ? "rgb(var(--hz-ink))" : "rgb(var(--hz-ink-muted))" }}>
                {notes.length
                  ? notes.map((p) => <div key={p.id}>{notes.length > 1 && <span className="font-docno text-[12px] font-semibold text-primary-ink">{p.requestNo}: </span>}{p.note}</div>)
                  : "No note on this order"}
              </div>
            </Section>
          </div>

          <div className="flex flex-col gap-4">
            <Section title="Order">
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-[14px] p-4">
                {orderFacts(o).map((f) => (
                  <div key={f.label} className="min-w-0" style={{ gridColumn: f.label === "Delivery Address" ? "span 2" : "auto" }}>
                    <dt className="text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{f.label}</dt>
                    <dd className="m-0 mt-1 text-[13px] leading-[1.45]" style={{ color: f.muted ? "rgb(var(--hz-ink-muted))" : "rgb(var(--hz-ink))" }}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section title="Pickup">
              {reqs.length > 0 ? (
                reqs.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`${BASE}/pickups?open=${encodeURIComponent(p.id)}&tab=all`)}
                    className="flex w-full items-center justify-between gap-3 border-0 bg-surface px-4 py-3 text-left transition-colors duration-[160ms] hover:bg-primary-soft/35"
                    style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}
                  >
                    <div className="min-w-0">
                      <div className="font-docno text-[12.5px] font-semibold text-primary-ink">{p.requestNo}</div>
                      <div className="mt-0.5 text-[12px] text-ink-secondary">Carres collects on {collectOn(p)}</div>
                    </div>
                    <Badge b={pickupBadge(p)} className="shrink-0" />
                  </button>
                ))
              ) : lineReqs.length > 0 ? (
                lineReqs.map((l, i) => (
                  <div key={l.pickup.requestNo} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                    <div className="min-w-0">
                      <div className="font-docno text-[12.5px] font-semibold text-primary-ink">{l.pickup.requestNo}</div>
                      <div className="mt-0.5 text-[12px] text-ink-secondary">Carres collects on {fmtDay(l.pickup.expectedDate)}</div>
                    </div>
                    <Badge b={orderPickupBadge(l.pickup.state)} className="shrink-0" />
                  </div>
                ))
              ) : (
                <div className="px-4 py-[14px] text-[13px] text-ink-muted">No pickup requested yet</div>
              )}
            </Section>

            <Section title="Documents">
              {docs.map((d, i) => (
                <div key={d.key} className="flex items-center gap-3 px-4 py-[11px]" style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                  <PdfMark />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{d.name}</div>
                    <div className="mt-px text-[11.5px] text-ink-muted">{d.meta}</div>
                  </div>
                  <button
                    type="button"
                    title="Download"
                    aria-label={`Download ${d.name}`}
                    onClick={() => void fetchDoc(d)}
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary hover:border-primary hover:text-primary"
                  >
                    <Download size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </Section>
          </div>
        </div>
      </PageBody>
      <OrderMap open={mapOpen} onClose={() => setMapOpen(false)} nodes={o.map} />
    </>
  );
}
