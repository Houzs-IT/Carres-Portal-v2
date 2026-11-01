// design-standard: not-a-list-page — a destination with module views; each view is the kit DataGrid inside the Warehouse shell, like Inventory.
/**
 * WAREHOUSES — the Houzs-way warehouse pages for office staff.
 *
 * Weisiang's decision (Mr Lim, WhatsApp 2026-10-22, relayed by YH 2026-10-23):
 * "just clear Carress rules and Implement Houzs inside". Jess was not part of
 * this decision. Five Houzs pages become views of one destination:
 *
 *   Warehouses      every Site (Warehouse Settings' own `warehouses` rows)
 *   Inventory       Units per item at the chosen Site (Houzs: qty per SKU)
 *   Racks and Bins  Bins per Site with a colour fill overview (0718)
 *   Loading List    what is still to load, per item per DO
 *   Stock Card      one item's in/out lines from the Unit lineage
 *
 * Carres keeps its per-Unit model: every number here is a COUNT of Units read
 * from the one register. No second ledger, no cost (Finance owns valuation).
 * Follows Houzs frontend/src/pages/scm-v2/Inventory.tsx:4-11 (Balances, Movements,
 * Warehouses tabs) per Weisiang's ruling (2026-10-22): clear Carres rules, implement Houzs.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  loadingListRows,
  warehouseOutboundCards,
  type DeliveryWarehouseScheduleEvent,
  type LoadingListRow,
  type StockCardLine,
} from "@carres/shared";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import { useDeliveryWarehouseSchedule, useOperationWarehouse } from "@/lib/queries";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import DocumentTable from "@/components/kit/DocumentTable";
import { FieldError } from "@/components/kit/FieldFrame";
import Input from "@/components/kit/Input";
import Modal from "@/components/kit/Modal";
import Textarea from "@/components/kit/Textarea";
import Select from "@/components/kit/Select";
import Tabs from "@/components/kit/Tabs";
import Loading from "@/components/kit/Loading";
import ModuleHeader from "./components/ModuleHeader";
import { DetailSection, KpiRow } from "./houzs-list-bits";
import { MAX_SEED_BINS, floorPlan, seedBins } from "./warehouse-rack-tools";
import CouldNotLoad from "./components/CouldNotLoad";

/** COPY-STANDARD "Warehouses — Houzs-way views (Weisiang 2026-10-22)". */
const W = {
  page: "Warehouses",
  sites: "Warehouses",
  inventory: "Inventory",
  bins: "Racks and Bins",
  loading: "Loading List",
  stockCard: "Stock Card",
  site: "Site",
  address: "Address",
  item: "Item",
  units: "Units",
  available: "Available",
  reserved: "Reserved",
  items: "Items",
  rack: "Rack",
  bin: "Bin",
  addBin: "Add bin",
  unitId: "Unit ID",
  putInBin: "Put in bin",
  takeOut: "Take out of bin",
  empty: "Empty",
  holding: "Holding goods",
  holdingReserved: "Holding reserved goods",
  doNo: "DO No",
  soNo: "SO No",
  date: "Pickup date",
  toLoad: "To load",
  qty: "Qty",
  loaded: "Loaded",
  logistics: "Logistics",
  when: "Date",
  what: "Movement",
  qtyIn: "In",
  qtyOut: "Out",
  balance: "Balance",
  allSites: "All Sites",
  back: "Back to Inventory",
  counted: "Counted stock",
  notRecorded: "Not recorded",
  chooseSite: "Choose a Site",
  noSites: "No Site is set up.",
  noStock: "No goods at this Site.",
  noBins: "No bins at this Site yet.",
  nothingToLoad: "Nothing to load.",
  noLines: "No movements for this item.",
  saved: "Saved",
  reservations: "Reservations",
  reservedFor: "Reserved for",
  noReservations: "No Units reserved at this Site.",
  incoming: "Incoming",
  byWarehouse: "Per-Warehouse Balance",
  floorPlan: "Floor plan",
  list: "List",
  printLabels: "Print labels",
  seedRacks: "Seed racks",
  stockInOut: "Stock In/Out",
  stockIn: "Stock In",
  stockOut: "Stock Out",
} as const;

