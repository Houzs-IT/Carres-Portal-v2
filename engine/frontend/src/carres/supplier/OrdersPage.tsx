// Carres only (not part of Houzs's code): the Sales Orders a supplier is shared.
//
// The staff Sales Orders page (pages/scm-v2/MfgSalesOrdersListV2), drawn with its own parts (owner, 16 Nov 2026: the
// supplier pages look exactly like it): the header, four figure cards, the stage pills, Table / Cards, the staff
// table with its search, Export, Wrap and Columns, the pager, and a row that opens the quick view beside the list.
// It shows only what Carres shares (Settings › Supplier Access): the supplier's own lines of each order, the
// customer's name and delivery address, and the dates. No price is ever on these pages.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Share2 } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type Column } from "../../components/DataTable";
import { FilterPills } from "../../components/FilterPills";
import { ListPager } from "../../components/ListPager";
import { StatCard } from "../../components/StatCard";
import { DocumentRelationshipMapModal, type ChainNode } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { downloadCSV, toCSV, type CSVColumn } from "../../lib/csv";
import { cn } from "../../lib/utils";
import { useDebouncedValue } from "../../vendor/scm/lib/hooks";
import { supplierApi, type MapNode, type Order, type OrderDetail, type OrderView, type TrailEntry } from "./api";
import { useSupplierSession } from "./SupplierApp";
import {
  Card, CardsGrid, Drawer, Fact, LineList, LoadError, Loading, Missing, OrderPickupBadge, PageHeader, SoStatusBadge, ViewToggle,
  count, fmtDay, fmtStamp, orderPickupLabel, soStatusLabel, useLoad, type ViewMode,
} from "./ui";

const PAGE_SIZES = [25, 50, 100];

const itemsSummary = (o: Order): string => {
  const first = o.lines.at(0);
  if (!first) return "";
  const name = first.description || first.itemCode;
  return o.lines.length > 1 ? `${name} +${o.lines.length - 1} more` : name;
};

/** Every line of the order, for the file: "2 UNIT Mattress Queen (183 x 190); ...". */
const itemsInFull = (o: Order): string =>
  o.lines.map((l) => `${l.qty} ${l.uom} ${l.description || l.itemCode}${l.spec ? ` (${l.spec})` : ""}`).join("; ");

/** The keys of the columns the server sorts are the server's own sort names (backend carres/supplier/orders.ts
 *  SORTS). Items, Pickup and the address sort the page on screen only. */
const COLUMNS: Column<Order>[] = [
  {
    key: "docNo", label: "SO No", alwaysVisible: true, getValue: (o) => o.docNo,
    render: (o) => <span className="font-docno text-[12.5px] font-semibold text-primary-ink">{o.docNo}</span>,
  },
  {
    key: "date", label: "SO Date", getValue: (o) => o.soDate, filterType: "date", dateValue: (o) => o.soDate, newestFirst: true,
    filterLabel: (v) => fmtDay(v) || v, render: (o) => fmtDay(o.soDate) || <Missing>No date</Missing>,
  },
  { key: "customer", label: "Customer", getValue: (o) => o.customerName, render: (o) => o.customerName || <Missing>No name</Missing> },
  {
    key: "items", label: "Items", getValue: itemsSummary, exportValue: itemsInFull, disableSort: true,
    render: (o) => (
      <div className="min-w-[180px] whitespace-normal">
        <div>{itemsSummary(o)}</div>
        {o.lines[0]?.spec && <div className="mt-0.5 text-[11px] text-ink-muted">{o.lines[0].spec}</div>}
      </div>
    ),
  },
  { key: "units", label: "Qty", align: "right", getValue: (o) => o.unitCount, filterType: "number", numberValue: (o) => o.unitCount, render: (o) => o.unitCount },
  {
    key: "processing", label: "Processing Date", getValue: (o) => o.processingDate, filterType: "date", dateValue: (o) => o.processingDate,
    filterLabel: (v) => fmtDay(v) || v, render: (o) => fmtDay(o.processingDate) || <Missing>Not processed</Missing>,
  },
  {
    key: "delivery", label: "Delivery Date", getValue: (o) => o.deliveryDate, filterType: "date", dateValue: (o) => o.deliveryDate,
    filterLabel: (v) => fmtDay(v) || v, render: (o) => fmtDay(o.deliveryDate) || <Missing>Not set</Missing>,
  },
  { key: "status", label: "Stage", getValue: (o) => soStatusLabel(o.status), render: (o) => <SoStatusBadge status={o.status} /> },
  { key: "pickup", label: "Pickup", getValue: (o) => orderPickupLabel(o.pickupState), disableSort: true, render: (o) => <OrderPickupBadge state={o.pickupState} /> },
  {
    // Off until a person turns it on in Columns; it is always in the quick view.
    key: "address", label: "Delivery Address", defaultHidden: true, disableSort: true, getValue: (o) => o.addressLines.join(", "),
    render: (o) => <span className="block min-w-[200px] whitespace-normal">{o.addressLines.join(", ")}</span>,
  },
];

