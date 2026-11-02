import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import Checkbox from "@/components/kit/Checkbox";
import Input from "@/components/kit/Input";
import Modal from "@/components/kit/Modal";
import Select from "@/components/kit/Select";
import Textarea from "@/components/kit/Textarea";
import { FieldError } from "@/components/kit/FieldFrame";
import ConfirmActionDialog from "@/pages/operation/components/ConfirmActionDialog";
import LoadError from "@/pages/operation/components/LoadError";
import ModuleHeader from "@/pages/operation/components/ModuleHeader";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import { useCatalog } from "@/lib/queries";
import DocumentTable from "@/components/kit/DocumentTable";
import Tabs from "@/components/kit/Tabs";
import { documentRowMenu } from "@/components/register/row-menu";
import { DetailSection, DocHistory, Facts, KpiRow, RelationshipMap, TableCardsTabs, cardsProps, printDocument, useOpenFromUrl } from "./houzs-list-bits";
import { downloadCountSheet, readCountedFile } from "./stock-take-sheet";

/**
 * Stock Adjustment · Stock Transfer · Stock Take (migration 0714).
 *
 * Weisiang's decision (Mr Lim, Houzs owner side, WhatsApp 2026-10-22): office
 * staff adjust, transfer and count stock the Houzs way. This overturns Jess's
 * Stock MASTER §12.4 / §12.5 / §12.7 rules; Jess was not part of this decision.
 * Carres keeps its Units underneath: every line here picks or births exact
 * Units, never a bare quantity.
 */

const BASE = "/api/ops/stock-moves";
type Site = { id: string; name: string };
type PickUnit = { id: string; unit_code: string; sku: string; status: string; reserved_ref: string | null; needs_repair: boolean };
type UnitRef = { ops_stock_items: { unit_code: string; sku: string } | null };
type PlusLine = { sku: string; qty: string };

const post = <T,>(path: string, body: unknown) =>
  apiFetch<T>(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) });

function useSites() {
  return useQuery({ queryKey: ["stock-moves", "sites"], queryFn: () => apiFetch<{ sites: Site[] }>(`${BASE}/sites`), staleTime: 300_000 });
}
function siteName(sites: Site[] | undefined, id: string) {
  return sites?.find((s) => s.id === id)?.name ?? "";
}
function unitCodes(units: UnitRef[]) {
  return units.map((u) => u.ops_stock_items?.unit_code).filter(Boolean).join(", ");
}
function plusPayload(lines: PlusLine[]) {
  return lines.filter((l) => l.sku.trim()).map((l) => ({ sku: l.sku.trim(), qty: Number(l.qty) || 0 }));
}

function Page({ word, testId, children }: { word: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <ModuleHeader destinationHeader testId={`${testId}-header`} word={word} docTitle={`${word} · Warehouse · Carres`} />
      {children}
    </div>
  );
}

/** Pick exact Units standing at one Site. */
function UnitPicker({ siteId, picked, onChange, allowReserved }: {
  siteId: string; picked: string[]; onChange: (ids: string[]) => void; allowReserved: boolean;
}) {
  const [find, setFind] = useState("");
  const q = useQuery({
    queryKey: ["stock-moves", "units", siteId],
    queryFn: () => apiFetch<{ units: PickUnit[] }>(`${BASE}/units?siteId=${siteId}`),
    enabled: Boolean(siteId),
  });
  if (!siteId) return null;
  const needle = find.trim().toLowerCase();
  const units = (q.data?.units ?? []).filter((u) => !needle || `${u.unit_code} ${u.sku}`.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-2">
      <Input id="find-unit" label="Find Unit" value={find} onChange={(e) => setFind(e.target.value)} />
      {q.isError && <LoadError message="The Units could not be loaded." onRetry={() => void q.refetch()} />}
      <div role="group" className="max-h-64 overflow-auto rounded-control border border-c-line p-2" aria-label="Units">
        {q.isSuccess && units.length === 0 && <p className="text-body text-c-muted">No Units here.</p>}
        {units.map((u) => {
          const blocked = u.needs_repair || (!allowReserved && u.status === "reserved");
          const why = u.needs_repair ? " · In repair" : u.status === "reserved" ? ` · Reserved for ${u.reserved_ref ?? "a Sales Order"}` : "";
          return (
            <Checkbox
              key={u.id}
              id={`unit-${u.id}`}
              label={`${u.unit_code} · ${u.sku}${why}`}
              disabled={blocked}
              checked={picked.includes(u.id)}
              onCheckedChange={(on) => onChange(on ? [...picked, u.id] : picked.filter((x) => x !== u.id))}
            />
          );
        })}
      </div>
      <p className="text-body text-c-muted">{picked.length} Units picked</p>
    </div>
  );
}

