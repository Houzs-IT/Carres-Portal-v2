import { GOODS_ABSENCE_WORDS } from "@carres/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  MIN_JUDGED_POS,
  SCORECARD_UNKNOWN_TEXT,
  scorecardHeadline,
  supplierCreateInput,
  type ScorecardRate,
  type SupplierScorecard,
} from "@carres/shared";
import {
  qk,
  useAllSkuSupplierOffers,
  useCatalog,
  useCreateSupplier,
  useOperationSuppliers,
  usePurchasingSettings,
  useSetSupplierChannel,
  useSetSupplierTermsDays,
} from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import Modal from "@/components/kit/Modal";
import Select from "@/components/kit/Select";
import { buildSupplierItems, priceListCsv, readPriceList, type PriceListRow } from "./supplier-items";
import { parseCsv } from "@/lib/csv";
import { downloadCsv } from "@/lib/sku-csv";
import Input from "@/components/kit/Input";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Loading from "@/components/kit/Loading";
import Tabs from "@/components/kit/Tabs";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";

/**
 * Phase 10 · Operation · Suppliers — `reference/proto/principal-suppliers.jsx`
 * pixel parity. 2-col grid of clickable supplier cards; click opens a 480-wide
 * right-side drawer with recent 12 POs.
 *
 * Distinct from operation's CRUD suppliers admin (procurement-side): this is
 * the read-only roster/oversight view. Endpoint /api/operation/suppliers-overview.
 *
 * 2026-05-19 — moved from PrincipalSuppliers.
 *
 * ── R5 · the scorecard lives here (2026-07-27) ──────────────────────────────
 * `docs/receiving-claim-execution-queue.md`: "Lives on the Suppliers page …
 * Done when: next supplier negotiation opens with numbers, not memory."
 *
 * Every figure is computed by `computeSupplierScorecard` in the shared module
 * and arrives on the row — this file renders the answer and does no arithmetic
 * of its own, so the card and the drawer can never disagree.
 *
 * TWO deliberate absences, both of them the point:
 *
 *  · **No colour on any figure.** UI-KIT reserves colour for action, selection,
 *    status and alert. A percentage is none of those until somebody sets a
 *    target, and NOBODY HAS: painting 82% amber would be the portal inventing
 *    a supplier policy Jess never ruled — the same trap R2 and R3 each refused.
 *    When a target exists it becomes a status and earns its colour.
 *  · **No score where there are no records.** Live prod holds ten suppliers and
 *    zero purchase orders, so a naive build opens ten cards with `0%` against
 *    ten names that never failed. Where a rate is withheld the card says WHY
 *    and what changes it, which is the empty-state law, not decoration.
 */

type SupplierRow = {
  id: string;
  name: string;
  contact: string | null;
  contactEmail: string | null;
  leadTime: string | null;
  kind: "own_logistics" | "factory_pickup" | null;
  catCovered: string[];
  portalEnabled: boolean;
  slug: string | null;
  termsDays: number | null;
  openPos: number;
  receivedPos: number;
  totalPos: number;
  scorecard: SupplierScorecard;
};

type PoRow = {
  id: string;
  status: string;
  supStatus: string | null;
  etaDate: string | null;
  placedAt: string | null;
};

type OverviewResponse = {
  suppliers: SupplierRow[];
  scorecardWindow?: { days: number; asOf: string; truncated: boolean };
};

/** The figure, or nothing — the reason prints right under it. Never a zero nobody earned. */
function rateText(r: ScorecardRate): string {
  return r.known ? `${r.pct}%` : "";
}

/** Why a figure is missing — the sentence goes under the empty figure so the reader is
 *  never left guessing whether the supplier is perfect or unmeasured. */
function rateWhy(r: ScorecardRate): string | null {
  return r.known ? null : SCORECARD_UNKNOWN_TEXT[r.reason];
}