const MOVEMENT_WORD: Record<string, string> = {
  unit_born: "Recorded",
  status_changed: "Status changed",
  site_changed: "Moved Site",
};

type View = "sites" | "inventory" | "reservations" | "bins" | "loading";
const VIEWS: readonly View[] = ["sites", "inventory", "reservations", "bins", "loading"];

interface BinRow {
  id: string;
  rack: string;
  bin: string;
  units: Array<{ unitCode: string; sku: string; availability: string }>;
}

/** The Bin's fill: empty, holding goods, or holding goods a customer is waiting for. */
export function binFill(b: Pick<BinRow, "units">): "empty" | "holding" | "reserved" {
  if (b.units.length === 0) return "empty";
  return b.units.some((u) => u.availability === "reserved") ? "reserved" : "holding";
}

const FILL_CLASS = {
  empty: "bg-white border-c-card-border",
  holding: "bg-c-ok-bg border-c-card-border",
  reserved: "bg-c-hold-bg border-c-card-border",
} as const;
const FILL_WORD = { empty: W.empty, holding: W.holding, reserved: W.holdingReserved } as const;

export default function WarehousesPage() {
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view") as View | null;
  const view: View = viewParam && VIEWS.includes(viewParam) ? viewParam : "sites";
  const sku = params.get("sku");
  const warehouses = useOperationWarehouse();
  const sites = warehouses.data?.warehouses ?? [];
  const siteId = params.get("site") ?? sites[0]?.id ?? "";
  const incoming = useQuery<{ incoming: Record<string, number> }>({
    queryKey: ["operation", "warehouse-incoming", siteId],
    queryFn: () => apiFetch(`/api/ops/stock-moves/incoming?siteId=${encodeURIComponent(siteId)}`),
    enabled: Boolean(siteId) && view === "inventory",
  });

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    p.set("tab", "warehouses");
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p);
  };

  const sitePicker = (
    <Select
      id="warehouses-site"
      toolbar
      value={siteId || undefined}
      placeholder={W.chooseSite}
      onValueChange={(v) => go({ site: v })}
      options={sites.map((s) => ({ value: s.id, label: s.name }))}
    />
  );
  const viewTabs = (
    <Tabs
      variant="segmented"
      label={W.page}
      value={view}
      onValueChange={(v) => go({ view: v, sku: null })}
      tabs={[
        { value: "sites", label: W.sites },
        { value: "inventory", label: W.inventory },
        { value: "reservations", label: W.reservations },
        { value: "bins", label: W.bins },
        { value: "loading", label: W.loading },
      ]}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col" data-testid="warehouses-page">
      <ModuleHeader testId="warehouses-destination-header" word={W.page} docTitle="Warehouses · Warehouse — Carres" destinationHeader />
      {!sku && view === "inventory" && warehouses.isSuccess && (() => {
        const stock = warehouses.data.byWarehouse[siteId] ?? [];
        return <KpiRow items={[
          { label: "Own Stock Qty", value: stock.reduce((n, e) => n + e.qty, 0), hint: "Units at this Site" },
          { label: W.available, value: stock.reduce((n, e) => n + (e.available ?? 0), 0), hint: "Not reserved" },
          { label: W.reserved, value: stock.reduce((n, e) => n + e.reserved, 0), hint: "Held for an order" },
          { label: W.items, value: stock.filter((e) => e.qty > 0).length, hint: "Distinct items" },
        ]} />;
      })()}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
        {sku ? (
          <StockCard sku={sku} siteId={siteId} sites={sites} byWarehouse={warehouses.data?.byWarehouse} toolbar={<>
            <Button onClick={() => go({ sku: null, view: "inventory" })}>{W.back}</Button>
            {sitePicker}
          </>} />
        ) : view === "sites" ? (
          <DataGrid
            appearance="reference"
            storageKey="carres.warehouse.warehouses.v1"
            rows={sites}
            rowKey={(s) => s.id}
            isLoading={warehouses.isLoading}
            errorState={warehouses.isError && !warehouses.data ? <CouldNotLoad onRetry={() => void warehouses.refetch()} /> : undefined}
            emptyMessage={W.noSites}
            exportName={W.page}
            toolbarStart={viewTabs}
            onRowClick={(s) => go({ view: "inventory", site: s.id })}
            columns={[
              { key: "name", label: W.site, accessor: (s) => s.name, searchValue: (s) => s.name, exportValue: (s) => s.name, sortable: true },
              { key: "type", label: "Type", accessor: (s) => (s.owning_partner_id ? "Logistics partner" : "Own"), exportValue: (s) => (s.owning_partner_id ? "Logistics partner" : "Own"), filterType: "enum" },
              { key: "address", label: W.address, accessor: (s) => s.address ?? W.notRecorded, exportValue: (s) => s.address ?? "" },
              {
                key: "items", label: W.items, align: "right", sortable: true,
                numberValue: (s) => (warehouses.data?.byWarehouse[s.id] ?? []).filter((e) => e.qty > 0).length,
                accessor: (s) => (warehouses.data?.byWarehouse[s.id] ?? []).filter((e) => e.qty > 0).length,
              },
              {
                key: "units", label: W.units, align: "right", sortable: true,
                numberValue: (s) => (warehouses.data?.byWarehouse[s.id] ?? []).reduce((n, e) => n + e.qty, 0),
                accessor: (s) => (warehouses.data?.byWarehouse[s.id] ?? []).reduce((n, e) => n + e.qty, 0),
              },
            ] satisfies DataGridColumn<(typeof sites)[number]>[]}
          />
        ) : view === "inventory" ? (
          <DataGrid
            appearance="reference"
            storageKey="carres.warehouse.inventory-by-item.v1"
            rows={(warehouses.data?.byWarehouse[siteId] ?? []).filter((e) => e.qty > 0 || e.reserved > 0)}
            rowKey={(e) => e.sku}
            isLoading={warehouses.isLoading}
            errorState={warehouses.isError && !warehouses.data ? <CouldNotLoad onRetry={() => void warehouses.refetch()} /> : undefined}
            emptyMessage={W.noStock}
            exportName={W.inventory}
            toolbarStart={<>{viewTabs}{sitePicker}</>}
            onRowClick={(e) => go({ sku: e.sku })}
            columns={[
              { key: "sku", label: W.item, accessor: (e) => e.sku, searchValue: (e) => e.sku, exportValue: (e) => e.sku, sortable: true },
              { key: "qty", label: W.units, align: "right", sortable: true, numberValue: (e) => e.qty, exportValue: (e) => e.qty, accessor: (e) => e.qty },
              { key: "available", label: W.available, align: "right", sortable: true, numberValue: (e) => e.available ?? 0, exportValue: (e) => e.available ?? 0, accessor: (e) => e.available ?? 0 },
              { key: "reserved", label: W.reserved, align: "right", sortable: true, numberValue: (e) => e.reserved, exportValue: (e) => e.reserved, accessor: (e) => e.reserved },
              // shortcut: an item with only Incoming Units and none on hand has no row here, list it when Inventory reads its rows from the register.
              { key: "incoming", label: W.incoming, align: "right", sortable: true, numberValue: (e) => incoming.data?.incoming[e.sku] ?? 0, exportValue: (e) => incoming.data?.incoming[e.sku] ?? 0, accessor: (e) => incoming.data?.incoming[e.sku] ?? 0 },
            ]}
          />
        ) : view === "reservations" ? (
          <Reservations siteId={siteId} toolbar={<>{viewTabs}{sitePicker}</>} />
        ) : view === "bins" ? (
          // key: a new Site starts fresh, so a Bin picked at the old Site is not kept.
          <RacksAndBins key={siteId} siteId={siteId} siteName={sites.find((s) => s.id === siteId)?.name ?? ""} toolbar={<>{viewTabs}{sitePicker}</>} />
        ) : (
          <LoadingList siteId={siteId} toolbar={<>{viewTabs}{sitePicker}</>} />
        )}
      </div>
    </div>
  );
}