/** Lines of goods that get NEW Unit IDs (Stock Adjustment plus, Stock Take extras). */
function PlusLines({ lines, onChange }: { lines: PlusLine[]; onChange: (l: PlusLine[]) => void }) {
  // The same catalogue the Goods Receipt form picks from, so a typo cannot reach the server.
  const catalog = useCatalog();
  const models = new Map((catalog.data?.models ?? []).map((m) => [m.id, m.name]));
  const skuOptions = (catalog.data?.skus ?? []).filter((x) => !x.discontinuedAt)
    .map((x) => ({ value: x.sku, label: `${x.sku} · ${models.get(x.modelId) ?? ""} ${x.variant}`.trim() }));
  // A SKU already on the sheet that is no longer in the catalogue stays pickable.
  for (const l of lines) if (l.sku && !skuOptions.some((o) => o.value === l.sku)) skuOptions.push({ value: l.sku, label: l.sku });
  const set = (i: number, patch: Partial<PlusLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
          <Select id={`plus-sku-${i}`} label="Item" value={l.sku || undefined} onValueChange={(sku) => set(i, { sku })}
            placeholder={catalog.isError ? "SKUs could not be loaded" : "Select"} options={skuOptions} />
          <Input id={`plus-qty-${i}`} label="Qty" type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <Button variant="ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div><Button variant="neutral" icon="add" onClick={() => onChange([...lines, { sku: "", qty: "1" }])}>Add line</Button></div>
    </div>
  );
}

function SiteSelect({ id, label, value, onChange, sites }: { id: string; label: string; value: string; onChange: (v: string) => void; sites: Site[] }) {
  return <Select id={id} label={label} value={value} onValueChange={onChange} options={sites.map((s) => ({ value: s.id, label: s.name }))} />;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Could not save. Try again.";
}

const PRINT = "Print PDF";

// ── Stock Adjustment ──────────────────────────────────────────────────────────
type AdjustmentRow = {
  id: string; adjustment_no: string; warehouse_id: string; reason: string; created_at: string; performed_by: string | null;
  stock_counts: { count_no: string } | null;
  stock_adjustment_units: (UnitRef & { direction: "plus" | "minus" })[];
};

const netQty = (r: AdjustmentRow) => r.stock_adjustment_units.reduce((n, u) => n + (u.direction === "plus" ? 1 : -1), 0);
const isRecent = (at: string) => Date.now() - new Date(at).getTime() <= 30 * 86_400_000;