/* Houzs Suppliers.tsx:168-232 where Carres holds the field. Code, Phone, State and Status have no column. */
const SUPPLIER_COLUMNS: DataGridColumn<SupplierRow>[] = [
  { key: "name", label: "Name", width: 200, wrap: true, accessor: (s) => s.name },
  { key: "category", label: "Supply Category", width: 200, wrap: true, accessor: (s) => s.catCovered.join(" · ") },
  { key: "contact", label: "Contact", width: 200, wrap: true, accessor: (s) => s.contactEmail ?? s.contact ?? "" },
  { key: "terms", label: "Payment Terms", width: 130, defaultHidden: true, accessor: (s) => (s.termsDays == null ? "" : `${s.termsDays} days`) },
  { key: "kind", label: "Pickup", width: 130, accessor: (s) => (s.kind === "own_logistics" ? "Own Logistics" : s.kind === "factory_pickup" ? "Factory Pickup" : "") },
  { key: "open", label: "Open POs", width: 90, align: "right", accessor: (s) => String(s.openPos), numberValue: (s) => s.openPos },
  { key: "received", label: "Received", width: 90, align: "right", accessor: (s) => String(s.receivedPos), numberValue: (s) => s.receivedPos },
  { key: "on_time", label: "On time", width: 90, align: "right", accessor: (s) => rateText(s.scorecard.onTime) },
  { key: "faulty", label: "Damaged or wrong", width: 130, align: "right", accessor: (s) => rateText(s.scorecard.faulty) },
  { key: "record", label: "Delivery record", width: 260, wrap: true, accessor: (s) => scorecardHeadline(s.scorecard) },
];

export default function OperationSuppliers() {
  const { data, isLoading, isError, refetch } = useQuery<OverviewResponse>({
    queryKey: qk.operation.suppliersOverview(),
    queryFn: () => apiFetch("/api/operation/suppliers-overview"),
  });
  const suppliers = data?.suppliers ?? [];
  const win = data?.scorecardWindow;
  const [open, setOpen] = useState<SupplierRow | null>(null);
  const [category, setCategory] = useState("all");
  const role = useAuth((s) => s.role);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [params, setParams] = useSearchParams();
  const detailId = params.get("supplier");
  const showDetail = (id: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set("supplier", id);
    else next.delete("supplier");
    return next;
  });
  const categories = [...new Set(suppliers.flatMap((s) => s.catCovered))].sort();
  // No ModuleHeader on this page, so it names the browser tab itself (same as ModuleHeader).
  useEffect(() => {
    document.title = "Suppliers · Carres";
    return () => {
      document.title = "Carres Portal";
    };
  }, []);

  if (detailId && data) {
    const found = suppliers.find((s) => s.id === detailId);
    return <SupplierDetail supplier={found ?? null} onBack={() => showDetail(null)} />;
  }

  return (
    <div className="px-9 py-8 pb-14">
      {role === "principal" && (
        <div className="float-right">
          <Button variant="primary" onClick={() => setAdding(true)} data-testid="supplier-new">New Supplier</Button>
        </div>
      )}
      <div className="mb-[22px]">
        <div className="kicker">HQ · Network</div>
        {/* Desktop: the shell header prints the page's h1. Phone: OperationApp's phone bar prints none, so this one does. */}
        <h1 className="sr-only md:hidden">Suppliers</h1>
        <h2 className="text-page font-display mt-1.5">
          Suppliers
        </h2>
        {data && (
          <div className="text-body text-base-600 mt-1.5">
            {suppliers.length} active · upstream of stock pipeline.
          </div>
        )}
        {win && (
          <div className="text-meta text-base-500 mt-1">
            Delivery record covers the last {win.days} days, to {fmtDate(win.asOf)}.
            {win.truncated
              ? " Older POs beyond the scan limit are not counted."
              : ""}
          </div>
        )}
      </div>

      {isLoading && <Loading variant="skeleton" label="Loading suppliers" />}

      {isError && !data && (
        <div role="alert">
          <EmptyState
            title="Could not be loaded"
            detail="The supplier list did not arrive."
            action={<Button variant="neutral" onClick={() => void refetch()}>Try again</Button>}
          />
        </div>
      )}

      {data && suppliers.length === 0 && (
        <div className="text-body text-base-500">No suppliers yet.</div>
      )}

      {data && suppliers.length > 0 && (
        <>
          <div className="mb-2">
            <Tabs label="Supply Category" value={category} onValueChange={setCategory}
              tabs={[{ value: "all", label: "All supply categories" }, ...categories.map((c) => ({ value: c, label: c }))]} />
          </div>
          <DataGrid rows={suppliers.filter((s) => category === "all" || s.catCovered.includes(category))}
            columns={SUPPLIER_COLUMNS} rowKey={(s) => s.id} rowTestId={(s) => `supplier-row-${s.id}`}
            storageKey="carres.operation.suppliers.v1" appearance="reference" fillColumn="name" groupBanner={false}
            exportName="Suppliers" searchPlaceholder="Search by name / contact…" emptyMessage="No suppliers match."
            onRowClick={setOpen}
            selectable={{
              selectedKeys: picked as Set<string>,
              onToggle: (key) => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              }),
              onToggleAll: (keys, allSelected) => setPicked((prev) => {
                const next = new Set(prev);
                for (const key of keys) {
                  if (allSelected) next.delete(key);
                  else next.add(key);
                }
                return next;
              }),
            }}
            selectionPrimary={<Button size="sm" onClick={() => setBatching(true)} data-testid="supplier-batch-edit">Batch edit</Button>} />
        </>
      )}

      {open && <SupplierDrawer supplier={open} onClose={() => setOpen(null)} onOpenDetail={() => { setOpen(null); showDetail(open.id); }} />}
      {adding && <NewSupplierModal onClose={() => setAdding(false)} />}
      {batching && <BatchEditModal supplierIds={[...picked]} onClose={() => setBatching(false)} onDone={() => setPicked(new Set())} />}
    </div>
  );
}