/** Units reserved at one Site and what holds them (Houzs Inventory.tsx Reservations tab). */
function Reservations({ siteId, toolbar }: { siteId: string; toolbar: React.ReactNode }) {
  type Unit = { id: string; unit_code: string; sku: string; status: string; reserved_ref: string | null };
  const q = useQuery<{ units: Unit[] }>({
    queryKey: ["stock-moves", "units", siteId],
    queryFn: () => apiFetch(`/api/ops/stock-moves/units?siteId=${encodeURIComponent(siteId)}`),
    enabled: Boolean(siteId),
  });
  return (
    <DataGrid<Unit>
      appearance="reference"
      storageKey="carres.warehouse.reservations.v1"
      rows={(q.data?.units ?? []).filter((u) => u.status === "reserved")}
      rowKey={(u) => u.id}
      isLoading={q.isLoading}
      errorState={q.isError && !q.data ? <CouldNotLoad onRetry={() => void q.refetch()} /> : undefined}
      emptyMessage={W.noReservations}
      exportName={W.reservations}
      toolbarStart={toolbar}
      columns={[
        { key: "unit", label: W.unitId, accessor: (u) => u.unit_code, searchValue: (u) => u.unit_code, exportValue: (u) => u.unit_code, sortable: true },
        { key: "sku", label: W.item, accessor: (u) => u.sku, searchValue: (u) => u.sku, exportValue: (u) => u.sku, sortable: true },
        { key: "ref", label: W.reservedFor, accessor: (u) => u.reserved_ref ?? W.notRecorded, searchValue: (u) => u.reserved_ref ?? "", exportValue: (u) => u.reserved_ref ?? "", sortable: true },
      ]}
    />
  );
}