export function StockAdjustments() {
  const qc = useQueryClient();
  const sites = useSites();
  const list = useQuery({ queryKey: ["stock-moves", "adjustments"], queryFn: () => apiFetch<{ adjustments: AdjustmentRow[] }>(`${BASE}/adjustments`) });
  const [display, setDisplay] = useState("table");
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [reason, setReason] = useState("");
  const [minus, setMinus] = useState<string[]>([]);
  const [plus, setPlus] = useState<PlusLine[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<AdjustmentRow | null>(null);
  useOpenFromUrl(list.data?.adjustments, (r) => r.adjustment_no, setViewing);
  const printIt = (r: AdjustmentRow) => printDocument({
    title: "Stock Adjustment", docNo: r.adjustment_no, date: fmtDate(r.created_at),
    facts: [["Warehouse", siteName(sites.data?.sites, r.warehouse_id)], ["Performed By", r.performed_by ?? ""], ["Net Qty", String(netQty(r))], ["Stock Take", r.stock_counts?.count_no ?? ""], ["Reason", r.reason]],
    tables: [{
      title: "Items", headers: ["SKU", "Unit ID", "Qty"], numeric: ["Qty"],
      rows: r.stock_adjustment_units.map((u) => [u.ops_stock_items?.sku ?? "", u.ops_stock_items?.unit_code ?? "", u.direction === "plus" ? "1" : "-1"]),
    }],
    signatures: ["Performed by", "Checked by"],
  });
  const save = useMutation({
    mutationFn: () => post("/adjustments", { siteId, reason, minusUnitIds: minus, plus: plusPayload(plus) }),
    onSuccess: () => {
      setConfirming(false); setOpen(false); setMinus([]); setPlus([]); setReason("");
      void qc.invalidateQueries({ queryKey: ["stock-moves"] });
    },
  });
  const adjustHint = !siteId ? "Pick a Warehouse."
    : !reason.trim() ? "Write the reason."
    : minus.length === 0 && plusPayload(plus).length === 0 ? "Pick Units to write off, or add an item." : null;
  const columns = useMemo<DataGridColumn<AdjustmentRow>[]>(() => [
    { key: "no", label: "Adjustment No", width: 170, accessor: (r) => r.adjustment_no },
    { key: "date", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "site", label: "Warehouse", width: 180, accessor: (r) => siteName(sites.data?.sites, r.warehouse_id), filterType: "enum" },
    { key: "items", label: "Items", width: 80, align: "right", numberValue: (r) => r.stock_adjustment_units.length, accessor: (r) => r.stock_adjustment_units.length },
    { key: "net", label: "Net Qty", width: 90, align: "right", numberValue: netQty, accessor: netQty },
    { key: "reason", label: "Reason", width: 240, accessor: (r) => r.reason },
    { key: "by", label: "Performed By", width: 160, accessor: (r) => r.performed_by ?? "" },
    { key: "minus", label: "Written off", width: 260, accessor: (r) => unitCodes(r.stock_adjustment_units.filter((u) => u.direction === "minus")) },
    { key: "plus", label: "Added", width: 260, accessor: (r) => unitCodes(r.stock_adjustment_units.filter((u) => u.direction === "plus")) },
    { key: "count", label: "Stock Take", width: 170, accessor: (r) => r.stock_counts?.count_no ?? "" },
  ], [sites.data]);

  return (
    <Page word="Stock Adjustment" testId="stock-adjustments">
      {list.isSuccess && (() => {
        const recent = list.data.adjustments.filter((r) => isRecent(r.created_at));
        return <KpiRow items={[
          { label: "Adjustments · 30d", value: recent.length, hint: "Stock Adjustments in the last 30 days" },
          { label: "Net qty delta", value: recent.reduce((n, r) => n + netQty(r), 0), hint: "Units added less Units written off, 30 days" },
        ]} />;
      })()}
      {list.isError ? <LoadError message="The stock adjustments could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={list.data?.adjustments ?? []} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.warehouse.stock-adjustments.v1" appearance="reference" exportName="Stock Adjustment"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search adjustment, reason or Unit ID…"
            onRowClick={setViewing}
            contextMenu={(r) => documentRowMenu({ view: () => setViewing(r), print: () => printIt(r) })}
            {...cardsProps<AdjustmentRow>(display, (r) => r.id, setViewing, (r) => ({ title: r.adjustment_no, facts: [
              ["Date", fmtDate(r.created_at)], ["Warehouse", siteName(sites.data?.sites, r.warehouse_id)], ["Net Qty", netQty(r)], ["Reason", r.reason],
            ] }))}
            toolbarEnd={<><TableCardsTabs label="Stock Adjustment" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Stock Adjustment</Button></>}
            emptyMessage="No stock adjustments yet." />
        </ListPageShell>
      )}
      <Modal open={open} onOpenChange={setOpen} width="wide" title="New Stock Adjustment"
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={save.isPending} disabled={!siteId || !reason.trim() || (minus.length === 0 && plusPayload(plus).length === 0)}
            onClick={() => (minus.length > 0 ? setConfirming(true) : save.mutate())}>Save</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <SiteSelect id="adj-site" label="Warehouse" value={siteId} onChange={(v) => { setSiteId(v); setMinus([]); }} sites={sites.data?.sites ?? []} />
          <Textarea id="adj-reason" label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-body font-semibold">Write off</p>
          <UnitPicker siteId={siteId} picked={minus} onChange={setMinus} allowReserved={false} />
          <p className="text-body font-semibold">Add</p>
          <PlusLines lines={plus} onChange={setPlus} />
          {adjustHint && <p className="text-body text-c-muted" role="status">Save is off: {adjustHint}</p>}
          {!confirming && save.isError && <FieldError>{errorText(save.error)}</FieldError>}
        </div>
      </Modal>
      <Modal open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)} width="wide" title={viewing?.adjustment_no ?? "Stock Adjustment"}
        footer={<>
          <Button variant="neutral" onClick={() => setViewing(null)}>Close</Button>
          {viewing && <Button variant="neutral" icon="print" onClick={() => printIt(viewing)}>{PRINT}</Button>}
        </>}>
        {viewing && (
          <div className="flex flex-col gap-4">
            <DetailSection title="Adjustment">
              <Facts facts={[
                ["Warehouse", siteName(sites.data?.sites, viewing.warehouse_id)],
                ["Date", fmtDate(viewing.created_at)],
                ["Performed By", viewing.performed_by ?? ""],
                ["Net Qty", netQty(viewing)],
                ["Reason", viewing.reason],
                ["Stock Take", viewing.stock_counts?.count_no ?? ""],
              ]} />
            </DetailSection>
            <DetailSection title={`Items (${viewing.stock_adjustment_units.length})`}>
              <DocumentTable label="Items"
                columns={[{ key: "n", label: "#" }, { key: "sku", label: "SKU" }, { key: "unit", label: "Unit ID" }, { key: "qty", label: "Qty", numeric: true }]}
                rows={viewing.stock_adjustment_units.map((u, i) => ({
                  key: String(i),
                  cells: { n: i + 1, sku: u.ops_stock_items?.sku ?? "", unit: u.ops_stock_items?.unit_code ?? "", qty: u.direction === "plus" ? 1 : -1 },
                }))} />
            </DetailSection>
            <RelationshipMap current={{ kind: "Stock Adjustment", no: viewing.adjustment_no }}
              links={viewing.stock_counts ? [{ kind: "Stock Take", no: viewing.stock_counts.count_no, tab: "stock-takes" }] : []} />
            <DocHistory events={[{ at: viewing.created_at, word: "Created", who: viewing.performed_by }]} />
          </div>
        )}
      </Modal>
      <ConfirmActionDialog open={confirming} title="Write off Units?"
        message={`${minus.length} ${minus.length === 1 ? "Unit" : "Units"} will be written off. This cannot be undone.`}
        confirmLabel="Write off and save" pending={save.isPending} error={save.isError ? errorText(save.error) : null}
        onConfirm={() => save.mutate()} onCancel={() => setConfirming(false)} />
    </Page>
  );
}