const CATEGORIES = ["mattress", "bedframe", "sofa"] as const;
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const notSaved = (e: unknown) => (e instanceof Error ? e.message : "Not saved. Try again.");

/**
 * New Supplier (Houzs Suppliers.tsx). Same fields, schema and principal-only
 * POST as the catalog's add-supplier form (catalog/tabs/NewSkuModal.tsx).
 */
function NewSupplierModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateSupplier();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"own_logistics" | "factory_pickup">("factory_pickup");
  const [cats, setCats] = useState<(typeof CATEGORIES)[number][]>([]);
  const [days, setDays] = useState<Record<string, string>>({});
  const [offDays, setOffDays] = useState<number[]>([0]);
  const input = supplierCreateInput.safeParse({
    name, kind, catCovered: cats, offDays,
    productionDays: cats.map((category) => ({ category, workingDays: Number(days[category]) })),
  });
  const save = () => {
    if (!input.success) return;
    create.mutateAsync(input.data)
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.operation.suppliersOverview() });
        toast.success("Saved");
        onClose();
      })
      .catch((e: unknown) => toast.error(notSaved(e)));
  };
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="New Supplier"
      footer={<Button variant="primary" disabled={!input.success || create.isPending} onClick={save} data-testid="supplier-new-save">Add Supplier</Button>}>
      <div className="flex flex-col gap-3">
        <Input id="supplier-new-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select id="supplier-new-kind" label="Pickup" value={kind} onValueChange={(v) => setKind(v as typeof kind)}
          options={[{ value: "own_logistics", label: "Own Logistics" }, { value: "factory_pickup", label: "Factory Pickup" }]} />
        <fieldset>
          <legend className="text-meta text-kit-slate-11 mb-1">Supply Category</legend>
          <div className="flex gap-3">
            {CATEGORIES.map((c) => (
              <label key={c} className="text-meta capitalize">
                <input type="checkbox" checked={cats.includes(c)}
                  onChange={() => setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))} /> {c}
              </label>
            ))}
          </div>
        </fieldset>
        {cats.map((c) => (
          <Input key={c} id={`supplier-new-days-${c}`} label={`${c[0].toUpperCase()}${c.slice(1)} · Production Days`} type="number" min={1} max={180} step={1}
            value={days[c] ?? ""} onChange={(e) => setDays((prev) => ({ ...prev, [c]: e.target.value }))} />
        ))}
        <fieldset>
          <legend className="text-meta text-kit-slate-11 mb-1">Supplier work week</legend>
          <div className="flex flex-wrap gap-2">
            {WEEK.map((label, day) => (
              <label key={day} className="text-meta">
                <input type="checkbox" checked={!offDays.includes(day)}
                  onChange={() => setOffDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

const KEEP = "keep";

/**
 * Batch edit (Houzs Suppliers.tsx bulk bar), on the two fields Carres holds that
 * have one-supplier writes: each row goes through the existing door with its own
 * role gate. Channel needs Purchasing Settings edit, so it only shows to those who hold it.
 */
function BatchEditModal({ supplierIds, onClose, onDone }: { supplierIds: string[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const setTerms = useSetSupplierTermsDays();
  const setChannel = useSetSupplierChannel();
  const settings = usePurchasingSettings();
  const [terms, setTermsDraft] = useState("");
  const [channel, setChannelDraft] = useState(KEEP);
  const [busy, setBusy] = useState(false);
  const days = terms.trim() === "" ? null : Number(terms);
  const termsOk = days === null || (Number.isInteger(days) && days >= 0 && days <= 365);
  const canChannel = settings.data?.canEdit === true;
  const save = async () => {
    setBusy(true);
    const results = await Promise.allSettled(supplierIds.map(async (supplierId) => {
      if (days !== null) await setTerms.mutateAsync({ supplierId, days });
      if (canChannel && channel !== KEEP) await setChannel.mutateAsync({ supplierId, kind: "poSendChannel", text: channel });
    }));
    setBusy(false);
    void qc.invalidateQueries({ queryKey: qk.operation.suppliersOverview() });
    const saved = results.filter((r) => r.status === "fulfilled").length;
    if (saved === results.length) {
      toast.success(`${saved} suppliers saved`);
      onDone();
      onClose();
    } else {
      toast.error(`${saved} of ${results.length} suppliers saved`);
    }
  };
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Batch edit"
      footer={<Button variant="primary" loading={busy} disabled={busy || !termsOk || (days === null && channel === KEEP)} onClick={() => void save()} data-testid="supplier-batch-apply">Apply</Button>}>
      <div className="flex flex-col gap-3">
        <Input id="supplier-batch-terms" label="Payment Terms (days)" type="number" min={0} max={365} step={1} value={terms}
          placeholder="Leave as it is" error={termsOk ? undefined : "0 to 365"} onChange={(e) => setTermsDraft(e.target.value)} />
        {canChannel && (
          <Select id="supplier-batch-channel" label="Channel" value={channel} onValueChange={setChannelDraft}
            options={[{ value: KEEP, label: "Leave as it is" }, { value: "email", label: "Email" }, { value: "whatsapp", label: "WhatsApp" }]} />
        )}
      </div>
    </Modal>
  );
}

/**
 * Supplier detail (Houzs SupplierDetail.tsx). Every tab reads what Carres already
 * holds. Lead Times shows the Purchasing Settings numbers and sends edits back there,
 * so there is one place to change them. Items carries no cost.
 */
function SupplierDetail({ supplier, onBack }: { supplier: SupplierRow | null; onBack: () => void }) {
  const [tab, setTab] = useState("details");
  const back = <Button variant="ghost" size="sm" onClick={onBack} data-testid="supplier-detail-back">Back to Suppliers</Button>;
  if (!supplier) return <div className="px-9 py-8"><EmptyState title="No suppliers match." action={back} /></div>;
  return (
    <div className="px-9 py-8 pb-14" data-testid="supplier-detail">
      {back}
      <h2 className="text-page font-display mt-2 mb-3">{supplier.name}</h2>
      <Tabs label={supplier.name} value={tab} onValueChange={setTab}
        tabs={[{ value: "details", label: "Details" }, { value: "lead", label: "Lead Times" }, { value: "items", label: "Items" }, { value: "pos", label: "Purchase Orders" }]} />
      <div className="mt-4 max-w-[720px]">
        {tab === "details" && (
          <>
            <div className="text-body text-base-800 mb-4">{supplier.contactEmail ?? supplier.contact ?? GOODS_ABSENCE_WORDS.notRecorded}</div>
            <TermsDaysField supplier={supplier} />
            <ScorecardBlock sc={supplier.scorecard} />
          </>
        )}
        {tab === "lead" && <SupplierLeadTimes supplierId={supplier.id} />}
        {tab === "items" && <SupplierItemsTab supplierId={supplier.id} />}
        {tab === "pos" && <RecentPos supplierId={supplier.id} />}
      </div>
    </div>
  );
}

function SupplierLeadTimes({ supplierId }: { supplierId: string }) {
  const q = usePurchasingSettings();
  if (q.isLoading) return <Loading variant="skeleton" label="Loading" />;
  if (!q.data) {
    return <div role="alert"><EmptyState title="Could not be loaded" action={<Button variant="neutral" onClick={() => void q.refetch()}>Try again</Button>} /></div>;
  }
  const row = q.data.suppliers.find((s) => s.id === supplierId);
  const held = q.data.productionDays.filter((d) => d.supplierId === supplierId);
  const off = row?.offDays;
  return (
    <div data-testid="supplier-lead-times">
      <div className="border border-base-200 rounded mb-3">
        <div className="px-3.5 py-2 text-meta text-kit-slate-11 flex justify-between"><span>Category</span><span>Production Days</span></div>
        {(row?.categories ?? []).map((category) => {
          const found = held.find((d) => d.category === category);
          return (
            <div key={category} className="px-3.5 py-2 border-t border-base-100 flex justify-between text-body">
              <span className="capitalize">{category}</span>
              <span className="tabular-nums">{found ? `${found.workingDays} Working days` : "Set a number"}</span>
            </div>
          );
        })}
      </div>
      <div className="text-meta text-kit-slate-11">Supplier work week</div>
      <div className="text-body mb-3">{off ? WEEK.filter((_, day) => !off.includes(day)).join(" · ") : GOODS_ABSENCE_WORDS.notRecorded}</div>
      <Link to="/operation?tab=purchasing-settings" className="text-meta text-kit-blue-9 underline underline-offset-2">Change these on Purchasing Settings.</Link>
    </div>
  );
}

function SupplierItemsTab({ supplierId }: { supplierId: string }) {
  const catalog = useCatalog({ admin: true });
  const roster = useOperationSuppliers();
  const offers = useAllSkuSupplierOffers();
  const isPrincipal = useAuth((st) => st.role) === "principal";
  const [importing, setImporting] = useState(false);
  const supplierName = roster.data?.suppliers.find((x) => x.id === supplierId)?.name ?? "Supplier";
  const items = useMemo(
    () => buildSupplierItems(catalog.data, roster.data?.suppliers, offers.data?.offers).filter((r) => r.supplierId === supplierId),
    [catalog.data, roster.data?.suppliers, offers.data?.offers, supplierId],
  );
  if (catalog.isLoading || roster.isLoading) return <Loading variant="skeleton" label="Loading" />;
  if (catalog.isError || roster.isError) {
    return <div role="alert"><EmptyState title="Could not be loaded" action={<Button variant="neutral" onClick={() => { void catalog.refetch(); void roster.refetch(); }}>Try again</Button>} /></div>;
  }
  return (
    <>
    <DataGrid rows={items} rowKey={(r) => `${r.sku}-${r.source}`} storageKey="carres.operation.supplier-detail-items.v1" appearance="reference"
      groupBanner={false} exportName="Supplier items" emptyMessage="No suppliers match." fillColumn="ourName"
      toolbarEnd={isPrincipal ? (
        <span className="flex gap-2">
          <Button size="sm" variant="neutral" data-testid="price-list-download"
            onClick={() => downloadCsv(`${supplierName} price list.csv`, /* the offers read carries price and pwpPrice since this change; queries.ts types it narrower */
              priceListCsv(items, ((offers.data?.offers ?? []) as Array<{ skuId: string; supplierId: string; price?: number | null; pwpPrice?: number | null }>).filter((o) => o.supplierId === supplierId)))}>
            Download price list
          </Button>
          <Button size="sm" variant="neutral" onClick={() => setImporting(true)} data-testid="price-list-import">Import price list</Button>
        </span>
      ) : undefined}
      columns={[
        { key: "theirCode", label: "Their code", width: 160, accessor: (r) => r.supplierCode ?? "" },
        { key: "sku", label: "Our code", width: 180, accessor: (r) => r.sku },
        { key: "ourName", label: "Our name", width: 260, wrap: true, accessor: (r) => r.ourName },
      ]} />
    {importing ? <PriceListImport supplierId={supplierId} supplierName={supplierName} onClose={() => setImporting(false)} /> : null}
    </>
  );
}

/** Houzs Supplier Bindings CSV import: read the file, show what will be saved, then save in one write. */
function PriceListImport({ supplierId, supplierName, onClose }: { supplierId: string; supplierName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (input: { supplierId: string; rows: PriceListRow[] }) =>
      apiFetch<{ saved: number; unknown: string[] }>("/api/catalog/supplier-offers/import", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sku-supplier-offers"] }),
  });
  const [read, setRead] = useState<{ rows: PriceListRow[]; problems: string[] } | null>(null);
  const [result, setResult] = useState<{ saved: number; unknown: string[] } | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setRead(readPriceList(parseCsv(await file.text()).rows));
  };
  const ready = read && read.rows.length > 0 && read.problems.length === 0 && !result;
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Import price list · ${supplierName}`}
      description="Columns: Our code, Their code, Price, PWP price. A blank cell keeps what is saved."
      footer={<>
        <Button variant="neutral" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
        {result ? null : (
          <Button variant="primary" disabled={!ready} loading={save.isPending} data-testid="price-list-save"
            onClick={() => read && save.mutate({ supplierId, rows: read.rows }, {
              onSuccess: (r) => setResult(r),
              onError: (e) => toast.error(e instanceof Error ? e.message : "Not saved. Try again."),
            })}>
            {read ? `Save ${read.rows.length} ${read.rows.length === 1 ? "row" : "rows"}` : "Save"}
          </Button>
        )}
      </>}>
      <input type="file" accept=".csv,text/csv" aria-label="Price list file" data-testid="price-list-file"
        onChange={(e) => void onFile(e.target.files?.[0])} className="text-body" />
      {read && read.rows.length === 0 ? <p className="mt-3 text-body">No rows with an Our code in this file.</p> : null}
      {read?.problems.length ? (
        <ul role="alert" className="mt-3 list-disc pl-5 text-body">{read.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      ) : null}
      {result ? (
        <div className="mt-3 text-body" data-testid="price-list-result">
          <p>{result.saved} saved.</p>
          {result.unknown.length ? <p>Not in the catalog, skipped: {result.unknown.join(", ")}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

/** The supplier's recent POs, shared by the drawer and the detail page. */
function RecentPos({ supplierId }: { supplierId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<{ pos: PoRow[] }>({
    queryKey: qk.operation.suppliersOverviewPos(supplierId),
    queryFn: () => apiFetch(`/api/operation/suppliers-overview/${supplierId}/pos`),
  });
  const pos = data?.pos ?? [];
  return (
    <div className="border border-base-200 rounded">
      {isLoading && <div className="p-4"><Loading variant="skeleton" label="Loading recent POs" /></div>}
      {isError && !data && (
        <div role="alert">
          <EmptyState
            title="Could not be loaded"
            detail="The recent POs did not arrive."
            action={<Button variant="neutral" onClick={() => void refetch()}>Try again</Button>}
          />
        </div>
      )}
      {data && pos.length === 0 && (
        <div className="p-4 text-meta text-base-500">No POs yet.</div>
      )}
      {pos.map((p, i) => (
        <div
          key={p.id}
          className={`px-3.5 py-2.5 flex justify-between text-meta ${i ? "border-t border-base-100" : ""}`}
        >
          <div>
            <div className="font-mono text-body font-semibold">{p.id}</div>
            <div className="text-meta text-base-500 mt-0.5">
              {fmtDate(p.placedAt)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-label text-base-500 uppercase tracking-[0.06em]">
              {(p.supStatus ?? p.status)?.replace(/_/g, " ")}
            </div>
            <div className="text-meta text-base-500 mt-0.5">
              {p.etaDate ? `ETA ${p.etaDate}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SupplierDrawer({ supplier, onClose, onOpenDetail }: { supplier: SupplierRow; onClose: () => void; onOpenDetail: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-[480px] bg-white h-screen overflow-auto p-7">
        <div className="flex justify-between items-start mb-[18px]">
          <div>
            <div className="kicker">{supplier.slug ?? supplier.id.slice(0, 8)}</div>
            <h2 className="text-page font-display mt-1">
              {supplier.name}
            </h2>
            <div className="text-meta text-base-600 mt-1">
              {/* P1 — the free-text lead time is not appended here either;
                  see the card above. */}
              {supplier.contactEmail ?? supplier.contact ?? GOODS_ABSENCE_WORDS.notRecorded}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-strong text-base-500 hover:text-base-900 cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="mb-4">
          <Button variant="neutral" size="sm" onClick={onOpenDetail} data-testid="supplier-open-detail">Open supplier</Button>
        </div>

        <TermsDaysField supplier={supplier} />

        <ScorecardBlock sc={supplier.scorecard} />

        <div className="text-strong text-kit-slate-12 mb-2">
          Recent POs
        </div>
        <RecentPos supplierId={supplier.id} />
      </div>
    </div>
  );
}

/**
 * Payment terms — Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): purchasing
 * staff edit a supplier's payment terms here, Houzs way. It writes the SAME
 * 0530 `suppliers.terms_days` that Purchasing settings and Finance's bill form
 * read, through the same door (`purchasing_set_supplier_terms_days`); there is
 * no second field. Jess's rule that Finance owns creditor terms is overturned;
 * Jess was not part of this decision.
 */
function TermsDaysField({ supplier }: { supplier: SupplierRow }) {
  const qc = useQueryClient();
  const setTerms = useSetSupplierTermsDays();
  const [draft, setDraft] = useState(supplier.termsDays == null ? "" : String(supplier.termsDays));
  const n = draft.trim() === "" ? null : Number(draft);
  const valid = n === null || (Number.isInteger(n) && n >= 0 && n <= 365);
  const dirty = valid && n !== supplier.termsDays;
  const save = () =>
    setTerms
      .mutateAsync({ supplierId: supplier.id, days: n })
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.operation.suppliersOverview() });
        toast.success("Saved");
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved. Try again."));
  return (
    <div className="mb-5 flex items-end gap-2" data-testid="supplier-terms-days">
      <div className="w-32">
        <Input
          id={`supplier-terms-days-${supplier.id}`}
          label="Terms (days)"
          type="number"
          min={0}
          max={365}
          step={1}
          value={draft}
          error={valid ? undefined : "0 to 365"}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <Button variant="primary" disabled={!dirty || setTerms.isPending} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
}

/**
 * The negotiation sheet — the five numbers the card asks for, each one either
 * backed by records or replaced by the reason it is not.
 *
 * The coverage lines below the figures are not filler: they are what stops the
 * reader treating "12 deliveries" as the whole story when four of them carried
 * no promised date and were never scored.
 */
function ScorecardBlock({ sc }: { sc: SupplierScorecard }) {
  const c = sc.coverage;
  const notes: string[] = [];
  if (c.noPromisedDate > 0)
    notes.push(
      c.noPromisedDate === 1
        ? "1 PO carries no promised date and cannot be scored"
        : `${c.noPromisedDate} POs carry no promised date and cannot be scored`,
    );
  if (c.notDueYet > 0)
    notes.push(
      c.notDueYet === 1
        ? "1 PO has not reached its promised date"
        : `${c.notDueYet} POs have not reached their promised date`,
    );
  if (c.noDeliveryDate > 0)
    notes.push(
      c.noDeliveryDate === 1
        ? "1 PO arrived complete with no receipt date, so on time cannot be answered for it"
        : `${c.noDeliveryDate} POs arrived complete with no receipt date, so on time cannot be answered for them`,
    );

  return (
    <div className="mb-6">
      <div className="text-strong text-kit-slate-12 mb-2">
        Scorecard
      </div>
      <div className="border border-base-200 rounded p-4">
        <div className="text-meta text-base-800 mb-3">
          {scorecardHeadline(sc)}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Measure label="On time" r={sc.onTime} noun="deliveries" />
          <Measure label="In full" r={sc.inFull} noun="deliveries" />
          <Measure label="Damaged or wrong" r={sc.faulty} noun="units they sent" />
          <Measure label="Needed a claim" r={sc.claimRate} noun="deliveries" />
        </div>

        <div className="mt-4 pt-3 border-t border-base-100">
          <div className="text-meta text-kit-slate-11">
            Claims
          </div>
          <div className="text-meta text-base-800 mt-1 tabular-nums">
            {sc.claims.open} open · {sc.claims.closed} settled
            {sc.claims.avgDaysToSettle !== null
              ? ` · settled in ${sc.claims.avgDaysToSettle} day${sc.claims.avgDaysToSettle === 1 ? "" : "s"} on average`
              : ""}
          </div>
          {sc.claims.closed === 0 && sc.claims.open > 0 && (
            <div className="text-meta text-base-500 mt-1">
              Nothing settled yet, so there is no average to show.
            </div>
          )}
          {sc.claims.oldestOpenDays !== null && (
            <div className="text-meta text-base-500 mt-1 tabular-nums">
              Oldest open claim: {sc.claims.oldestOpenDays} day
              {sc.claims.oldestOpenDays === 1 ? "" : "s"}.
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-base-100 text-meta text-base-500">
          <div className="tabular-nums">
            {c.pos} PO{c.pos === 1 ? "" : "s"} on file
            {c.from ? ` since ${fmtDate(c.from)}` : ""} · {c.judged} scored.
          </div>
          {notes.map((n) => (
            <div key={n} className="mt-0.5">
              {n}.
            </div>
          ))}
          {c.judged > 0 && c.judged < MIN_JUDGED_POS && (
            <div className="mt-0.5">
              A score needs {MIN_JUDGED_POS} deliveries. One late delivery out
              of one is not a record.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Measure({
  label,
  r,
  noun,
}: {
  label: string;
  r: ScorecardRate;
  /** What the denominator counts — "deliveries" or "units they sent". The
   *  fraction is always spelt out beneath the percentage, so nobody reads
   *  "33%" without seeing it is one delivery out of three. */
  noun: string;
}) {
  const why = rateWhy(r);
  return (
    <div>
      <div className="text-meta text-kit-slate-11">
        {label}
      </div>
      <div className="text-strong text-base-900 mt-0.5 tabular-nums">
        {rateText(r)}
      </div>
      <div className="text-meta text-base-500 mt-0.5">
        {why ?? `${r.hits} of ${r.of} ${noun}`}
      </div>
    </div>
  );
}
