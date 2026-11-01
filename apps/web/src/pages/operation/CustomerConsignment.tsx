import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import Checkbox from "@/components/kit/Checkbox";
import DatePicker from "@/components/kit/DatePicker";
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
import { rm } from "@/lib/format-currency";
import { useManualMethods } from "@/lib/payment-methods";
import DocumentTable from "@/components/kit/DocumentTable";
import Tabs from "@/components/kit/Tabs";
import { documentRowMenu } from "@/components/register/row-menu";
import { DetailSection, DocHistory, Facts, KpiRow, RelationshipMap, TableCardsTabs, cardsProps, printDocument, useOpenFromUrl, type HistoryEvent } from "./houzs-list-bits";

/**
 * Customer Consignment Order · Consignment Note · Customer Consignment Return
 * (migration 0719).
 *
 * Weisiang's decision (Mr Lim, Houzs owner side, WhatsApp 2026-10-22): office
 * staff send goods to customers on consignment and take unsold goods back, the
 * Houzs way. This overturns Jess's Purchasing MASTER rules (dealers do not take
 * consignment; no blank consignment documents) and COPY-STANDARD's ban on the
 * name "Consignment Note"; Jess was not part of this decision. These are the
 * CUSTOMER side; the supplier-side Consignment Order / Return are separate.
 * A Unit at the customer stays Carres-owned.
 *
 * Money follows Houzs (YH, chat 2026-10-26): the Customer Consignment Order
 * carries each Unit's price and its own payments; no Sales Order is used
 * (Houzs ConsignmentOrderDetail.tsx; consignment-orders.ts:2171-2310), per
 * Weisiang's ruling (2026-10-22): clear Carres rules, implement Houzs.
 */

const BASE = "/api/ops/customer-consignment";
const NO_DEALER = "none";
type Choice = { id: string; name: string };
type Unit = { id: string; unit_code: string; sku: string; status: string; reserved_ref: string | null };
type UnitLink = { ops_stock_items: Unit | null };
type Customer = { name: string; phone: string; address: string };

const post = <T,>(path: string, body: unknown) =>
  apiFetch<T>(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) });
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

function useChoices() {
  return useQuery({
    queryKey: ["customer-consignment", "choices"],
    queryFn: () => apiFetch<{ dealers: Choice[]; sites: Choice[] }>(`${BASE}/choices`),
    staleTime: 300_000,
  });
}
const units = (links: UnitLink[]) => links.map((l) => l.ops_stock_items).filter((u): u is Unit => u !== null);
const codes = (list: Unit[]) => list.map((u) => u.unit_code).join(", ");
/** A Unit is out at the customer while it is reserved to the Note that sent it. */
const outOn = (noteNo: string, list: Unit[]) => list.filter((u) => u.status === "reserved" && u.reserved_ref === noteNo);
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Could not save. Try again.");

function Page({ word, testId, children }: { word: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <ModuleHeader destinationHeader testId={`${testId}-header`} word={word} docTitle={`${word} · Consignment · Carres`} />
      {children}
    </div>
  );
}

function Ticks({ list, picked, onChange, empty }: { list: Unit[]; picked: string[]; onChange: (ids: string[]) => void; empty: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-64 overflow-auto rounded-control border border-c-line p-2" role="group" aria-label="Units">
        {list.length === 0 && <p className="text-body text-c-muted">{empty}</p>}
        {list.map((u) => (
          <Checkbox key={u.id} id={`unit-${u.id}`} label={`${u.unit_code} · ${u.sku}`} checked={picked.includes(u.id)}
            onCheckedChange={(on) => onChange(on ? [...picked, u.id] : picked.filter((x) => x !== u.id))} />
        ))}
      </div>
      <p className="text-body text-c-muted">{picked.length} Units picked</p>
    </div>
  );
}

/** Pick a Site, then free Carres-owned Units standing there. */
function StockPicker({ sites, picked, onChange, prices, setPrices }: {
  sites: Choice[]; picked: string[]; onChange: (ids: string[]) => void;
  prices?: Record<string, string>; setPrices?: (p: Record<string, string>) => void;
}) {
  const [siteId, setSiteId] = useState("");
  const [find, setFind] = useState("");
  const q = useQuery({
    queryKey: ["customer-consignment", "units", siteId],
    queryFn: () => apiFetch<{ units: Unit[] }>(`${BASE}/units?siteId=${siteId}`),
    enabled: Boolean(siteId),
  });
  const needle = find.trim().toLowerCase();
  const list = (q.data?.units ?? []).filter((u) => !needle || `${u.unit_code} ${u.sku}`.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-2">
      <Select id="cs-site" label="Pickup Location" value={siteId || undefined} onValueChange={(v) => { setSiteId(v); onChange([]); }}
        options={sites.map((s) => ({ value: s.id, label: s.name }))} />
      {siteId && <Input id="cs-find" label="Find Unit" value={find} onChange={(e) => setFind(e.target.value)} />}
      {q.isError && <LoadError message="The Units could not be loaded." onRetry={() => void q.refetch()} />}
      {q.isSuccess && <Ticks list={list} picked={picked} onChange={onChange} empty="No Units here." />}
      {prices && setPrices && (q.data?.units ?? []).filter((u) => picked.includes(u.id)).map((u) => (
        <Input key={u.id} id={`price-${u.id}`} label={`Price (RM) · ${u.unit_code}`} inputMode="decimal"
          value={prices[u.id] ?? ""} onChange={(e) => setPrices({ ...prices, [u.id]: e.target.value })}
          error={prices[u.id] && !PRICE_RE.test(prices[u.id]) ? "Enter an amount, e.g. 1200.00" : undefined} />
      ))}
    </div>
  );
}