// ── Stock Transfer ────────────────────────────────────────────────────────────
type TransferRow = {
  id: string; transfer_no: string; from_site_id: string; to_site_id: string; note: string | null;
  status: "posted" | "cancelled"; created_at: string; cancelled_at: string | null; cancel_reason: string | null; performed_by: string | null;
  stock_transfer_units: UnitRef[];
};

const TRANSFER_WORD = { posted: "Confirmed", cancelled: "Cancelled" } as const;

export function StockTransfers() {
  const [display, setDisplay] = useState("table");
  const qc = useQueryClient();
  const sites = useSites();
  const list = useQuery({ queryKey: ["stock-moves", "transfers"], queryFn: () => apiFetch<{ transfers: TransferRow[] }>(`${BASE}/transfers`) });
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [units, setUnits] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState<TransferRow | null>(null);
  const [viewing, setViewing] = useState<TransferRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  useOpenFromUrl(list.data?.transfers, (r) => r.transfer_no, setViewing);
  const printIt = (r: TransferRow) => printDocument({
    title: "Stock Transfer", docNo: r.transfer_no, date: fmtDate(r.created_at),
    facts: [
      ["From Warehouse", siteName(sites.data?.sites, r.from_site_id)], ["To Warehouse", siteName(sites.data?.sites, r.to_site_id)],
      ["Status", TRANSFER_WORD[r.status]], ["Created By", r.performed_by ?? ""], ["Notes", r.cancel_reason ?? r.note ?? ""],
    ],
    tables: [{
      title: "Items", headers: ["SKU", "Unit ID", "Qty"], numeric: ["Qty"],
      rows: r.stock_transfer_units.map((u) => [u.ops_stock_items?.sku ?? "", u.ops_stock_items?.unit_code ?? "", "1"]),
    }],
    signatures: ["Released by", "Received by"],
  });
  const done = () => void qc.invalidateQueries({ queryKey: ["stock-moves"] });
  const save = useMutation({
    mutationFn: () => post("/transfers", { fromSiteId: from, toSiteId: to, unitIds: units, note }),
    onSuccess: () => { setOpen(false); setUnits([]); setNote(""); done(); },
  });
  const cancel = useMutation({
    mutationFn: () => post(`/transfers/${cancelling?.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => { setCancelling(null); setCancelReason(""); done(); },
  });
  const [statusTab, setStatusTab] = useState("all");
  const transferHint = !from ? "Pick the From Warehouse."
    : !to ? "Pick the To Warehouse."
    : from === to ? "From and To Warehouse must differ."
    : units.length === 0 ? "Pick at least one Unit." : null;
  const columns = useMemo<DataGridColumn<TransferRow>[]>(() => [
    { key: "no", label: "Transfer No.", width: 170, accessor: (r) => r.transfer_no },
    { key: "date", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "from", label: "From", width: 180, accessor: (r) => siteName(sites.data?.sites, r.from_site_id), filterType: "enum" },
    { key: "to", label: "To", width: 180, accessor: (r) => siteName(sites.data?.sites, r.to_site_id), filterType: "enum" },
    { key: "units", label: "Units", width: 280, accessor: (r) => unitCodes(r.stock_transfer_units) },
    { key: "lines", label: "Lines", width: 80, align: "right", numberValue: (r) => r.stock_transfer_units.length, accessor: (r) => r.stock_transfer_units.length },
    { key: "status", label: "Status", width: 120, accessor: (r) => TRANSFER_WORD[r.status], filterType: "enum" },
    { key: "reason", label: "Notes", width: 220, accessor: (r) => r.cancel_reason ?? r.note ?? "" },
    { key: "by", label: "Created By", width: 160, defaultHidden: true, accessor: (r) => r.performed_by ?? "" },
    { key: "act", label: "", width: 220, exportValue: () => "",
      accessor: (r) => (
        <span className="flex gap-2">
          <Button variant="neutral" onClick={() => setViewing(r)}>Open</Button>
          {r.status === "posted" && <Button variant="neutral" onClick={() => setCancelling(r)}>Cancel</Button>}
        </span>
      ) },
  ], [sites.data]);

  return (
    <Page word="Stock Transfer" testId="stock-transfers">
      {list.isSuccess && <KpiRow items={[
        { label: "Total Transfers", value: list.data.transfers.length, hint: "Stock Transfers on this list" },
        { label: "Line count", value: list.data.transfers.reduce((n, r) => n + r.stock_transfer_units.length, 0), hint: "Units across those transfers" },
        { label: "Posted", value: list.data.transfers.filter((r) => r.status === "posted").length, hint: "Not cancelled" },
      ]} />}
      {list.isError ? <LoadError message="The stock transfers could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={(list.data?.transfers ?? []).filter((r) => statusTab === "all" || r.status === statusTab)} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.warehouse.stock-transfers.v1" appearance="reference" exportName="Stock Transfer"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search transfer or Unit ID…"
            onRowClick={setViewing}
            contextMenu={(r) => documentRowMenu({
              view: () => setViewing(r), print: () => printIt(r),
              more: r.status === "posted" ? [{ label: "Cancel", onClick: () => setCancelling(r) }] : [],
            })}
            {...cardsProps<TransferRow>(display, (r) => r.id, setViewing, (r) => ({ title: r.transfer_no, facts: [
              ["Date", fmtDate(r.created_at)], ["Status", TRANSFER_WORD[r.status]],
              ["From", siteName(sites.data?.sites, r.from_site_id)], ["To", siteName(sites.data?.sites, r.to_site_id)], ["Lines", r.stock_transfer_units.length],
            ] }))}
            toolbarStart={<Tabs variant="segmented" label="Status" value={statusTab} onValueChange={setStatusTab} tabs={[
              { value: "all", label: `All (${list.data?.transfers.length ?? 0})` },
              { value: "posted", label: `Confirmed (${list.data?.transfers.filter((r) => r.status === "posted").length ?? 0})` },
              { value: "cancelled", label: `Cancelled (${list.data?.transfers.filter((r) => r.status === "cancelled").length ?? 0})` },
            ]} />}
            toolbarEnd={<><TableCardsTabs label="Stock Transfer" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Stock Transfer</Button></>}
            emptyMessage="No stock transfers yet." />
        </ListPageShell>
      )}
      <Modal open={open} onOpenChange={setOpen} width="wide" title="New Stock Transfer"
        description="The Units move as soon as you save."
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={save.isPending} disabled={!from || !to || from === to || units.length === 0} onClick={() => save.mutate()}>Save</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <SiteSelect id="tr-from" label="From Warehouse" value={from} onChange={(v) => { setFrom(v); setUnits([]); }} sites={sites.data?.sites ?? []} />
          <SiteSelect id="tr-to" label="To Warehouse" value={to} onChange={setTo} sites={(sites.data?.sites ?? []).filter((s) => s.id !== from)} />
          <Textarea id="tr-note" label="Notes" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <UnitPicker siteId={from} picked={units} onChange={setUnits} allowReserved />
          {transferHint && <p className="text-body text-c-muted" role="status">Save is off: {transferHint}</p>}
          {save.isError && <FieldError>{errorText(save.error)}</FieldError>}
        </div>
      </Modal>
      <Modal open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)} width="wide" title={viewing?.transfer_no ?? "Stock Transfer"}
        footer={<>
          <Button variant="neutral" onClick={() => setViewing(null)}>Close</Button>
          {viewing && <Button variant="neutral" icon="print" onClick={() => printIt(viewing)}>{PRINT}</Button>}
          {viewing?.status === "posted" && <Button variant="neutral" onClick={() => { setCancelling(viewing); setViewing(null); }}>Cancel</Button>}
        </>}>
        {viewing && (
          <div className="flex flex-col gap-4">
            <DetailSection title="Transfer">
              <Facts facts={[
                ["From Warehouse", siteName(sites.data?.sites, viewing.from_site_id)],
                ["To Warehouse", siteName(sites.data?.sites, viewing.to_site_id)],
                ["Transfer Date", fmtDate(viewing.created_at)],
                ["Status", TRANSFER_WORD[viewing.status]],
                ["Created By", viewing.performed_by ?? ""],
                ["Notes", viewing.cancel_reason ?? viewing.note ?? ""],
              ]} />
            </DetailSection>
            <DetailSection title="Items">
              <DocumentTable label="Items"
                columns={[{ key: "sku", label: "SKU" }, { key: "unit", label: "Unit ID" }, { key: "qty", label: "Qty", numeric: true }]}
                rows={viewing.stock_transfer_units.map((u, i) => ({
                  key: String(i), cells: { sku: u.ops_stock_items?.sku ?? "", unit: u.ops_stock_items?.unit_code ?? "", qty: 1 },
                }))} />
            </DetailSection>
            <DocHistory events={[
              { at: viewing.created_at, word: "Created", who: viewing.performed_by },
              { at: viewing.cancelled_at, word: `Cancelled${viewing.cancel_reason ? `: ${viewing.cancel_reason}` : ""}` },
            ]} />
          </div>
        )}
      </Modal>
      <Modal open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)} title={`Cancel ${cancelling?.transfer_no ?? ""}`}
        description="The Units move back to the From Warehouse."
        footer={<>
          <Button variant="neutral" onClick={() => setCancelling(null)}>Close</Button>
          <Button variant="primary" loading={cancel.isPending} disabled={!cancelReason.trim()} onClick={() => cancel.mutate()}>Cancel transfer</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <Textarea id="tr-cancel-reason" label="Reason" required rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          {cancel.isError && <FieldError>{errorText(cancel.error)}</FieldError>}
        </div>
      </Modal>
    </Page>
  );
}

// ── Stock Take ────────────────────────────────────────────────────────────────
type CountRow = {
  id: string; count_no: string; warehouse_id: string; blind: boolean; note: string | null;
  status: "open" | "posted"; created_at: string; posted_at: string | null;
  stock_adjustments: { adjustment_no: string }[];
  performed_by: string | null;
  /** Null while a blind count is open: the counter must not learn how many Units to expect. */
  lines: number | null; counted: number | null; variance: number | null;
};
type CountDetail = {
  count: { id: string; count_no: string; warehouse_id: string; note: string | null; blind: boolean; status: "open" | "posted"; extras: { sku: string; qty: number }[] };
  units: { found: boolean | null; ops_stock_items: { id: string; unit_code: string; sku: string } | null }[];
  foundCodes: string[];
};

/** Blind and open: the API returned no Units, so only what was counted can print. */
function countDoc(d: CountDetail, codes: string[], extras: PlusLine[], site: string, when: string | null) {
  const listed = d.units.flatMap((u) => (u.ops_stock_items ? [u.ops_stock_items] : []));
  const rows = listed.length > 0
    ? listed.map((u) => [u.unit_code, u.sku, codes.includes(u.unit_code) ? "Yes" : ""])
    : codes.map((code) => [code, "", "Yes"]);
  return {
    title: "Stock Take", docNo: d.count.count_no, date: when ? fmtDate(when) : "",
    facts: [["Warehouse", site], ["Status", d.count.status === "open" ? "Open" : "Confirmed"], ["Blind count", d.count.blind ? "Yes" : "No"], ["Note", d.count.note ?? ""]] as [string, string][],
    tables: [
      { title: "Units", headers: ["Unit ID", "SKU", "Counted"], rows },
      { title: "Goods with no Unit ID", headers: ["SKU", "Qty"], numeric: ["Qty"], rows: extras.map((e) => [e.sku, e.qty]) },
    ],
    signatures: ["Counted by", "Checked by"],
  };
}

function CountSheet({ id, row, sites, onClose }: { id: string; row: CountRow | undefined; sites: Site[] | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stock-moves", "count", id], queryFn: () => apiFetch<CountDetail>(`${BASE}/counts/${id}`) });
  const [found, setFound] = useState<string[] | null>(null);
  // Blind count: keep what was typed as raw text, so a scanner's Enter is not eaten. Split only on save.
  const [rawCodes, setRawCodes] = useState<string | null>(null);
  const [confirmingPost, setConfirmingPost] = useState(false);
  const [extras, setExtras] = useState<PlusLine[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ ok: string | null; error: string | null }>({ ok: null, error: null });
  const codes = rawCodes !== null ? rawCodes.split(/\s+/).filter(Boolean) : found ?? q.data?.foundCodes ?? [];
  const lines = extras ?? (q.data?.count.extras ?? []).map((e) => ({ sku: e.sku, qty: String(e.qty) }));
  const record = useMutation({
    mutationFn: (postIt: boolean) => post(`/counts/${id}`, { found: codes, extras: plusPayload(lines), post: postIt }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["stock-moves"] }); onClose(); },
  });
  const c = q.data?.count;
  const isOpen = c?.status === "open";
  const [lineFilter, setLineFilter] = useState("");
  const allCodes = (q.data?.units ?? []).flatMap((u) => (u.ops_stock_items ? [u.ops_stock_items.unit_code] : []));
  const needle = lineFilter.trim().toLowerCase();
  // Units on the sheet that have not been counted: Post writes these off.
  const uncounted = (q.data?.units ?? []).filter((u) => u.ops_stock_items && !codes.includes(u.ops_stock_items.unit_code)).length;
  const blindOpen = Boolean(c?.blind && isOpen);
  // Fills the sheet on screen only; nothing is saved until Save or Post.
  const uploadSheet = async (file: File) => {
    try {
      const sheet = await readCountedFile(file, blindOpen ? null : allCodes);
      if (blindOpen) setRawCodes(sheet.codes.join("\n")); else setFound(sheet.codes);
      if (sheet.extras) setExtras(sheet.extras);
      setUpload({ ok: `${sheet.codes.length} Units counted from ${file.name}. Check them, then Save or Post.${sheet.unknown.length ? ` Not on this Stock Take, left out: ${sheet.unknown.join(", ")}.` : ""}`, error: null });
    } catch (e) {
      setUpload({ ok: null, error: errorText(e) });
    }
  };
  const exportSheet = () => {
    const listed = (q.data?.units ?? []).flatMap((u) => (u.ops_stock_items ? [u.ops_stock_items] : []));
    const units = listed.length > 0
      ? listed.map((u) => ({ code: u.unit_code, sku: u.sku, counted: codes.includes(u.unit_code) }))
      : codes.map((code) => ({ code, sku: "", counted: true }));
    downloadCountSheet(c!.count_no, units, lines).catch((e: unknown) => setUpload({ ok: null, error: errorText(e) }));
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} width="wide" title={c ? `Stock Take ${c.count_no}` : "Stock Take"}
      description={isOpen ? "Post writes off every Unit not counted and adds the goods with no Unit ID." : undefined}
      footer={<>
        <Button variant="neutral" onClick={onClose}>Close</Button>
        {q.data && <Button variant="neutral" icon="print" onClick={() => printDocument(countDoc(q.data, codes, lines, siteName(sites, q.data.count.warehouse_id), row?.created_at ?? null))}>{PRINT}</Button>}
        {c && <Button variant="neutral" onClick={exportSheet}>Export Excel</Button>}
        {isOpen && <Button variant="neutral" onClick={() => fileRef.current?.click()}>Upload counted sheet</Button>}
        {isOpen && <Button variant="neutral" loading={record.isPending && record.variables === false} onClick={() => record.mutate(false)}>Save</Button>}
        {isOpen && <Button variant="primary" loading={record.isPending && record.variables === true} onClick={() => setConfirmingPost(true)}>Post</Button>}
      </>}>
      {q.isError && <LoadError message="The Stock Take could not be loaded." onRetry={() => void q.refetch()} />}
      {c && (
        <div className="flex flex-col gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" aria-label="Upload counted sheet"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadSheet(f); }} />
          {upload.ok && <p className="text-body text-c-muted" role="status">{upload.ok}</p>}
          {upload.error && <FieldError>{upload.error}</FieldError>}
          <DetailSection title="Variance Summary">
            {c.blind && isOpen
              ? <Facts facts={[["Counted", codes.length], ["Variance", "Hidden"]]} />
              : <Facts facts={[
                  ["Total lines", allCodes.length],
                  ["Counted", allCodes.filter((x) => codes.includes(x)).length],
                  ["Untouched", uncounted],
                  ["Net", lines.reduce((n, l) => n + (Number(l.qty) || 0), 0) - uncounted],
                ]} />}
          </DetailSection>
          {!c.blind && isOpen && (
            <div className="flex flex-wrap items-end gap-2">
              <Input id="count-filter" label="Filter by code / SKU" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} />
              <Button variant="neutral" onClick={() => setFound(allCodes)}>Fill all to system</Button>
            </div>
          )}
          {c.blind && isOpen ? (
            <Textarea id="count-codes" label="Unit IDs counted" hint="One Unit ID per line, or scan them." rows={8}
              value={rawCodes ?? codes.join("\n")} onChange={(e) => setRawCodes(e.target.value)} />
          ) : (
            <div role="group" className="max-h-72 overflow-auto rounded-control border border-c-line p-2" aria-label="Units">
              {(q.data?.units ?? []).filter((u) => !needle || `${u.ops_stock_items?.unit_code} ${u.ops_stock_items?.sku}`.toLowerCase().includes(needle)).map((u) => u.ops_stock_items && (
                <Checkbox key={u.ops_stock_items.id} id={`count-${u.ops_stock_items.id}`} disabled={!isOpen}
                  label={`${u.ops_stock_items.unit_code} · ${u.ops_stock_items.sku}`}
                  checked={codes.includes(u.ops_stock_items.unit_code)}
                  onCheckedChange={(on) => {
                    const code = u.ops_stock_items!.unit_code;
                    setFound(on ? [...codes, code] : codes.filter((x) => x !== code));
                  }} />
              ))}
            </div>
          )}
          <p className="text-body text-c-muted">{codes.length} Units counted</p>
          <p className="text-body font-semibold">Goods with no Unit ID</p>
          {isOpen ? <PlusLines lines={lines} onChange={setExtras} /> : <p className="text-body">{lines.map((l) => `${l.sku} ×${l.qty}`).join(", ")}</p>}
          {!confirmingPost && record.isError && <FieldError>{errorText(record.error)}</FieldError>}
          {row && <RelationshipMap current={{ kind: "Stock Take", no: row.count_no }}
            links={row.stock_adjustments.map((a) => ({ kind: "Stock Adjustment", no: a.adjustment_no, tab: "stock-adjustments" }))} />}
          {row && <DocHistory events={[{ at: row.created_at, word: "Started", who: row.performed_by }, { at: row.posted_at, word: "Posted" }]} />}
        </div>
      )}
      <ConfirmActionDialog open={confirmingPost} title="Post this Stock Take?"
        message={c?.blind
          ? `Every Unit at this Warehouse that is not in your ${codes.length} counted will be written off. This cannot be undone.`
          : `${uncounted} ${uncounted === 1 ? "Unit" : "Units"} will be written off. This cannot be undone.`}
        confirmLabel="Post Stock Take" pending={record.isPending} error={record.isError ? errorText(record.error) : null}
        onConfirm={() => record.mutate(true)} onCancel={() => setConfirmingPost(false)} />
    </Modal>
  );
}

export function StockTakes() {
  const qc = useQueryClient();
  const sites = useSites();
  const list = useQuery({ queryKey: ["stock-moves", "counts"], queryFn: () => apiFetch<{ counts: CountRow[] }>(`${BASE}/counts`) });
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState("all");
  const [display, setDisplay] = useState("table");
  useOpenFromUrl(list.data?.counts, (r) => r.count_no, (r) => setSheet(r.id));
  const printRow = (r: CountRow) => printDocument(async () => {
    const d = await apiFetch<CountDetail>(`${BASE}/counts/${r.id}`);
    return countDoc(d, d.foundCodes, d.count.extras.map((e) => ({ sku: e.sku, qty: String(e.qty) })), siteName(sites.data?.sites, r.warehouse_id), r.created_at);
  });
  const start = useMutation({
    mutationFn: () => post<{ id: string }>("/counts", { siteId, blind, note }),
    onSuccess: (r) => { setOpen(false); setNote(""); void qc.invalidateQueries({ queryKey: ["stock-moves"] }); setSheet(r.id); },
  });
  const columns = useMemo<DataGridColumn<CountRow>[]>(() => [
    { key: "no", label: "Take No.", width: 170, accessor: (r) => r.count_no },
    { key: "date", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "site", label: "Warehouse", width: 180, accessor: (r) => siteName(sites.data?.sites, r.warehouse_id), filterType: "enum" },
    { key: "blind", label: "Blind count", width: 110, accessor: (r) => (r.blind ? "Yes" : "No"), filterType: "enum" },
    { key: "by", label: "Created By", width: 160, accessor: (r) => r.performed_by ?? "" },
    { key: "lines", label: "Lines", width: 80, align: "right", accessor: (r) => r.lines ?? "Hidden" },
    { key: "variance", label: "Variance", width: 90, align: "right", accessor: (r) => r.variance ?? "Hidden" },
    { key: "status", label: "Status", width: 110, accessor: (r) => (r.status === "open" ? "Open" : "Confirmed"), filterType: "enum" },
    { key: "adj", label: "Stock Adjustment", width: 180, accessor: (r) => r.stock_adjustments.map((a) => a.adjustment_no).join(", ") },
    { key: "note", label: "Note", width: 220, accessor: (r) => r.note ?? "" },
  ], [sites.data]);

  return (
    <Page word="Stock Take" testId="stock-takes">
      {list.isSuccess && <KpiRow items={[
        { label: "Total Takes", value: list.data.counts.length, hint: "Stock Takes on this list" },
        { label: "Open", value: list.data.counts.filter((r) => r.status === "open").length, hint: "Not posted yet" },
        { label: "Lines counted", value: list.data.counts.reduce((n, r) => n + (r.counted ?? 0), 0), hint: "Units ticked as found; open blind counts left out" },
        { label: "Net variance", value: list.data.counts.reduce((n, r) => n + (r.variance ?? 0), 0), hint: "Added less written off; open blind counts left out" },
      ]} />}
      {list.isError ? <LoadError message="The stock takes could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={(list.data?.counts ?? []).filter((r) => statusTab === "all" || r.status === statusTab)} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.warehouse.stock-takes.v1" appearance="reference" exportName="Stock Take"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search take, warehouse, notes…"
            onRowClick={(r) => setSheet(r.id)}
            contextMenu={(r) => documentRowMenu({ view: () => setSheet(r.id), print: () => printRow(r) })}
            {...cardsProps<CountRow>(display, (r) => r.id, (r) => setSheet(r.id), (r) => ({ title: r.count_no, facts: [
              ["Date", fmtDate(r.created_at)], ["Status", r.status === "open" ? "Open" : "Confirmed"],
              ["Warehouse", siteName(sites.data?.sites, r.warehouse_id)], ["Variance", r.variance ?? "Hidden"],
            ] }))}
            toolbarStart={<Tabs variant="segmented" label="Status" value={statusTab} onValueChange={setStatusTab} tabs={[
              { value: "all", label: `All (${list.data?.counts.length ?? 0})` },
              { value: "open", label: `Open (${list.data?.counts.filter((r) => r.status === "open").length ?? 0})` },
              { value: "posted", label: `Confirmed (${list.data?.counts.filter((r) => r.status === "posted").length ?? 0})` },
            ]} />}
            toolbarEnd={<><TableCardsTabs label="Stock Take" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Stock Take</Button></>}
            emptyMessage="No stock takes yet." />
        </ListPageShell>
      )}
      <Modal open={open} onOpenChange={setOpen} title="New Stock Take"
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={start.isPending} disabled={!siteId} onClick={() => start.mutate()}>Start</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <SiteSelect id="count-site" label="Warehouse" value={siteId} onChange={setSiteId} sites={sites.data?.sites ?? []} />
          <Checkbox id="count-blind" label="Blind count" checked={blind} onCheckedChange={setBlind} />
          <Textarea id="count-note" label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {start.isError && <FieldError>{errorText(start.error)}</FieldError>}
        </div>
      </Modal>
      {sheet && <CountSheet key={sheet} id={sheet} row={list.data?.counts.find((r) => r.id === sheet)} sites={sites.data?.sites} onClose={() => setSheet(null)} />}
    </Page>
  );
}
