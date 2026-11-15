// Carres only (not part of Houzs's code): the Sales Orders a supplier is shared.
//
// The staff Sales Orders page in the supplier's words: the same list with a quick view, "Open full page", the stage
// history and the relationship map. It shows only what Carres shares (Settings › Supplier Access): the supplier's own
// lines of each order, the customer's name and delivery address, and the dates. No price is ever on these pages.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Search, Share2 } from "lucide-react";
import { Button } from "../../components/Button";
import { TabStrip } from "../../components/TabStrip";
import { DocumentRelationshipMapModal, type ChainNode } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { supplierApi, type MapNode, type Order, type OrderDetail, type OrderView, type TrailEntry } from "./api";
import {
  Card, Drawer, Fact, LineList, LoadError, Loading, Missing, OrderPickupBadge, PageTitle, Pager, SoStatusBadge, Table,
  count, downloadCsv, fmtDay, fmtStamp, soStatusLabel, useLoad, type Column, type SortChoice,
} from "./ui";

const PAGE_SIZE = 50;

const itemsSummary = (o: Order): string => {
  const first = o.lines.at(0);
  if (!first) return "";
  const name = first.description || first.itemCode;
  return o.lines.length > 1 ? `${name} +${o.lines.length - 1} more` : name;
};

const COLUMNS: Column<Order>[] = [
  { key: "docNo", header: "SO No", serverSort: "docNo", cell: (o) => <span className="font-mono text-[12.5px] font-bold text-primary-ink">{o.docNo}</span>, csv: (o) => o.docNo },
  { key: "soDate", header: "SO Date", serverSort: "date", cell: (o) => fmtDay(o.soDate) || <Missing>No date</Missing>, className: "whitespace-nowrap", csv: (o) => o.soDate },
  { key: "customer", header: "Customer", serverSort: "customer", cell: (o) => o.customerName, csv: (o) => o.customerName },
  {
    key: "items", header: "Items", wrap: true,
    cell: (o) => (
      <div className="min-w-[180px]">
        <div>{itemsSummary(o)}</div>
        {o.lines[0]?.spec && <div className="mt-0.5 text-[11px] text-ink-muted">{o.lines[0].spec}</div>}
      </div>
    ),
    csv: (o) => o.lines.map((l) => `${l.qty} ${l.uom} ${l.description || l.itemCode}${l.spec ? ` (${l.spec})` : ""}`).join("; "),
  },
  { key: "units", header: "Qty", align: "right", serverSort: "units", cell: (o) => o.unitCount, csv: (o) => o.unitCount },
  { key: "processing", header: "Processing Date", serverSort: "processing", cell: (o) => fmtDay(o.processingDate) || <Missing>Not processed</Missing>, className: "whitespace-nowrap", csv: (o) => o.processingDate },
  { key: "delivery", header: "Delivery Date", serverSort: "delivery", cell: (o) => fmtDay(o.deliveryDate) || <Missing>Not set</Missing>, className: "whitespace-nowrap", csv: (o) => o.deliveryDate },
  { key: "status", header: "Stage", serverSort: "status", cell: (o) => <SoStatusBadge status={o.status} />, csv: (o) => soStatusLabel(o.status) },
  { key: "pickup", header: "Pickup", cell: (o) => <OrderPickupBadge state={o.pickupState} />, csv: (o) => o.pickupState.replace("_", " ") },
  { key: "address", header: "Delivery Address", cell: () => null, className: "hidden", csv: (o) => o.addressLines.join(", ") },
];
/** The address rides on the CSV only; on screen it is in the quick view. */
const SCREEN_COLUMNS = COLUMNS.filter((c) => c.key !== "address");

const TRAIL_WORDS: Record<string, string> = {
  RECEIVED: "Order received",
  PICKUP_REQUESTED: "Pickup requested",
  PICKUP_ACCEPTED: "Pickup accepted",
  PICKUP_COLLECTED: "Collected by Carres",
  PICKUP_CANCELLED: "Pickup request cancelled",
};
const trailLabel = (t: TrailEntry): string => (t.kind === "stage" ? soStatusLabel(t.code) : TRAIL_WORDS[t.code] ?? t.code);