function CustomerFields({ dealers, dealerId, setDealerId, c, setC }: {
  dealers: Choice[]; dealerId: string; setDealerId: (v: string) => void; c: Customer; setC: (c: Customer) => void;
}) {
  return (
    <>
      <Select id="cs-dealer" label="Dealer" value={dealerId} onValueChange={setDealerId}
        options={[{ value: NO_DEALER, label: "No dealer" }, ...dealers.map((d) => ({ value: d.id, label: d.name }))]} />
      <Input id="cs-name" label="Customer" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      <Input id="cs-phone" label="Phone" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
      <Textarea id="cs-address" label="Delivery Address" rows={2} value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} />
    </>
  );
}
const EMPTY: Customer = { name: "", phone: "", address: "" };
const hasCustomer = (dealerId: string, c: Customer) => dealerId !== NO_DEALER || c.name.trim().length > 0;
/** Why Save is off, in one line; null when nothing is missing. */
const consignHint = (dealerId: string, c: Customer, picked: string[], prices: Record<string, string>) =>
  !hasCustomer(dealerId, c) ? "Pick a dealer or type the customer's name."
  : picked.length === 0 ? "Pick at least one Unit."
  : !picked.every((id) => PRICE_RE.test(prices[id] ?? "")) ? "Enter a price on every picked Unit." : null;
const dealerOrNull = (dealerId: string) => (dealerId === NO_DEALER ? null : dealerId);

/** Line Items of an order or note, the Houzs detail-page table (ConsignmentNoteDetail.tsx:507-512). */
function LineItems({ lines }: { lines: OrderLine[] }) {
  return (
    <DetailSection title={`Line Items (${lines.length})`}>
      <DocumentTable label="Line Items"
        columns={[{ key: "sku", label: "Item" }, { key: "unit", label: "Unit ID" }, { key: "qty", label: "Qty", numeric: true }, { key: "total", label: "Total", numeric: true }, { key: "sold", label: "Sold" }]}
        rows={lines.map((l, i) => ({
          key: l.ops_stock_items?.id ?? String(i),
          cells: { sku: l.ops_stock_items?.sku ?? "", unit: l.ops_stock_items?.unit_code ?? "", qty: 1, total: rm(Number(l.price)), sold: l.sold_at ? fmtDate(l.sold_at) : "" },
        }))} />
    </DetailSection>
  );
}

const PRINT = "Print PDF";
const lineTable = (lines: OrderLine[]) => ({
  title: "Line Items", headers: ["Item", "Unit ID", "Qty", "Total", "Sold"], numeric: ["Qty", "Total"],
  rows: lines.map((l) => [l.ops_stock_items?.sku ?? "", l.ops_stock_items?.unit_code ?? "", "1", rm(Number(l.price)), l.sold_at ? fmtDate(l.sold_at) : ""]),
});
const paymentEvents = (list: Payment[]): HistoryEvent[] => list.map((p) => ({ at: p.paid_at, word: `Payment ${rm(Number(p.amount))}` }));
const soldEvents = (lines: OrderLine[]): HistoryEvent[] => lines.filter((l) => l.sold_at).map((l) => ({ at: l.sold_at, word: `Sold ${l.ops_stock_items?.unit_code ?? ""}` }));
const TAB = { order: "customer-consignment-orders", note: "consignment-notes", ret: "customer-consignment-returns" } as const;
const WORD = { order: "Customer Consignment Order", note: "Consignment Note", ret: "Customer Consignment Return" } as const;

// ── Customer Consignment Order ────────────────────────────────────────────────
type OrderLine = UnitLink & { price: string | number; sold_at: string | null };
type Payment = { id: string; paid_at: string; method: string; amount: string | number; reference: string | null; note: string | null };
type OrderRow = {
  id: string; order_no: string; customer_name: string; customer_phone: string | null; customer_address: string | null; note: string | null; created_at: string;
  customer_consignment_order_units: OrderLine[];
  customer_consignment_order_payments: Payment[];
  total: number; paid: number; balance: number;
};

type Money = { total: number; paid: number; balance: number };

/**
 * A payments ledger on an order or a blank Note, like Houzs's Consignment
 * Order payments (consignment-orders.ts:2171-2310) and Consignment Note
 * payments (consignment-notes.ts:1074-1160), per Weisiang's ruling
 * (2026-10-22): clear Carres rules, implement Houzs.
 */