function StockCard({ sku, siteId, sites, byWarehouse, toolbar }: {
  sku: string;
  siteId: string;
  sites: ReadonlyArray<{ id: string; name: string }>;
  byWarehouse: Record<string, ReadonlyArray<{ sku: string; qty: number; reserved: number; available?: number | null }>> | undefined;
  toolbar: React.ReactNode;
}) {
  const q = useQuery<{ sku: string; lines: StockCardLine[] }>({
    queryKey: ["operation", "stock-card", sku, siteId],
    queryFn: () => apiFetch(`/api/ops/stock/stock-card?sku=${encodeURIComponent(sku)}${siteId ? `&site=${encodeURIComponent(siteId)}` : ""}`),
  });
  const [type, setType] = useState("all");
  const lines = q.data?.lines ?? [];
  const shown = lines.filter((l) => type === "all" || (type === "in" ? l.qtyIn > 0 : l.qtyOut > 0));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const valueWord = (line: StockCardLine, v: string | null) =>
    v === null ? "" : line.event === "site_changed" ? siteName.get(v) ?? v : v;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
    {q.isSuccess && <KpiRow items={[
      { label: "Current Qty", value: lines.at(-1)?.balance ?? 0, hint: "Balance after the last movement" },
      { label: "Last Movement", value: lines.at(-1) ? fmtDate(lines.at(-1)!.eventAt) : W.notRecorded, hint: "Newest line below" },
    ]} />}
    {byWarehouse && (
      <DetailSection title={W.byWarehouse}>
        <DocumentTable label={W.byWarehouse}
          columns={[{ key: "site", label: W.site }, { key: "qty", label: W.units, numeric: true }, { key: "available", label: W.available, numeric: true }, { key: "reserved", label: W.reserved, numeric: true }]}
          rows={sites.flatMap((s) => (byWarehouse[s.id] ?? []).filter((e) => e.sku === sku && (e.qty > 0 || e.reserved > 0)).map((e) => ({
            key: s.id, cells: { site: s.name, qty: e.qty, available: e.available ?? 0, reserved: e.reserved },
          })))} />
      </DetailSection>
    )}
    <DataGrid<StockCardLine>
      appearance="reference"
      storageKey="carres.warehouse.stock-card.v1"
      rows={[...shown].reverse()}
      rowKey={(l) => String(l.seq)}
      isLoading={q.isLoading}
      errorState={q.isError && !q.data ? <CouldNotLoad onRetry={() => void q.refetch()} /> : undefined}
      emptyMessage={W.noLines}
      exportName={`${W.stockCard} ${sku}`}
      toolbarStart={<>{toolbar}<span className="text-body font-medium text-c-ink" data-testid="stock-card-item">{W.stockCard} · {sku}</span>
        <Tabs variant="segmented" label="Type" value={type} onValueChange={setType} tabs={[
          { value: "all", label: "All" }, { value: "in", label: "IN" }, { value: "out", label: "OUT" },
        ]} /></>}
      columns={[
        { key: "when", label: W.when, accessor: (l) => fmtDate(l.eventAt), exportValue: (l) => l.eventAt, sortable: true },
        { key: "unit", label: W.unitId, accessor: (l) => l.unitCode ?? W.counted, searchValue: (l) => l.unitCode ?? "" },
        {
          key: "what", label: W.what,
          accessor: (l) => [MOVEMENT_WORD[l.event] ?? l.event, [valueWord(l, l.fromValue), valueWord(l, l.toValue)].filter(Boolean).join(" to ")].filter(Boolean).join(" · "),
        },
        { key: "in", label: W.qtyIn, align: "right", numberValue: (l) => l.qtyIn, exportValue: (l) => l.qtyIn, accessor: (l) => (l.qtyIn ? l.qtyIn : "") },
        { key: "out", label: W.qtyOut, align: "right", numberValue: (l) => l.qtyOut, exportValue: (l) => l.qtyOut, accessor: (l) => (l.qtyOut ? l.qtyOut : "") },
        { key: "balance", label: W.balance, align: "right", numberValue: (l) => l.balance, exportValue: (l) => l.balance, accessor: (l) => l.balance },
      ]}
    />
    </div>
  );
}