/** One order as a card: the staff Sales Orders card, with the supplier's facts in place of the money. */
function OrderCard({ o }: { o: Order }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-docno text-[12.5px] font-semibold text-ink">{o.docNo}</span>
        <SoStatusBadge status={o.status} />
      </div>
      <div className="mt-2 truncate text-[15px] font-semibold text-ink">{o.customerName || <Missing>No name</Missing>}</div>
      <div className="mt-1 flex items-center gap-2">
        <OrderPickupBadge state={o.pickupState} />
        <span className="text-[11.5px] text-ink-muted">{fmtDay(o.soDate)}</span>
      </div>
      <div className="mt-2 truncate text-[12px] text-ink-secondary">{itemsSummary(o)}</div>
      <div className="mt-3.5 flex items-end justify-between border-t border-border-subtle pt-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Delivery Date</div>
          <div className="mt-0.5 truncate font-mono text-[12px] font-semibold text-ink-secondary">{fmtDay(o.deliveryDate) || "Not set"}</div>
        </div>
        <span className="font-mono text-[15px] font-bold text-ink">{o.unitCount} <span className="text-[10.5px] font-semibold text-ink-muted">{o.unitCount === 1 ? "UNIT" : "UNITS"}</span></span>
      </div>
    </>
  );
}

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
  const navigate = useNavigate();
  const { me } = useSupplierSession();
  const [view, setView] = useState<OrderView>("all");
  const [mode, setMode] = useState<ViewMode>("table");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [selected, setSelected] = useState<Order | null>(null);

  const key = `orders:${view}:${q}:${page}:${pageSize}:${sort.key}:${sort.dir}`;
  const list = useLoad(key, () => supplierApi.orders({ view, q, page, pageSize, sort: sort.key, dir: sort.dir }));
  // The figures stay on screen while the next page or search loads; they are only unknown before the first answer.
  const [counts, setCounts] = useState(list.data?.counts ?? null);
  useEffect(() => { if (list.data) setCounts(list.data.counts); }, [list.data]);
  const total = list.data?.total ?? 0;
  const pickups = me.badges.pickupsToAccept;

  const pills = useMemo(() => [
    { value: "all" as const, label: "All", count: counts?.all },
    { value: "incoming" as const, label: "Incoming", count: counts?.incoming },
    { value: "processing" as const, label: "In production", count: counts?.processing },
    { value: "delivered" as const, label: "Delivered", count: counts?.delivered },
  ], [counts]);

  const chooseView = (v: OrderView) => { setView(v); setPage(1); };

  // The phone's own search box (the table's box is on the computer layout only), asked once typing stops.
  const [typed, setTyped] = useState("");
  const settled = useDebouncedValue(typed, 300);
  const firstSettle = useRef(true);
  useEffect(() => {
    if (firstSettle.current) { firstSettle.current = false; return; }
    setQ(settled.trim());
    setPage(1);
  }, [settled]);

  /** Export: every order of this view and search, a page at a time, with the columns showing. The file is written by
   *  the staff table's own CSV writer (lib/csv), which keeps a cell that starts like a formula as text. */
  const [exporting, setExporting] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const exportAll = async (columns: CSVColumn<Order>[]) => {
    if (exporting) return;
    setExporting(true);
    setExportProblem(null);
    const rows: Order[] = [];
    try {
      for (let p = 1; p <= 50; p++) {
        const chunk = await supplierApi.orders({ view, q, page: p, pageSize: 200, sort: sort.key, dir: sort.dir });
        rows.push(...chunk.rows);
        if (rows.length >= chunk.total || chunk.rows.length === 0) break;
      }
      downloadCSV(`sales-orders-${view}.csv`, toCSV(rows, columns));
    } catch (e) {
      // Nothing is downloaded: half a file would look like every order.
      setExportProblem(e instanceof Error ? e.message : "The file could not be made. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const pager = list.data && (
    <ListPager
      page={list.data.page - 1}
      pageSize={list.data.pageSize}
      total={list.data.total}
      perPageOptions={PAGE_SIZES}
      onPageChange={(p) => setPage(p + 1)}
      onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
    />
  );
  const empty = q ? `No sales order matches "${q}".` : view === "incoming" ? "No incoming orders right now." : "No sales orders are shared with you yet.";

  return (
    // While the quick view is open the list makes room for it beside it, as the staff list does.
    <div className={cn("transition-[padding] duration-200", selected && "md:pr-[540px]")}>
      <PageHeader
        eyebrow="Warehouse and Operation"
        title="Sales Orders"
        description="Carres sales orders that carry your items. Incoming orders are not processed yet: use them to plan stock. Click any row for the quick view."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Orders" value={counts?.all.toLocaleString("en-MY")} subtitle="Shared with you" rail="bg-primary" active
          pending={!counts && !list.error} failed={!counts && !!list.error} onRetry={list.reload}
        />
        <StatCard
          label="Incoming" value={counts?.incoming.toLocaleString("en-MY")} subtitle="Not processed yet" rail="bg-accent"
          pending={!counts && !list.error} failed={!counts && !!list.error} onRetry={list.reload}
        />
        <StatCard
          label="In Production" value={counts?.processing.toLocaleString("en-MY")} subtitle="Processed, not collected" rail="bg-warning-text"
          pending={!counts && !list.error} failed={!counts && !!list.error} onRetry={list.reload}
        />
        <StatCard
          label="Pickups to Accept" value={pickups.toLocaleString("en-MY")} subtitle={pickups ? "Waiting for you" : "Nothing waiting"}
          tone={pickups ? "warning" : "default"} rail={pickups ? "bg-err" : "bg-synced"} onClick={() => navigate("/supplier/pickups")}
        />
      </div>

      {/* A phone has the search box above the pills, as the staff list on a phone. */}
      <div className="mb-3 md:hidden">
        <input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Search SO No, customer or item"
          aria-label="Search sales orders"
          className="h-10 w-full rounded-lg border border-border bg-surface px-3.5 text-[16px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterPills options={pills} value={view} onChange={chooseView} />
        <div className="flex-1" />
        <div className="hidden md:block"><ViewToggle value={mode} onChange={setMode} /></div>
      </div>

      {list.error && !list.data && <div className="mb-3"><LoadError message={list.error} onRetry={list.reload} /></div>}
      {exportProblem && <div role="alert" className="mb-3 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">The file was not made. {exportProblem}</div>}

      {/* A phone always has the cards; on a computer Table / Cards decides (as the staff list). */}
      <div className="md:hidden">
        {list.data ? (
          <CardsGrid rows={list.data.rows} rowKey={(o) => o.docNo} onOpen={setSelected} empty={empty} render={(o) => <OrderCard o={o} />} />
        ) : !list.error && <Loading />}
        {pager}
      </div>

      <div className="hidden md:block">
      {mode === "table" ? (
        <>
          <DataTable<Order>
            tableId="carres-supplier-orders"
            documentLabel="Sales Orders"
            exportName="sales-orders"
            columns={COLUMNS}
            rows={list.data?.rows ?? null}
            loading={list.loading && !list.data}
            error={list.error && list.data ? list.error : null}
            getRowKey={(o) => o.docNo}
            getRowClassName={(o) => (selected?.docNo === o.docNo ? "bg-primary-soft/40" : undefined)}
            onRowClick={setSelected}
            serverSort
            onSortChange={(s) => { setSort(s ?? { key: "date", dir: "desc" }); setPage(1); }}
            onExport={(columns) => void exportAll(columns)}
            exportLabel={exporting ? "Exporting…" : "Export"}
            emptyLabel={empty}
            search={{
              value: q,
              onChange: (v) => { setQ(v.trim()); setPage(1); },
              placeholder: "Search SO No, customer or item",
              scope: "server",
              searching: list.loading && !!list.data,
              countPending: list.loading,
              searchingLabel: "Searching…",
              totalRecords: total,
            }}
          />
          {pager}
        </>
      ) : (
        <>
          {list.data ? (
            <CardsGrid rows={list.data.rows} rowKey={(o) => o.docNo} onOpen={setSelected} empty={empty} render={(o) => <OrderCard o={o} />} />
          ) : !list.error && <Loading />}
          {pager}
        </>
      )}
      </div>
      <QuickView order={selected} onClose={() => setSelected(null)} />
    </div>
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
          <PageHeader
            eyebrow="Sales Order"
            title={<span className="font-docno">{order.docNo}</span>}
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