export function Payments({ path, money, payments, onSaved }: { path: string; money: Money; payments: Payment[]; onSaved: () => void }) {
  const m = useManualMethods();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const add = useMutation({
    mutationFn: () => post(`${path}/payments`, {
      amount: Number(amount), method, paidAt: paidAt || undefined, reference: reference || undefined,
    }),
    onSuccess: () => { setAmount(""); setReference(""); onSaved(); },
  });
  // The server takes any amount (0719), so the form is the only cap on an overpayment.
  const over = PRICE_RE.test(amount) && Math.round(Number(amount) * 100) > Math.round(money.balance * 100);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}${path}/payments/${id}`, { method: "DELETE" }),
    onSuccess: () => { setRemoving(null); onSaved(); },
  });
  return (
    <section className="flex flex-col gap-2" aria-label="Payments">
      <h3 className="text-title">Payments</h3>
      <p className="text-body">Total {rm(money.total)} · Paid {rm(money.paid)} · Balance {rm(money.balance)}</p>
      {payments.length === 0 && <p className="text-body text-c-muted">No payments yet.</p>}
      {payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 text-body">
          <span>{fmtDate(p.paid_at)} · {m.label(p.method)} · {rm(Number(p.amount))}{p.reference ? ` · ${p.reference}` : ""}</span>
          <Button variant="neutral" onClick={() => { remove.reset(); setRemoving(p); }}>Remove</Button>
        </div>
      ))}
      <Input id="ccp-amount" label="Amount (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
        error={amount && !PRICE_RE.test(amount) ? "Enter an amount, e.g. 500.00" : over ? `The balance is ${rm(money.balance)}. Enter that or less.` : undefined} />
      <Select id="ccp-method" label="Payment Method" value={method || undefined} onValueChange={setMethod}
        options={m.methods.map((x) => ({ value: x.value, label: x.label }))} />
      <DatePicker id="ccp-date" label="Payment Date" value={paidAt || null} onChange={(v) => setPaidAt(v ?? "")} />
      <Input id="ccp-ref" label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
      {add.isError && <FieldError>{errorText(add.error)}</FieldError>}
      <div>
        <Button variant="neutral" loading={add.isPending} disabled={!PRICE_RE.test(amount) || Number(amount) <= 0 || over || !method}
          onClick={() => add.mutate()}>Add Payment</Button>
      </div>
      <ConfirmActionDialog open={removing !== null} title="Remove this payment?"
        message={removing ? `The ${rm(Number(removing.amount))} payment of ${fmtDate(removing.paid_at)} will be removed and the balance goes back up.` : ""}
        confirmLabel="Remove payment" pending={remove.isPending} error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing.id)} onCancel={() => setRemoving(null)} />
    </section>
  );
}

export function CustomerConsignmentOrders() {
  const qc = useQueryClient();
  const choices = useChoices();
  const notes = useNotes();
  const returns = useReturns();
  const [display, setDisplay] = useState("table");
  const list = useQuery({ queryKey: ["customer-consignment", "orders"], queryFn: () => apiFetch<{ orders: OrderRow[] }>(`${BASE}/orders`) });
  const [open, setOpen] = useState(false);
  const [dealerId, setDealerId] = useState(NO_DEALER);
  const [c, setC] = useState<Customer>(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [paidTab, setPaidTab] = useState("all");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const sending = (list.data?.orders ?? []).find((o) => o.id === sendingId) ?? null;
  const setSending = (o: OrderRow | null) => setSendingId(o?.id ?? null);
  useOpenFromUrl(list.data?.orders, (o) => o.order_no, setSending);
  const notesOf = (o: OrderRow) => (notes.data?.notes ?? []).filter((n) => n.order_id === o.id);
  const printIt = (o: OrderRow) => printDocument({
    title: WORD.order, docNo: o.order_no, date: fmtDate(o.created_at),
    facts: [["Customer", o.customer_name], ["Phone", o.customer_phone ?? ""], ["Delivery Address", o.customer_address ?? ""], ["Note", o.note ?? ""],
      ["Total", rm(o.total)], ["Paid", rm(o.paid)], ["Balance", rm(o.balance)]],
    tables: [lineTable(o.customer_consignment_order_units)],
  });
  const priced = picked.length > 0 && picked.every((id) => PRICE_RE.test(prices[id] ?? ""));
  const [sendPicked, setSendPicked] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const done = () => void qc.invalidateQueries({ queryKey: ["customer-consignment"] });
  const save = useMutation({
    mutationFn: () => post("/orders", {
      dealerId: dealerOrNull(dealerId), customer: c, note,
      lines: picked.map((unitId) => ({ unitId, price: Number(prices[unitId]) })),
    }),
    onSuccess: () => { setOpen(false); setPicked([]); setPrices({}); setC(EMPTY); setNote(""); setDealerId(NO_DEALER); done(); },
  });
  const send = useMutation({
    mutationFn: () => post("/notes", { orderId: sending?.id, unitIds: sendPicked, deliveryDate: date || undefined }),
    onSuccess: () => { setSending(null); setSendPicked([]); setDate(""); done(); },
  });
  const columns = useMemo<DataGridColumn<OrderRow>[]>(() => [
    { key: "no", label: "Doc. No.", width: 170, accessor: (r) => r.order_no },
    { key: "date", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "customer", label: "Customer", width: 200, accessor: (r) => r.customer_name },
    { key: "total", label: "Local Total", width: 120, accessor: (r) => rm(r.total) },
    { key: "phone", label: "Phone", width: 130, accessor: (r) => r.customer_phone ?? "" },
    { key: "address", label: "Address 1", width: 240, accessor: (r) => r.customer_address ?? "" },
    { key: "units", label: "Units", width: 280, accessor: (r) => codes(units(r.customer_consignment_order_units)) },
    { key: "paid", label: "Paid", width: 120, accessor: (r) => rm(r.paid) },
    { key: "balance", label: "Balance", width: 120, accessor: (r) => rm(r.balance) },
    { key: "note", label: "Note", width: 220, accessor: (r) => r.note ?? "" },
  ], []);
  const toSend = sending ? units(sending.customer_consignment_order_units).filter((u) => u.status === "free") : [];

  return (
    <Page word="Customer Consignment Orders" testId="customer-consignment-orders">
      {list.isSuccess && <KpiRow items={[
        { label: "Total Orders", value: list.data.orders.length, hint: "Customer Consignment Orders on this list" },
        { label: "Revenue", value: rm(list.data.orders.reduce((n, o) => n + o.total, 0)), hint: "Sum of order totals" },
        { label: "Outstanding", value: rm(list.data.orders.reduce((n, o) => n + o.balance, 0)), hint: "Sum of balances" },
        { label: "Paid", value: rm(list.data.orders.reduce((n, o) => n + o.paid, 0)), hint: "Sum of payments" },
      ]} />}
      {list.isError ? <LoadError message="The customer consignment orders could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={(list.data?.orders ?? []).filter((o) => paidTab === "all" || o.balance > 0)} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.delivery.customer-consignment-orders.v1" appearance="reference" exportName="Customer Consignment Orders"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search order, customer or Unit ID…"
            onRowClick={(r) => { setSending(r); setSendPicked([]); }}
            contextMenu={(r) => documentRowMenu({ view: () => { setSending(r); setSendPicked([]); }, print: () => printIt(r) })}
            {...cardsProps<OrderRow>(display, (r) => r.id, (r) => { setSending(r); setSendPicked([]); }, (r) => ({ title: r.order_no, facts: [
              ["Customer", r.customer_name], ["Date", fmtDate(r.created_at)], ["Local Total", rm(r.total)], ["Balance", rm(r.balance)],
            ] }))}
            toolbarStart={<Tabs variant="segmented" label="Balance" value={paidTab} onValueChange={setPaidTab} tabs={[
              { value: "all", label: "All" }, { value: "outstanding", label: "Outstanding" },
            ]} />}
            toolbarEnd={<><TableCardsTabs label="Customer Consignment Orders" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Customer Consignment Order</Button></>}
            emptyMessage="No customer consignment orders yet." />
        </ListPageShell>
      )}
      <Modal open={open} onOpenChange={setOpen} width="wide" title="New Customer Consignment Order"
        description="The Units leave stock when their Consignment Note is issued."
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={save.isPending} disabled={!hasCustomer(dealerId, c) || !priced} onClick={() => save.mutate()}>Save</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <CustomerFields dealers={choices.data?.dealers ?? []} dealerId={dealerId} setDealerId={setDealerId} c={c} setC={setC} />
          <StockPicker sites={choices.data?.sites ?? []} picked={picked} onChange={setPicked} prices={prices} setPrices={setPrices} />
          <Textarea id="cco-note" label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {consignHint(dealerId, c, picked, prices) && <p className="text-body text-c-muted" role="status">Save is off: {consignHint(dealerId, c, picked, prices)}</p>}
          {save.isError && <FieldError>{errorText(save.error)}</FieldError>}
        </div>
      </Modal>
      <Modal open={sending !== null} onOpenChange={(o) => !o && setSending(null)} width="wide"
        title={`${sending?.order_no ?? ""} · Consignment Note and payments`}
        description="Issue a Consignment Note for the picked Units, and record the customer's payments on this order."
        footer={<>
          <Button variant="neutral" onClick={() => setSending(null)}>Close</Button>
          {sending && <Button variant="neutral" icon="print" onClick={() => printIt(sending)}>{PRINT}</Button>}
          <Button variant="primary" loading={send.isPending} disabled={sendPicked.length === 0} onClick={() => send.mutate()}>Issue Consignment Note</Button>
        </>}>
        <div className="flex flex-col gap-3">
          {sending && <DetailSection title="Customer"><Facts facts={[
            ["Customer Name", sending.customer_name], ["Phone", sending.customer_phone ?? ""],
            ["Order Date", fmtDate(sending.created_at)], ["Note", sending.note ?? ""],
            ["Delivery Address", sending.customer_address ?? ""],
          ]} /></DetailSection>}
          {sending && <LineItems lines={sending.customer_consignment_order_units} />}
          <DatePicker id="ccn-date" label="Delivery Date" value={date || null} onChange={(v) => setDate(v ?? "")} />
          <Ticks list={toSend} picked={sendPicked} onChange={setSendPicked} empty="Every Unit on this order has gone out." />
          {send.isError && <FieldError>{errorText(send.error)}</FieldError>}
          {sending && <Payments path={`/orders/${sending.id}`} money={sending} payments={sending.customer_consignment_order_payments} onSaved={done} />}
          {sending && <RelationshipMap current={{ kind: WORD.order, no: sending.order_no }} links={[
            ...notesOf(sending).map((n) => ({ kind: WORD.note, no: n.note_no, tab: TAB.note })),
            ...returnsOfNotes(returns.data?.returns, notesOf(sending).map((n) => n.note_no)).map((r) => ({ kind: WORD.ret, no: r.return_no, tab: TAB.ret })),
          ]} />}
          {sending && <DocHistory events={[
            { at: sending.created_at, word: "Created" },
            ...notesOf(sending).map((n) => ({ at: n.created_at, word: `Consignment Note ${n.note_no} issued` })),
            ...soldEvents(sending.customer_consignment_order_units),
            ...paymentEvents(sending.customer_consignment_order_payments),
          ]} />}
        </div>
      </Modal>
    </Page>
  );
}

// ── Consignment Note ──────────────────────────────────────────────────────────
type NoteRow = Money & {
  id: string; note_no: string; order_id: string | null; customer_name: string; customer_phone: string | null; customer_address: string | null; delivery_date: string;
  note: string | null; created_at: string;
  customer_consignment_orders: { order_no: string } | null;
  consignment_note_units: OrderLine[];
  consignment_note_payments: Payment[];
};

function useNotes() {
  return useQuery({ queryKey: ["customer-consignment", "notes"], queryFn: () => apiFetch<{ notes: NoteRow[] }>(`${BASE}/notes`) });
}
function useReturns() {
  return useQuery({ queryKey: ["customer-consignment", "returns"], queryFn: () => apiFetch<{ returns: ReturnRow[] }>(`${BASE}/returns`) });
}
const returnsOfNotes = (list: ReturnRow[] | undefined, noteNos: string[]) =>
  (list ?? []).filter((r) => r.customer_consignment_return_units.some((l) => noteNos.includes(l.consignment_notes?.note_no ?? "")));

export function ConsignmentNotes() {
  const qc = useQueryClient();
  const choices = useChoices();
  const list = useNotes();
  const returns = useReturns();
  const [display, setDisplay] = useState("table");
  const [open, setOpen] = useState(false);
  const [dealerId, setDealerId] = useState(NO_DEALER);
  const [c, setC] = useState<Customer>(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const priced = picked.length > 0 && picked.every((id) => PRICE_RE.test(prices[id] ?? ""));
  const [sellingId, setSellingId] = useState<string | null>(null);
  const selling = (list.data?.notes ?? []).find((n) => n.id === sellingId) ?? null;
  const setSelling = (n: NoteRow | null) => setSellingId(n?.id ?? null);
  useOpenFromUrl(list.data?.notes, (n) => n.note_no, setSelling);
  const printIt = (n: NoteRow) => printDocument({
    title: WORD.note, docNo: n.note_no, date: fmtDate(n.created_at),
    facts: [["Customer", n.customer_name], ["Phone", n.customer_phone ?? ""], ["Delivery Address", n.customer_address ?? ""],
      ["Expected Delivery", fmtDate(n.delivery_date)], ["Order No", n.customer_consignment_orders?.order_no ?? ""], ["Note", n.note ?? ""]],
    tables: [lineTable(n.consignment_note_units)],
    signatures: ["Issued by", "Received by"],
  });
  const [soldPicked, setSoldPicked] = useState<string[]>([]);
  const [outTab, setOutTab] = useState("all");
  const [, setParams] = useSearchParams();
  const done = () => void qc.invalidateQueries({ queryKey: ["customer-consignment"] });
  const save = useMutation({
    mutationFn: () => post("/notes", {
      dealerId: dealerOrNull(dealerId), customer: c, unitIds: picked, deliveryDate: date || undefined, note,
      prices: Object.fromEntries(picked.map((id) => [id, Number(prices[id])])),
    }),
    onSuccess: () => { setOpen(false); setPicked([]); setPrices({}); setC(EMPTY); setNote(""); setDate(""); setDealerId(NO_DEALER); done(); },
  });
  const sell = useMutation({
    mutationFn: () => post("/notes/sold", { unitIds: soldPicked }),
    onSuccess: () => { setSelling(null); setSoldPicked([]); done(); },
  });
  const columns = useMemo<DataGridColumn<NoteRow>[]>(() => [
    { key: "no", label: "Note No.", width: 190, accessor: (r) => r.note_no },
    { key: "noteDate", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "customer", label: "Customer", width: 200, accessor: (r) => r.customer_name },
    { key: "date", label: "Expected", width: 120, accessor: (r) => fmtDate(r.delivery_date), dateValue: (r) => r.delivery_date, filterType: "date" },
    { key: "phone", label: "Phone", width: 130, accessor: (r) => r.customer_phone ?? "" },
    { key: "address", label: "Address 1", width: 240, accessor: (r) => r.customer_address ?? "" },
    { key: "order", label: "Order No", width: 170, accessor: (r) => r.customer_consignment_orders?.order_no ?? "" },
    { key: "out", label: "At customer", width: 260, accessor: (r) => codes(outOn(r.note_no, units(r.consignment_note_units))) },
    { key: "units", label: "Units", width: 260, accessor: (r) => codes(units(r.consignment_note_units)) },
    { key: "total", label: "Local Total", width: 120, accessor: (r) => rm(r.total) },
    { key: "balance", label: "Balance", width: 120, accessor: (r) => (r.order_id ? "On order" : rm(r.balance)) },
    { key: "note", label: "Note", width: 200, accessor: (r) => r.note ?? "" },
  ], []);
  const out = selling ? outOn(selling.note_no, units(selling.consignment_note_units)) : [];

  return (
    <Page word="Consignment Notes" testId="consignment-notes">
      {list.isSuccess && <KpiRow items={[
        { label: "Total Notes", value: list.data.notes.length, hint: "Consignment Notes on this list" },
        { label: "Revenue", value: rm(list.data.notes.reduce((n, x) => n + x.total, 0)), hint: "Sum of note totals" },
      ]} />}
      {list.isError ? <LoadError message="The consignment notes could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={(list.data?.notes ?? []).filter((n) => outTab === "all" || outOn(n.note_no, units(n.consignment_note_units)).length > 0)} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.delivery.consignment-notes.v1" appearance="reference" exportName="Consignment Notes"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search note, customer or Unit ID…"
            onRowClick={(r) => { setSelling(r); setSoldPicked([]); }}
            contextMenu={(r) => documentRowMenu({ view: () => { setSelling(r); setSoldPicked([]); }, print: () => printIt(r) })}
            {...cardsProps<NoteRow>(display, (r) => r.id, (r) => { setSelling(r); setSoldPicked([]); }, (r) => ({ title: r.note_no, facts: [
              ["Customer", r.customer_name], ["Expected", fmtDate(r.delivery_date)], ["Local Total", rm(r.total)], ["At customer", codes(outOn(r.note_no, units(r.consignment_note_units)))],
            ] }))}
            toolbarStart={<Tabs variant="segmented" label="Where the Units are" value={outTab} onValueChange={setOutTab} tabs={[
              { value: "all", label: "All" }, { value: "out", label: "At customer" },
            ]} />}
            toolbarEnd={<><TableCardsTabs label="Consignment Notes" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Consignment Note</Button></>}
            emptyMessage="No consignment notes yet." />
        </ListPageShell>
      )}
      <Modal open={open} onOpenChange={setOpen} width="wide" title="New Consignment Note"
        description="The picked Units go to the customer as soon as you save. They stay Carres-owned."
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={save.isPending} disabled={!hasCustomer(dealerId, c) || !priced} onClick={() => save.mutate()}>Save</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <CustomerFields dealers={choices.data?.dealers ?? []} dealerId={dealerId} setDealerId={setDealerId} c={c} setC={setC} />
          <DatePicker id="csn-date" label="Delivery Date" value={date || null} onChange={(v) => setDate(v ?? "")} />
          <StockPicker sites={choices.data?.sites ?? []} picked={picked} onChange={setPicked} prices={prices} setPrices={setPrices} />
          <Textarea id="csn-note" label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {consignHint(dealerId, c, picked, prices) && <p className="text-body text-c-muted" role="status">Save is off: {consignHint(dealerId, c, picked, prices)}</p>}
          {save.isError && <FieldError>{errorText(save.error)}</FieldError>}
        </div>
      </Modal>
      <Modal open={selling !== null} onOpenChange={(o) => !o && setSelling(null)} width="wide"
        title={`Record sold Units on ${selling?.note_no ?? ""}`}
        description={selling?.order_id
          ? "Sold Units are sold at their Customer Consignment Order price. Record the customer's payment on that order."
          : "Sold Units are sold at their price on this note. Record the customer's payment below."}
        footer={<>
          <Button variant="neutral" onClick={() => setSelling(null)}>Close</Button>
          {selling && <Button variant="neutral" icon="print" onClick={() => printIt(selling)}>{PRINT}</Button>}
          {out.length > 0 && selling && (
            <Button variant="neutral" onClick={() => setParams((p) => { p.set("tab", "customer-consignment-returns"); p.set("fromNote", selling.note_no); return p; })}>
              Create Consignment Return
            </Button>
          )}
          <Button variant="primary" loading={sell.isPending} disabled={soldPicked.length === 0} onClick={() => sell.mutate()}>Record sold</Button>
        </>}>
        <div className="flex flex-col gap-3">
          {selling && <DetailSection title="Customer"><Facts facts={[
            ["Customer Name", selling.customer_name], ["Phone", selling.customer_phone ?? ""],
            ["Note Date", fmtDate(selling.created_at)], ["Expected Delivery", fmtDate(selling.delivery_date)],
            ["Order No", selling.customer_consignment_orders?.order_no ?? ""], ["Note", selling.note ?? ""],
            ["Delivery Address", selling.customer_address ?? ""],
          ]} /></DetailSection>}
          {selling && <LineItems lines={selling.consignment_note_units} />}
          <Ticks list={out} picked={soldPicked} onChange={setSoldPicked} empty="No Units are at the customer on this note." />
          {sell.isError && <FieldError>{errorText(sell.error)}</FieldError>}
          {selling && !selling.order_id && (
            <Payments path={`/notes/${selling.id}`} money={selling} payments={selling.consignment_note_payments} onSaved={done} />
          )}
          {selling && <RelationshipMap current={{ kind: WORD.note, no: selling.note_no }} links={[
            ...(selling.customer_consignment_orders ? [{ kind: WORD.order, no: selling.customer_consignment_orders.order_no, tab: TAB.order }] : []),
            ...returnsOfNotes(returns.data?.returns, [selling.note_no]).map((r) => ({ kind: WORD.ret, no: r.return_no, tab: TAB.ret })),
          ]} />}
          {selling && <DocHistory events={[
            { at: selling.created_at, word: "Issued" },
            ...soldEvents(selling.consignment_note_units),
            ...paymentEvents(selling.consignment_note_payments),
            ...returnsOfNotes(returns.data?.returns, [selling.note_no]).map((r) => ({ at: r.created_at, word: `Returned on ${r.return_no}` })),
          ]} />}
        </div>
      </Modal>
    </Page>
  );
}

// ── Customer Consignment Return ───────────────────────────────────────────────
type ReturnRow = {
  id: string; return_no: string; warehouse_id: string; note: string | null; created_at: string;
  customer_consignment_return_units: { ops_stock_items: { unit_code: string; sku?: string } | null; consignment_notes: { note_no: string; customer_name: string } | null }[];
};

export function CustomerConsignmentReturns() {
  const qc = useQueryClient();
  const choices = useChoices();
  const notes = useNotes();
  const list = useReturns();
  const [display, setDisplay] = useState("table");
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<ReturnRow | null>(null);
  useOpenFromUrl(list.data?.returns, (r) => r.return_no, setViewing);
  // Arriving from a Consignment Note's Create Consignment Return: start with that note's Units ticked.
  const [params, setParams] = useSearchParams();
  const fromNote = params.get("fromNote");
  const fromNoteRow = notes.data?.notes.find((n) => n.note_no === fromNote);
  useEffect(() => {
    if (!fromNoteRow) return;
    setPicked(outOn(fromNoteRow.note_no, units(fromNoteRow.consignment_note_units)).map((u) => u.id));
    setOpen(true);
    setParams((p) => { p.delete("fromNote"); return p; }, { replace: true });
  }, [fromNoteRow, setParams]);
  // A returned Unit's value is its price on the note that sent it.
  const priceOn = useMemo(() => new Map((notes.data?.notes ?? []).flatMap((n) =>
    n.consignment_note_units.map((l) => [`${n.note_no}|${l.ops_stock_items?.unit_code}`, Number(l.price)] as const))), [notes.data]);
  const save = useMutation({
    mutationFn: () => post("/returns", { siteId, unitIds: picked, note }),
    onSuccess: () => { setOpen(false); setPicked([]); setNote(""); void qc.invalidateQueries({ queryKey: ["customer-consignment"] }); },
  });
  const siteName = (id: string) => choices.data?.sites.find((s) => s.id === id)?.name ?? "";
  const lines = (r: ReturnRow) => r.customer_consignment_return_units;
  const linePrice = (l: ReturnRow["customer_consignment_return_units"][number]) =>
    priceOn.get(`${l.consignment_notes?.note_no}|${l.ops_stock_items?.unit_code}`) ?? 0;
  const returned = (r: ReturnRow) => lines(r).reduce((n, l) => n + linePrice(l), 0);
  const printIt = (r: ReturnRow) => printDocument({
    title: WORD.ret, docNo: r.return_no, date: fmtDate(r.created_at),
    facts: [["Delivery Location", siteName(r.warehouse_id)], ["Returned Value", rm(returned(r))], ["Note", r.note ?? ""]],
    tables: [{
      title: "Returned Items", headers: ["Item", "Unit ID", "Customer", "Consignment Note No", "Qty", "Total"], numeric: ["Qty", "Total"],
      rows: lines(r).map((l) => [l.ops_stock_items?.sku ?? "", l.ops_stock_items?.unit_code ?? "", l.consignment_notes?.customer_name ?? "", l.consignment_notes?.note_no ?? "", "1", rm(linePrice(l))]),
    }],
    signatures: ["Returned by", "Received by"],
  });
  const columns = useMemo<DataGridColumn<ReturnRow>[]>(() => [
    { key: "no", label: "Return No.", width: 170, accessor: (r) => r.return_no },
    { key: "date", label: "Date", width: 110, accessor: (r) => fmtDate(r.created_at), dateValue: (r) => r.created_at, filterType: "date" },
    { key: "customer", label: "Customer", width: 200, accessor: (r) => [...new Set(lines(r).map((l) => l.consignment_notes?.customer_name ?? ""))].join(", ") },
    { key: "csn", label: "Consignment Note No", width: 190, accessor: (r) => [...new Set(lines(r).map((l) => l.consignment_notes?.note_no ?? ""))].join(", ") },
    { key: "units", label: "Units", width: 260, accessor: (r) => lines(r).map((l) => l.ops_stock_items?.unit_code).filter(Boolean).join(", ") },
    { key: "site", label: "Delivery Location", width: 180, accessor: (r) => siteName(r.warehouse_id), filterType: "enum" },
    { key: "value", label: "Returned Value", width: 130, accessor: (r) => rm(returned(r)) },
    { key: "note", label: "Note", width: 200, accessor: (r) => r.note ?? "" },
  ], [choices.data, priceOn]);
  // Every Unit at a customer, labelled with its customer and note.
  const out = (notes.data?.notes ?? []).flatMap((n) =>
    outOn(n.note_no, units(n.consignment_note_units)).map((u) => ({ ...u, sku: `${u.sku} · ${n.customer_name} · ${n.note_no}` })));

  return (
    <Page word="Customer Consignment Returns" testId="customer-consignment-returns">
      {list.isSuccess && <KpiRow items={[
        { label: "Total Returns", value: list.data.returns.length, hint: "Customer Consignment Returns on this list" },
        { label: "Returned Value", value: rm(list.data.returns.reduce((n, r) => n + returned(r), 0)), hint: "Note price of the returned Units" },
      ]} />}
      {list.isError ? <LoadError message="The customer consignment returns could not be loaded." onRetry={() => void list.refetch()} /> : (
        <ListPageShell register>
          <DataGrid rows={list.data?.returns ?? []} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.delivery.customer-consignment-returns.v1" appearance="reference" exportName="Customer Consignment Returns"
            groupBanner={false} stickyIdentity isLoading={!list.isSuccess} searchPlaceholder="Search return, customer or Unit ID…"
            onRowClick={setViewing}
            contextMenu={(r) => documentRowMenu({ view: () => setViewing(r), print: () => printIt(r) })}
            {...cardsProps<ReturnRow>(display, (r) => r.id, setViewing, (r) => ({ title: r.return_no, facts: [
              ["Date", fmtDate(r.created_at)], ["Delivery Location", siteName(r.warehouse_id)], ["Units", lines(r).length], ["Returned Value", rm(returned(r))],
            ] }))}
            toolbarEnd={<><TableCardsTabs label="Customer Consignment Returns" value={display} onChange={setDisplay} /><Button variant="primary" icon="add" onClick={() => setOpen(true)}>New Customer Consignment Return</Button></>}
            emptyMessage="No customer consignment returns yet." />
        </ListPageShell>
      )}
      <Modal open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)} width="wide" title={viewing?.return_no ?? "Customer Consignment Return"}
        footer={<>
          <Button variant="neutral" onClick={() => setViewing(null)}>Close</Button>
          {viewing && <Button variant="neutral" icon="print" onClick={() => printIt(viewing)}>{PRINT}</Button>}
        </>}>
        {viewing && (
          <div className="flex flex-col gap-4">
            <DetailSection title="Return Info">
              <Facts facts={[
                ["Return Date", fmtDate(viewing.created_at)], ["Delivery Location", siteName(viewing.warehouse_id)],
                ["Returned Value", rm(returned(viewing))], ["Note", viewing.note ?? ""],
              ]} />
            </DetailSection>
            <DetailSection title={`Returned Items (${lines(viewing).length})`}>
              <DocumentTable label="Returned Items"
                columns={[{ key: "sku", label: "Item" }, { key: "unit", label: "Unit ID" }, { key: "customer", label: "Customer" }, { key: "csn", label: "Consignment Note No" }, { key: "qty", label: "Qty", numeric: true }, { key: "total", label: "Total", numeric: true }]}
                rows={lines(viewing).map((l, i) => ({
                  key: String(i),
                  cells: { sku: l.ops_stock_items?.sku ?? "", unit: l.ops_stock_items?.unit_code ?? "", customer: l.consignment_notes?.customer_name ?? "", csn: l.consignment_notes?.note_no ?? "", qty: 1, total: rm(linePrice(l)) },
                }))} />
            </DetailSection>
            <RelationshipMap current={{ kind: WORD.ret, no: viewing.return_no }}
              links={[...new Set(lines(viewing).map((l) => l.consignment_notes?.note_no).filter((x): x is string => Boolean(x)))].map((no) => ({ kind: WORD.note, no, tab: TAB.note }))} />
            <DocHistory events={[{ at: viewing.created_at, word: "Created" }]} />
          </div>
        )}
      </Modal>
      <Modal open={open} onOpenChange={setOpen} width="wide" title="New Customer Consignment Return"
        description="Unsold Units come back into stock. No refund: nothing was paid for them."
        footer={<>
          <Button variant="neutral" onClick={() => setOpen(false)}>Close</Button>
          <Button variant="primary" loading={save.isPending} disabled={!siteId || picked.length === 0} onClick={() => save.mutate()}>Save</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <Select id="ccr-site" label="Delivery Location" value={siteId || undefined} onValueChange={setSiteId}
            options={(choices.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          {notes.isError && <LoadError message="The Units could not be loaded." onRetry={() => void notes.refetch()} />}
          <Ticks list={out} picked={picked} onChange={setPicked} empty="No Units are at a customer." />
          <Textarea id="ccr-note" label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {save.isError && <FieldError>{errorText(save.error)}</FieldError>}
        </div>
      </Modal>
    </Page>
  );
}