function RacksAndBins({ siteId, siteName, toolbar }: { siteId: string; siteName: string; toolbar: React.ReactNode }) {
  const qc = useQueryClient();
  const key = ["operation", "warehouse-bins", siteId];
  const q = useQuery<{ bins: BinRow[] }>({
    queryKey: key,
    queryFn: () => apiFetch(`/api/ops/stock/bins?site=${encodeURIComponent(siteId)}`),
    enabled: Boolean(siteId),
  });
  const [rack, setRack] = useState("");
  const [bin, setBin] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [binId, setBinId] = useState<string | undefined>();
  const add = useMutation({
    mutationFn: () => apiFetch("/api/ops/stock/bins", { method: "POST", body: JSON.stringify({ siteId, rack, bin }) }),
    onSuccess: () => { setBin(""); toast.success(W.saved); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const place = useMutation({
    mutationFn: (target: string | null) =>
      apiFetch(`/api/ops/stock/register/${encodeURIComponent(unitCode.trim())}/bin`, { method: "POST", body: JSON.stringify({ binId: target }) }),
    onSuccess: () => { setUnitCode(""); toast.success(W.saved); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bins = q.data?.bins ?? [];
  const [layout, setLayout] = useState("list");
  const [slot, setSlot] = useState<BinRow | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [moving, setMoving] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const printLabels = () => {
    import("@/lib/pdf/warehouse-document-pdf")
      .then(({ downloadBinLabels }) => downloadBinLabels(siteName, bins))
      .catch((e: Error) => toast.error(e.message));
  };
  const plan = useMemo(() => floorPlan(bins), [q.data]);
  const racks = useMemo(() => {
    const m = new Map<string, BinRow[]>();
    for (const b of bins) m.set(b.rack, [...(m.get(b.rack) ?? []), b]);
    return [...m.entries()];
  }, [bins]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto" data-testid="racks-and-bins">
      <div className="flex flex-wrap items-end gap-2">{toolbar}</div>
      <div className="flex flex-wrap items-end gap-2">
        <Input id="bin-rack" label={W.rack} value={rack} onChange={(e) => setRack(e.target.value)} />
        <Input id="bin-bin" label={W.bin} value={bin} onChange={(e) => setBin(e.target.value)} />
        <Button disabled={!siteId || !rack.trim() || !bin.trim() || add.isPending} onClick={() => add.mutate()}>{W.addBin}</Button>
        <Input id="bin-unit" label={W.unitId} value={unitCode} onChange={(e) => setUnitCode(e.target.value)} />
        <Select id="bin-target" label={W.bin} value={binId} onValueChange={setBinId}
          options={bins.map((b) => ({ value: b.id, label: `${b.rack} · ${b.bin}` }))} />
        <Button disabled={!unitCode.trim() || !binId || place.isPending} onClick={() => place.mutate(binId ?? null)}>{W.putInBin}</Button>
        <Button variant="ghost" disabled={!unitCode.trim() || place.isPending} onClick={() => place.mutate(null)}>{W.takeOut}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Tabs variant="segmented" label={W.bins} value={layout} onValueChange={setLayout} tabs={[
          { value: "list", label: W.list }, { value: "plan", label: W.floorPlan },
        ]} />
        <Button disabled={!siteId} onClick={() => setMoving(true)}>{W.stockInOut}</Button>
        <Button disabled={!siteId} onClick={() => setSeeding(true)}>{W.seedRacks}</Button>
        <Button icon="print" disabled={bins.length === 0} onClick={printLabels}>{W.printLabels}</Button>
      </div>
      <div className="flex flex-wrap gap-3 text-meta text-c-secondary" aria-hidden="true">
        {(["empty", "holding", "reserved"] as const).map((f) => (
          <span key={f} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded border ${FILL_CLASS[f]}`} />{FILL_WORD[f]}
          </span>
        ))}
      </div>
      {q.isSuccess && bins.length > 0 && (
        <dl className="flex flex-wrap gap-4 text-body" data-testid="bin-stats">
          {([
            ["Total slots", bins.length],
            ["Occupied", bins.filter((b) => binFill(b) !== "empty").length],
            ["Empty", bins.filter((b) => binFill(b) === "empty").length],
            ["Reserved", bins.filter((b) => binFill(b) === "reserved").length],
            ["Occupancy", `${Math.round((bins.filter((b) => binFill(b) !== "empty").length / bins.length) * 100)}%`],
          ] as const).map(([k, v]) => <div key={k}><dt className="text-meta text-c-secondary">{k}</dt><dd className="font-medium text-c-ink">{v}</dd></div>)}
        </dl>
      )}
      {q.isLoading ? <Loading variant="skeleton" label={W.bins} /> : q.isError && !q.data ? (
        <CouldNotLoad onRetry={() => void q.refetch()} />
      ) : racks.length === 0 ? (
        <p className="text-body text-c-secondary">{W.noBins}</p>
      ) : layout === "plan" ? (
        <div className="flex flex-col gap-4" data-testid="floor-plan">
          {plan.map((bank) => (
            <section key={bank.series} aria-label={`${W.floorPlan} ${bank.series}`} className="overflow-x-auto">
              <div className="flex gap-2">
                {bank.racks.map((r) => (
                  <div key={r.rack} className="flex flex-col gap-1">
                    <span className="text-meta text-c-secondary">{r.rack}</span>
                    {r.bins.map((b) => {
                      const fill = binFill(b);
                      return (
                        <button key={b.id} type="button" onClick={() => setSlot(b)} data-fill={fill}
                          aria-label={`${W.rack} ${b.rack} ${W.bin} ${b.bin} · ${FILL_WORD[fill]} · ${b.units.length} ${W.units}`}
                          className={`min-h-11 min-w-11 rounded border px-2 text-body ${FILL_CLASS[fill]}`}>{b.bin}</button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        racks.map(([r, list]) => (
          <section key={r} aria-label={`${W.rack} ${r}`} className="flex flex-col gap-1.5">
            <h3 className="text-body font-medium text-c-ink">{W.rack} {r}</h3>
            <div className="flex flex-wrap gap-2">
              {list.map((b) => {
                const fill = binFill(b);
                return (
                  <div key={b.id} data-testid={`bin-${r}-${b.bin}`} data-fill={fill}
                    aria-label={`${W.bin} ${b.bin} · ${FILL_WORD[fill]} · ${b.units.length} ${W.units}`}
                    title={b.units.map((u) => `${u.unitCode} ${u.sku}`).join("\n")}
                    className={`flex min-w-[96px] flex-col rounded-lg border px-3 py-2 ${FILL_CLASS[fill]}`}>
                    <span className="text-body font-medium text-c-ink">{b.bin}</span>
                    <span className="text-meta text-c-secondary">{b.units.length} {W.units}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      <Modal open={slot !== null} onOpenChange={(o) => !o && setSlot(null)} title={slot ? `${slot.rack} · ${slot.bin}` : W.bin}
        footer={<Button variant="neutral" onClick={() => setSlot(null)}>Close</Button>}>
        {slot && (slot.units.length === 0 ? <p className="text-body text-c-secondary">{W.empty}</p> : (
          <DocumentTable label={W.units} columns={[{ key: "unit", label: W.unitId }, { key: "sku", label: W.item }]}
            rows={slot.units.map((u) => ({ key: u.unitCode, cells: { unit: u.unitCode, sku: u.sku } }))} />
        ))}
      </Modal>
      {seeding && <SeedRacks siteId={siteId} existing={bins} onClose={() => setSeeding(false)} onDone={refresh} />}
      {moving && <BinStockInOut bins={bins} onClose={() => setMoving(false)} onDone={refresh} />}
    </div>
  );
}

/** Houzs Seed racks: many Bins at once. Bins already there are skipped, and a failure says how far it got. */
function SeedRacks({ siteId, existing, onClose, onDone }: { siteId: string; existing: BinRow[]; onClose: () => void; onDone: () => void }) {
  const [series, setSeries] = useState("");
  const [count, setCount] = useState("10");
  const [levels, setLevels] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const planned = seedBins({ series, count: Number(count) || 0, levels: Number(levels) || 1 });
  const fresh = planned.filter((p) => !existing.some((b) => b.rack === p.rack && b.bin === p.bin));
  const run = useMutation({
    mutationFn: async () => {
      let made = 0;
      try {
        for (const b of fresh) {
          await apiFetch("/api/ops/stock/bins", { method: "POST", body: JSON.stringify({ siteId, rack: b.rack, bin: b.bin }) });
          made += 1;
        }
      } catch (e) {
        throw new Error(`${made} of ${fresh.length} Bins were added, then: ${e instanceof Error ? e.message : "it failed"}`);
      }
    },
    onSuccess: () => { toast.success(W.saved); onDone(); onClose(); },
    onError: (e: Error) => { setError(e.message); onDone(); },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={W.seedRacks}
      description={`At most ${MAX_SEED_BINS} Bins at a time. Bins already at this Site are skipped.`}
      footer={<>
        <Button variant="neutral" onClick={onClose}>Close</Button>
        <Button variant="primary" loading={run.isPending} disabled={fresh.length === 0} onClick={() => run.mutate()}>Add {fresh.length} Bins</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Input id="seed-series" label="Series" hint="L makes racks L1, L2 and so on." value={series} onChange={(e) => setSeries(e.target.value)} />
        <Input id="seed-count" label="Racks" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
        <Input id="seed-levels" label="Levels per rack" type="number" min={1} value={levels} onChange={(e) => setLevels(e.target.value)} />
        <p className="text-body text-c-muted" role="status">
          {planned.slice(0, 4).map((p) => `${p.rack} · ${p.bin}`).join(", ")}{planned.length > 4 ? ", and more" : ""}
        </p>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  );
}

/** Houzs Stock In/Out on Carres's Units: put many exact Units in a Bin, or take them out. A Unit that fails stays in the box. */
function BinStockInOut({ bins, onClose, onDone }: { bins: BinRow[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState("in");
  const [binId, setBinId] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const codes = text.split(/\s+/).filter(Boolean);
  const run = useMutation({
    mutationFn: async () => {
      const failed: { code: string; why: string }[] = [];
      for (const code of codes) {
        try {
          await apiFetch(`/api/ops/stock/register/${encodeURIComponent(code)}/bin`, { method: "POST", body: JSON.stringify({ binId: mode === "in" ? binId : null }) });
        } catch (e) {
          failed.push({ code, why: e instanceof Error ? e.message : "Failed" });
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      onDone();
      if (failed.length === 0) { toast.success(W.saved); onClose(); return; }
      setText(failed.map((f) => f.code).join("\n"));
      setErrors(failed.map((f) => `${f.code}: ${f.why}`));
    },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={W.stockInOut}
      footer={<>
        <Button variant="neutral" onClick={onClose}>Close</Button>
        <Button variant="primary" loading={run.isPending} disabled={codes.length === 0 || (mode === "in" && !binId)} onClick={() => run.mutate()}>
          {mode === "in" ? W.stockIn : W.stockOut} {codes.length} {W.units}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Tabs variant="segmented" label={W.stockInOut} value={mode} onValueChange={setMode} tabs={[
          { value: "in", label: W.stockIn }, { value: "out", label: W.stockOut },
        ]} />
        {mode === "in" && <Select id="io-bin" label={W.bin} value={binId} onValueChange={setBinId}
          options={bins.map((b) => ({ value: b.id, label: `${b.rack} · ${b.bin}` }))} />}
        <Textarea id="io-units" label="Unit IDs" hint="One Unit ID per line, or scan them." rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        {errors.map((e) => <FieldError key={e}>{e}</FieldError>)}
      </div>
    </Modal>
  );
}

function LoadingList({ siteId, toolbar }: { siteId: string; toolbar: React.ReactNode }) {
  const q = useDeliveryWarehouseSchedule();
  // Houzs LoadingList.tsx:47-51: To load · Loaded · All.
  const [filter, setFilter] = useState("toLoad");
  const rows = useMemo(
    () => loadingListRows(warehouseOutboundCards((q.data?.events ?? []) as DeliveryWarehouseScheduleEvent[]), { includeLoaded: true })
      .filter((r) => !siteId || r.warehouseSiteId === null || r.warehouseSiteId === siteId)
      .filter((r) => filter === "all" || (filter === "toLoad" ? r.toLoad > 0 : r.toLoad === 0)),
    [q.data, siteId, filter],
  );
  return (
    <DataGrid<LoadingListRow>
      appearance="reference"
      storageKey="carres.warehouse.loading-list.v1"
      rows={rows}
      rowKey={(r) => r.key}
      isLoading={q.isLoading}
      errorState={q.isError && !q.data ? <CouldNotLoad onRetry={() => void q.refetch()} /> : undefined}
      emptyMessage={W.nothingToLoad}
      exportName={W.loading}
      toolbarStart={<>{toolbar}
        <Tabs variant="segmented" label={W.loading} value={filter} onValueChange={setFilter} tabs={[
          { value: "toLoad", label: W.toLoad }, { value: "loaded", label: W.loaded }, { value: "all", label: "All" },
        ]} /></>}
      initialGroupBy={["doNumber"]}
      columns={[
        { key: "eventDate", label: W.date, accessor: (r) => fmtDate(r.eventDate), exportValue: (r) => r.eventDate, sortable: true },
        { key: "doNumber", label: W.doNo, accessor: (r) => r.doNumber, groupValue: (r) => r.doNumber, searchValue: (r) => r.doNumber, exportValue: (r) => r.doNumber, sortable: true, groupable: true },
        { key: "source", label: W.soNo, accessor: (r) => r.source, exportValue: (r) => r.source },
        { key: "item", label: W.item, accessor: (r) => r.name ?? r.sku ?? W.notRecorded, searchValue: (r) => `${r.name ?? ""} ${r.sku ?? ""}`, exportValue: (r) => r.name ?? r.sku ?? "" },
        { key: "qty", label: W.qty, align: "right", numberValue: (r) => r.qty, exportValue: (r) => r.qty, accessor: (r) => r.qty },
        { key: "loaded", label: W.loaded, align: "right", numberValue: (r) => r.loaded, exportValue: (r) => r.loaded, accessor: (r) => r.loaded },
        { key: "toLoad", label: W.toLoad, align: "right", numberValue: (r) => r.toLoad, exportValue: (r) => r.toLoad, accessor: (r) => r.toLoad },
        { key: "logistics", label: W.logistics, accessor: (r) => r.logisticsPartner, exportValue: (r) => r.logisticsPartner },
      ]}
    />
  );
}