function Trail({ entries }: { entries: TrailEntry[] }) {
  if (!entries.length) return <div className="px-4 py-6 text-[12.5px] text-ink-muted">No history yet.</div>;
  return (
    <ol className="px-4 py-4">
      {entries.map((t, i) => (
        <li key={`${t.at}-${t.code}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
          {i < entries.length - 1 && <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-border" />}
          <span aria-hidden className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${i === entries.length - 1 ? "border-primary bg-primary" : "border-border-strong bg-surface"}`} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">
              {trailLabel(t)}
              {t.code === "PICKUP_REQUESTED" && t.detail ? <span className="font-normal text-ink-secondary"> for {fmtDay(t.detail)}</span> : null}
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-muted">
              {fmtStamp(t.at)}{t.ref ? <> · <span className="font-mono">{t.ref}</span></> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The engine's own relationship map, given this order's five tiles. */
function OrderMap({ open, onClose, nodes }: { open: boolean; onClose: () => void; nodes: MapNode[] }) {
  const navigate = useNavigate();
  const chain: ChainNode[] = nodes.map((n) => ({
    type: n.type,
    doc: n.doc,
    // The stage in Carres's words; a day in the one date format; anything else is already words.
    meta: n.type === "Sales Order" ? soStatusLabel(n.meta) : /^\d{4}-\d{2}-\d{2}$/.test(n.meta) ? fmtDay(n.meta) : n.meta,
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
        if (node.type === "Pickup Request" && id) navigate(`/supplier/pickups/${id}`);
      }}
    />
  );
}

function OrderFacts({ order }: { order: Order }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-border bg-surface-2 px-4 py-4">
      <Fact label="SO Date">{fmtDay(order.soDate) || <Missing>No date</Missing>}</Fact>
      <Fact label="Sale Type">{order.saleType === "subscription" ? "Subscription" : "Outright"}</Fact>
      <Fact label="Processing Date">{fmtDay(order.processingDate) || <Missing>Not processed yet</Missing>}</Fact>
      <Fact label="Delivery Date">{fmtDay(order.deliveryDate) || <Missing>Not set yet</Missing>}</Fact>
      <Fact label="Delivery Address" wide>
        {order.addressLines.length ? order.addressLines.map((l) => <div key={l}>{l}</div>) : <Missing>No address on the order</Missing>}
      </Fact>
    </dl>
  );
}

const orderLines = (order: Order) => order.lines.map((l) => ({
  key: l.soItemId, itemCode: l.itemCode, description: l.description, spec: l.spec, modelName: l.modelName, uom: l.uom, qty: l.qty,
  right: <OrderPickupBadge state={l.pickup.state} />,
  sub: l.pickup.requestNo ? (
    <Link to={`/supplier/pickups/${l.pickup.requestId}`} className="mt-1 inline-block font-mono text-[11px] font-semibold text-primary hover:underline">
      {l.pickup.requestNo}{l.pickup.expectedDate ? ` · ${fmtDay(l.pickup.expectedDate)}` : ""}
    </Link>
  ) : undefined,
}));

function QuickView({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [mapOpen, setMapOpen] = useState(false);
  const detail = useLoad<OrderDetail | null>(order ? `order:${order.docNo}` : "none", () => (order ? supplierApi.order(order.docNo).then((r) => r.order) : Promise.resolve(null)));
  useEffect(() => { if (!order) setMapOpen(false); }, [order]);
  return (
    <>
      <Drawer
        open={!!order}
        onClose={onClose}
        title={order?.docNo ?? ""}
        subtitle="Sales Order"
        headerRight={order && (
          <button
            type="button"
            onClick={() => navigate(`/supplier/orders/${encodeURIComponent(order.docNo)}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-bright/40 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-bright hover:bg-accent-bright/10"
          >
            Open full page <ExternalLink size={12} />
          </button>
        )}
        footer={order && (
          <Button variant="secondary" icon={<Share2 size={14} />} onClick={() => setMapOpen(true)} disabled={!detail.data}>Relationship map</Button>
        )}
      >
        {order && (
          <>
            <div className="text-[19px] font-bold text-ink">{order.customerName || <Missing>No customer name</Missing>}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SoStatusBadge status={order.status} />
              <OrderPickupBadge state={order.pickupState} />
            </div>
            <div className="mt-5"><OrderFacts order={order} /></div>
            <Card title={`Your items · ${count(order.unitCount, "unit")}`} className="mt-5"><LineList lines={orderLines(order)} /></Card>
            <Card title="History" className="mt-5">
              {detail.error ? <div className="p-4"><LoadError message={detail.error} onRetry={detail.reload} /></div>
                : detail.data ? <Trail entries={detail.data.trail} />
                  : <div className="px-4 py-6 text-[12.5px] text-ink-muted">Loading</div>}
            </Card>
          </>
        )}
      </Drawer>
      {detail.data && <OrderMap open={mapOpen} onClose={() => setMapOpen(false)} nodes={detail.data.map} />}
    </>
  );
}

export function OrdersPage() {
  const [view, setView] = useState<OrderView>("all");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortChoice>({ key: "date", dir: "desc" });
  const [selected, setSelected] = useState<Order | null>(null);
  const [exporting, setExporting] = useState(false);

  // The search runs a moment after typing stops, and always from the first page.
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  const key = `orders:${view}:${q}:${page}:${sort.key}:${sort.dir}`;
  const list = useLoad(key, () => supplierApi.orders({ view, q, page, pageSize: PAGE_SIZE, sort: sort.key, dir: sort.dir }));
  const counts = list.data?.counts;

  const tabs = useMemo(() => [
    { value: "all" as const, label: "All", count: counts?.all },
    { value: "incoming" as const, label: "Incoming", count: counts?.incoming },
    { value: "processing" as const, label: "In production", count: counts?.processing },
    { value: "delivered" as const, label: "Delivered", count: counts?.delivered },
  ], [counts]);

  /** Every row of this view and search, a page at a time, into one file. */
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Order[] = [];
      for (let p = 1; p <= 50; p++) {
        const chunk = await supplierApi.orders({ view, q, page: p, pageSize: 200, sort: sort.key, dir: sort.dir });
        rows.push(...chunk.rows);
        if (rows.length >= chunk.total || chunk.rows.length === 0) break;
      }
      downloadCsv(`sales-orders-${view}.csv`, COLUMNS, rows);
    } catch {
      /* the list on screen already shows a load problem; nothing is downloaded */
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Sales Orders"
        description="Carres sales orders that carry your items. Incoming orders are not processed yet: use them to plan stock. Click a row for the quick view."
        actions={<Button variant="secondary" icon={<Download size={14} />} onClick={exportAll} disabled={exporting || !list.data?.total}>{exporting ? "Preparing" : "Download CSV"}</Button>}
      />
      <TabStrip value={view} onChange={(v) => { setView(v); setPage(1); }} options={tabs} />
      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search SO No, customer or item"
            aria-label="Search sales orders"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-[12.5px] text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        {list.loading && list.data && <span className="text-[11.5px] text-ink-muted">Updating</span>}
      </div>
      {list.error && <div className="mb-3"><LoadError message={list.error} onRetry={list.reload} /></div>}
      {!list.data && !list.error ? <Loading /> : list.data && (
        <>
          <Table
            columns={SCREEN_COLUMNS}
            rows={list.data.rows}
            rowKey={(o) => o.docNo}
            onRowClick={setSelected}
            selectedKey={selected?.docNo ?? null}
            sort={sort}
            onSortChange={(s) => { setSort(s); setPage(1); }}
            empty={q ? `No sales order matches "${q}".` : view === "incoming" ? "No incoming orders right now." : "No sales orders are shared with you yet."}
          />
          <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <QuickView order={selected} onClose={() => setSelected(null)} />
    </>
  );
}

export function OrderDetailPage() {
  const { docNo = "" } = useParams();
  const [mapOpen, setMapOpen] = useState(false);
  const detail = useLoad(`order:${docNo}`, () => supplierApi.order(docNo).then((r) => r.order));
  const order = detail.data;

  return (
    <>
      <Link to="/supplier/orders" className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft size={13} /> Sales Orders
      </Link>
      {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
      {!order && !detail.error && <Loading />}
      {order && (
        <>
          <PageTitle
            title={order.docNo}
            description={<span className="flex flex-wrap items-center gap-2"><SoStatusBadge status={order.status} /><OrderPickupBadge state={order.pickupState} /><span>{order.customerName}</span></span>}
            actions={<Button variant="secondary" icon={<Share2 size={14} />} onClick={() => setMapOpen(true)}>Relationship map</Button>}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card title={`Your items · ${count(order.lineCount, "line")} · ${count(order.unitCount, "unit")}`}>
                <LineList lines={orderLines(order)} />
              </Card>
              <Card title="History"><Trail entries={order.trail} /></Card>
            </div>
            <div className="space-y-4">
              <Card title="Order">
                <div className="p-4">
                  <div className="mb-4 text-[15px] font-bold text-ink">{order.customerName}</div>
                  <OrderFacts order={order} />
                </div>
              </Card>
            </div>
          </div>
          <OrderMap open={mapOpen} onClose={() => setMapOpen(false)} nodes={order.map} />
        </>
      )}
    </>
  );
}
