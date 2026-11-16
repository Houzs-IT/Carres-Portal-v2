// Carres only (not part of Houzs's code): Supplier Pickups, the Carres side of a pickup request.
//
// Carres collects goods at the supplier's warehouse. Here staff tick the Sales Orders Carres will come for, name the
// day, and send the request; the supplier sees it on its own pages and accepts; after the lorry has the goods, the
// supplier marks it collected with the Delivery Order Carres signed, or staff record the collection here. A supplier
// can be asked only for the lines it is shared in Settings › Supplier Access, and a line sits on one live request at
// a time.
//
// The supplier may ASK to move an accepted pickup to another day, or to cancel it. Nothing changes until Carres
// answers here (owner, 17 Nov 2026): Carres books its lorry for the day it asked for.
//
// A request is a notice and its answer. It moves no stock: goods still enter the books through the Purchase Order
// and its goods receipt.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Download, Plus, Send, X as XIcon } from "lucide-react";
import { PageHeader } from "../../components/Layout";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DataTable, type Column } from "../../components/DataTable";
import { FilterPills } from "../../components/FilterPills";
import { ListSkeleton } from "../../components/Skeleton";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../hooks/useToast";
import { useDialog } from "../../hooks/useDialog";
import { useAuth } from "../../auth/AuthContext";
import { cn } from "../../lib/utils";
import { DateField } from "../../vendor/scm/components/DateField";
import { Card, Drawer, Fact, LineList, Missing, SoStatusBadge, count, fmtDay, fmtStamp } from "./parts";
import { pickupApi, type EligibleLine, type PickupAsk, type PickupStatus, type StaffPickup } from "./staffApi";

const problem = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const INPUT = "h-9 rounded-md border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Today in Kuala Lumpur, YYYY-MM-DD: the earliest day a pickup can be asked for. */
const todayMyt = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

const STATUS: Record<PickupStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "error" }> = {
  REQUESTED: { label: "Waiting for supplier", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "accent" },
  COLLECTED: { label: "Collected", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};
const StatusBadge = ({ status }: { status: PickupStatus }) => <Badge tone={STATUS[status].tone} size="sm" caseless>{STATUS[status].label}</Badge>;
const collectOn = (p: { expectedDate: string; expectedTime: string | null }): string => `${fmtDay(p.expectedDate)}${p.expectedTime ? `, ${p.expectedTime}` : ""}`;

/** What the supplier asked, in a few words. */
const askWords = (a: Pick<PickupAsk, "kind" | "date">): string => (a.kind === "date" ? `Move to ${fmtDay(a.date)}` : "Cancel");
/** The supplier's waiting ask, beside the status: Carres has to answer it. */
const AskBadge = ({ ask }: { ask: PickupAsk }) => (
  <Badge tone="warning" size="sm" caseless>{ask.kind === "date" ? "Supplier asks to move" : "Supplier asks to cancel"}</Badge>
);

// ── A new request: choose the supplier, tick the Sales Orders, name the day ─────────────────────────────────────

function NewRequest({ onDone, onCancel }: { onDone: (p: StaffPickup) => void; onCancel: () => void }) {
  const toast = useToast();
  const suppliers = useQuery("carres-supplier-pickups:suppliers", () => pickupApi.suppliers());
  const [supplierId, setSupplierId] = useState("");
  const eligible = useQuery(`carres-supplier-pickups:eligible:${supplierId}`, () => pickupApi.eligible(supplierId), [supplierId], { enabled: !!supplierId });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // One supplier with access: it is the choice.
  useEffect(() => {
    const only = suppliers.data?.suppliers;
    if (only?.length === 1 && !supplierId) setSupplierId(only[0]!.id);
  }, [suppliers.data, supplierId]);
  useEffect(() => { setTicked(new Set()); }, [supplierId]);

  const lines = supplierId ? eligible.data?.lines ?? [] : [];
  const orders = useMemo(() => {
    const groups = new Map<string, EligibleLine[]>();
    for (const l of lines) groups.set(l.soDocNo, [...(groups.get(l.soDocNo) ?? []), l]);
    return [...groups.entries()];
  }, [lines]);
  const tickedLines = lines.filter((l) => ticked.has(l.soItemId));
  const tickedOrders = new Set(tickedLines.map((l) => l.soDocNo)).size;
  const units = tickedLines.reduce((a, l) => a + l.qty, 0);

  const toggle = (ids: string[], on: boolean) => setTicked((before) => {
    const next = new Set(before);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await pickupApi.create({ supplierId, expectedDate: date, expectedTime: time || null, note: note.trim() || null, soItemIds: [...ticked] });
      toast.success(`${out.pickup.requestNo} is with ${out.pickup.supplierName}`);
      onDone(out.pickup);
    } catch (e) {
      toast.error(problem(e));
      eligible.reload();
    } finally {
      setBusy(false);
    }
  };

  const allIds = lines.map((l) => l.soItemId);
  const allOn = allIds.length > 0 && allIds.every((id) => ticked.has(id));

  return (
    <div className="space-y-4">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft size={13} /> Supplier Pickups
      </button>
      <Card title="1 · Supplier">
        <div className="p-4">
          {suppliers.error ? <div className="text-[12.5px] text-err">{suppliers.error}</div>
            : !suppliers.data ? <ListSkeleton rows={1} />
              : suppliers.data.suppliers.length === 0 ? (
                <div className="text-[12.5px] text-ink-secondary">No supplier has access on. Turn a supplier's access on in Settings › Supplier Access first.</div>
              ) : (
                <select className={cn(INPUT, "w-full max-w-md")} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
                  <option value="">Choose the supplier Carres will collect from</option>
                  {suppliers.data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              )}
        </div>
      </Card>

      {supplierId && (
        <Card
          title="2 · Sales Orders to collect"
          aside={lines.length > 0 && (
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={allOn} onChange={(e) => toggle(allIds, e.target.checked)} /> Tick all
            </label>
          )}
        >
          {eligible.error ? <div className="p-4 text-[12.5px] text-err">{eligible.error}</div>
            : !eligible.data ? <div className="p-4"><ListSkeleton rows={3} /></div>
              : orders.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12.5px] text-ink-muted">
                  Nothing to collect from this supplier: every shared line is already on a pickup request, or its order is delivered or cancelled.
                </div>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {orders.map(([docNo, group]) => {
                    const ids = group.map((l) => l.soItemId);
                    const on = ids.every((id) => ticked.has(id));
                    const some = !on && ids.some((id) => ticked.has(id));
                    const head = group[0]!;
                    return (
                      <li key={docNo}>
                        <label className={cn("flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2", on && "bg-primary-soft/40")}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={on}
                            ref={(el) => { if (el) el.indeterminate = some; }}
                            onChange={(e) => toggle(ids, e.target.checked)}
                            aria-label={`Sales Order ${docNo}`}
                          />
                          <span className="font-mono text-[13px] font-bold text-primary-ink">{docNo}</span>
                          <SoStatusBadge status={head.status} />
                          <span className="text-[12.5px] text-ink">{head.customerName}</span>
                          <span className="text-[11.5px] text-ink-muted">Ordered {fmtDay(head.soDate) || "no date"} · Delivery {fmtDay(head.deliveryDate) || "not set"}</span>
                          <span className="ml-auto font-mono text-[12px] font-semibold text-ink">{count(group.reduce((a, l) => a + l.qty, 0), "unit")}</span>
                        </label>
                        <ul className="pb-2 pl-12 pr-4">
                          {group.map((l) => (
                            <li key={l.soItemId}>
                              <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-primary" checked={ticked.has(l.soItemId)} onChange={(e) => toggle([l.soItemId], e.target.checked)} />
                                <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                                  {l.description || l.itemCode}
                                  <span className="ml-2 font-mono text-[11px] text-ink-muted">{l.itemCode}</span>
                                  {l.spec && <span className="block text-[11.5px] text-ink-secondary">{l.spec}</span>}
                                </span>
                                <span className="shrink-0 font-mono text-[12.5px] font-bold text-ink">{l.qty} <span className="text-[10.5px] font-semibold text-ink-muted">{l.uom}</span></span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
        </Card>
      )}

      {supplierId && (
        <Card title="3 · When Carres will collect">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-4">
              {/* The engine's own date box (one date format on every page), not the browser's. */}
              <div><span className="mb-1 block text-[12px] font-semibold text-ink">Pickup date</span>
                <DateField value={date} onChange={setDate} min={todayMyt()} aria-label="Pickup date" style={{ height: 36 }} />
              </div>
              <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Time <span className="font-normal text-ink-muted">(optional)</span></span>
                <input type="time" className={INPUT} value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Note to the supplier <span className="font-normal text-ink-muted">(optional)</span></span>
              <textarea className={cn(INPUT, "h-20 w-full max-w-xl resize-y py-2")} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lorry number, driver, loading bay" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {/* The act is named, not the transport (COPY-STANDARD: no `Send` on a button): Carres asks the supplier
                  for a pickup, and the supplier reads it on its own pages. */}
              <Button icon={<Send size={14} />} onClick={send} disabled={busy || ticked.size === 0 || !date}>{busy ? "Requesting" : "Request pickup"}</Button>
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <span className="text-[12px] text-ink-secondary">
                {ticked.size === 0 ? "Tick at least one Sales Order." : `${count(tickedOrders, "sales order")} · ${count(tickedLines.length, "line")} · ${count(units, "unit")}`}
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── One request: what was asked, where it stands, and the two things Carres may do ──────────────────────────────

function RequestView({ pickup, canAct, onClose, onChanged }: { pickup: StaffPickup | null; canAct: boolean; onClose: () => void; onChanged: (p: StaffPickup) => void }) {
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const p = pickup;
  const live = p?.status === "REQUESTED" || p?.status === "ACCEPTED";

  const bySo = useMemo(() => {
    const groups = new Map<string, StaffPickup["lines"]>();
    for (const l of p?.lines ?? []) groups.set(l.soDocNo, [...(groups.get(l.soDocNo) ?? []), l]);
    return [...groups.entries()];
  }, [p]);

  const collect = async () => {
    if (!p || busy) return;
    const unaccepted = p.status === "REQUESTED";
    if (!(await dialog.confirm({
      title: `Mark ${p.requestNo} collected?`,
      message: unaccepted
        ? `${p.supplierName} has not accepted this request. Mark it collected only if Carres already has the goods: ${count(p.unitCount, "unit")}.`
        : `Carres has all the goods on this request: ${count(p.unitCount, "unit")} from ${p.supplierName}.`,
      confirmLabel: "Mark collected",
    }))) return;
    setBusy(true);
    try { const out = await pickupApi.collect(p.id); toast.success(`${p.requestNo} is collected`); onChanged(out.pickup); }
    catch (e) { toast.error(problem(e)); } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!p || busy) return;
    const reason = await dialog.prompt({
      title: `Cancel ${p.requestNo}?`,
      message: "The supplier reads this reason. The Sales Orders can be put on a new request afterwards.",
      placeholder: "Why is it cancelled?",
      confirmLabel: "Cancel request",
      cancelLabel: "Keep request",
      required: true,
      danger: true,
    });
    if (!reason) return;
    setBusy(true);
    try { const out = await pickupApi.cancel(p.id, reason); toast.success(`${p.requestNo} is cancelled`); onChanged(out.pickup); }
    catch (e) { toast.error(problem(e)); } finally { setBusy(false); }
  };

  // The supplier's ask: approving it moves the day or cancels the request; declining keeps it as it is. The supplier
  // reads the answer, and the reason when one is given.
  const approve = async () => {
    if (!p?.ask || busy) return;
    const ask = p.ask;
    if (!(await dialog.confirm({
      title: ask.kind === "date" ? `Move ${p.requestNo} to ${fmtDay(ask.date)}?` : `Cancel ${p.requestNo}?`,
      message: ask.kind === "date"
        ? `${p.supplierName} asked to have the goods ready on ${fmtDay(ask.date)} instead of ${fmtDay(p.expectedDate)}. Approve only once the lorry is booked for the new day.`
        : `${p.supplierName} asked to cancel this pickup. Its Sales Orders can be put on a new request afterwards.`,
      confirmLabel: ask.kind === "date" ? "Approve new day" : "Approve cancel",
    }))) return;
    setBusy(true);
    try {
      const out = await pickupApi.approveAsk(p.id);
      toast.success(ask.kind === "date" ? `${p.requestNo} moved to ${fmtDay(ask.date)}` : `${p.requestNo} is cancelled`);
      onChanged(out.pickup);
    } catch (e) { toast.error(problem(e)); } finally { setBusy(false); }
  };

  const decline = async () => {
    if (!p?.ask || busy) return;
    const reason = await dialog.prompt({
      title: p.ask.kind === "date" ? `Keep ${p.requestNo} on ${fmtDay(p.expectedDate)}?` : `Keep ${p.requestNo}?`,
      message: "The supplier reads your answer. A reason helps them, but you may leave it empty.",
      placeholder: "Why the pickup stays as it is (optional)",
      confirmLabel: "Decline",
      cancelLabel: "Back",
    });
    if (reason === null) return;
    setBusy(true);
    try { const out = await pickupApi.declineAsk(p.id, reason.trim() || null); toast.success(`${p.requestNo} stays as it is`); onChanged(out.pickup); }
    catch (e) { toast.error(problem(e)); } finally { setBusy(false); }
  };

  const downloadDo = async () => {
    if (!p?.deliveryOrder) return;
    try { await pickupApi.downloadDeliveryOrder(p.id, p.deliveryOrder.name); } catch (e) { toast.error(problem(e)); }
  };

  return (
    <Drawer
      open={!!p}
      onClose={onClose}
      title={p?.requestNo ?? ""}
      subtitle="Pickup Request"
      headerRight={p && <span className="flex items-center gap-1.5">{p.ask && <AskBadge ask={p.ask} />}<StatusBadge status={p.status} /></span>}
      footer={p && live && canAct && (
        <>
          <Button icon={<Check size={14} />} onClick={collect} disabled={busy}>Mark collected</Button>
          <Button variant="danger" icon={<XIcon size={14} />} onClick={cancel} disabled={busy}>Cancel request</Button>
        </>
      )}
    >
      {p && (
        <>
          <div className="text-[19px] font-bold text-ink">{p.supplierName}</div>
          <div className="mt-1 text-[12.5px] text-ink-secondary">Collect on {collectOn(p)} · {count(p.soDocNos.length, "sales order")} · {count(p.unitCount, "unit")}</div>
          {p.ask && (
            <div className="mt-4 rounded-md border border-warning-text/30 bg-warning-bg px-3 py-3 text-[12.5px] text-warning-text">
              <div className="font-semibold">
                {p.ask.kind === "date"
                  ? `${p.supplierName} asks to move this pickup from ${fmtDay(p.expectedDate)} to ${fmtDay(p.ask.date)}.`
                  : `${p.supplierName} asks to cancel this pickup.`}
              </div>
              <div className="mt-0.5">Asked by {p.ask.askedByName} on {fmtStamp(p.ask.askedAt)}. Nothing changes until Carres answers.</div>
              {canAct && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button icon={<Check size={14} />} onClick={approve} disabled={busy}>{p.ask.kind === "date" ? "Approve new day" : "Approve cancel"}</Button>
                  <Button variant="secondary" onClick={decline} disabled={busy}>Decline</Button>
                </div>
              )}
            </div>
          )}
          {p.status === "CANCELLED" && (
            <div className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-ink-secondary">
              {p.cancelledBySupplier ? "Cancelled at the supplier's request." : `Cancelled: ${p.cancelReason || "no reason recorded"}`}
            </div>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-border bg-surface-2 px-4 py-4">
            <Fact label="Requested">{fmtStamp(p.requestedAt)}{p.requestedByName ? ` · ${p.requestedByName}` : ""}</Fact>
            <Fact label="Accepted by supplier">{p.acceptedAt ? <>{fmtStamp(p.acceptedAt)}{p.acceptedByName ? ` · ${p.acceptedByName}` : ""}</> : <Missing>Not accepted yet</Missing>}</Fact>
            <Fact label="Collected">
              {p.collectedAt
                ? <>{fmtStamp(p.collectedAt)}{p.collectedBySupplierName ? ` · ${p.collectedBySupplierName} (${p.supplierName})` : p.collectedByName ? ` · ${p.collectedByName}` : ""}</>
                : <Missing>Not collected yet</Missing>}
            </Fact>
            <Fact label="Note to supplier">{p.note || <Missing>No note</Missing>}</Fact>
            {p.previousExpectedDate && (
              <Fact label="Date changed">{fmtDay(p.previousExpectedDate)} → {fmtDay(p.expectedDate)}{p.dateChangedAt ? ` · ${fmtStamp(p.dateChangedAt)}` : ""}</Fact>
            )}
            {p.deliveryOrder && (
              <Fact label="Delivery Order">
                <button type="button" onClick={downloadDo} className="inline-flex max-w-full items-center gap-1 text-left font-semibold text-primary-ink hover:underline">
                  <Download size={12} className="shrink-0" /><span className="truncate">{p.deliveryOrder.name}</span>
                </button>
              </Fact>
            )}
            {!p.ask && p.answer && (
              <Fact label="Supplier's last ask" wide>
                {askWords(p.answer)}
                {" · "}{p.answer.approved ? "Approved" : "Declined"}{p.answer.byName ? ` by ${p.answer.byName}` : ""} on {fmtStamp(p.answer.answeredAt)}
                {p.answer.reason ? ` · ${p.answer.reason}` : ""}
              </Fact>
            )}
            {p.cancelledAt && <Fact label="Cancelled" wide>{fmtStamp(p.cancelledAt)}{p.cancelledByName ? ` · ${p.cancelledByName}` : ""}</Fact>}
          </dl>
          {bySo.map(([docNo, lines]) => (
            <Card key={docNo} className="mt-5" title={`${docNo} · ${count(lines.reduce((a, l) => a + l.qty, 0), "unit")}`}>
              <LineList lines={lines.map((l) => ({ key: l.soItemId, itemCode: l.itemCode, description: l.description, spec: l.spec, modelName: l.modelName, uom: l.uom, qty: l.qty }))} />
            </Card>
          ))}
        </>
      )}
    </Drawer>
  );
}

// ── The list ────────────────────────────────────────────────────────────────────────────────────────────────────

type Tab = "open" | "asked" | "collected" | "cancelled" | "all";

const COLUMNS: Column<StaffPickup>[] = [
  {
    key: "no", label: "Request No", alwaysVisible: true, getValue: (p) => p.requestNo,
    render: (p) => <span className="font-docno text-[12.5px] font-semibold text-primary-ink">{p.requestNo}</span>,
  },
  { key: "supplier", label: "Supplier", getValue: (p) => p.supplierName, render: (p) => p.supplierName },
  {
    key: "date", label: "Collect on", getValue: (p) => `${p.expectedDate} ${p.expectedTime ?? ""}`.trim(), filterType: "date",
    dateValue: (p) => p.expectedDate, filterLabel: (v) => fmtDay(v) || v, render: collectOn,
  },
  {
    key: "orders", label: "Sales Orders", getValue: (p) => p.soDocNos.join(", "), getFilterValues: (p) => p.soDocNos, disableSort: true,
    render: (p) => (
      <div className="flex min-w-[150px] max-w-[300px] flex-wrap gap-x-2 gap-y-0.5 whitespace-normal font-docno text-[11.5px]">
        {p.soDocNos.slice(0, 3).map((d) => <span key={d}>{d}</span>)}
        {p.soDocNos.length > 3 && <span className="text-ink-muted">+{p.soDocNos.length - 3} more</span>}
      </div>
    ),
  },
  { key: "units", label: "Qty", align: "right", getValue: (p) => p.unitCount, render: (p) => p.unitCount, total: (rows) => rows.reduce((a, p) => a + p.unitCount, 0).toLocaleString("en-MY") },
  {
    key: "status", label: "Status", getValue: (p) => (p.ask ? `${STATUS[p.status].label} · ${askWords(p.ask)}` : STATUS[p.status].label),
    getFilterValues: (p) => [STATUS[p.status].label],
    render: (p) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusBadge status={p.status} />
        {p.ask && <AskBadge ask={p.ask} />}
      </span>
    ),
  },
  {
    key: "requested", label: "Requested", getValue: (p) => p.requestedAt, disableFilter: true,
    render: (p) => <span className="text-ink-secondary">{fmtStamp(p.requestedAt)}{p.requestedByName ? ` · ${p.requestedByName}` : ""}</span>,
  },
];

export function SupplierPickupsPage() {
  const { pageAccess, can } = useAuth();
  const level = pageAccess("scm.procurement.po");
  const canAct = can("*") || level === "edit" || level === "full";
  const list = useQuery("carres-supplier-pickups:list", () => pickupApi.list());
  const [tab, setTab] = useState<Tab>("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<StaffPickup | null>(null);

  const rows = list.data?.rows ?? [];
  const isOpen = (p: StaffPickup) => p.status === "REQUESTED" || p.status === "ACCEPTED";
  const shown = tab === "all" ? rows
    : tab === "open" ? rows.filter(isOpen)
      : tab === "asked" ? rows.filter((p) => !!p.ask)
        : rows.filter((p) => p.status === (tab === "collected" ? "COLLECTED" : "CANCELLED"));
  const opened = openId ? (fresh?.id === openId ? fresh : rows.find((p) => p.id === openId) ?? null) : null;

  if (creating) {
    return (
      <>
        <PageHeader eyebrow="Supply Chain" title="New Pickup Request" description="Tick the Sales Orders Carres will collect from the supplier's warehouse, and name the day. The supplier sees the request at once." />
        <NewRequest
          onCancel={() => setCreating(false)}
          onDone={(p) => { setCreating(false); setTab("open"); setFresh(p); setOpenId(p.id); list.reload(); }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Supply Chain"
        title="Supplier Pickups"
        description="Tell a supplier which Sales Order goods Carres will collect at its warehouse, and when. The supplier accepts on its own pages and marks the request collected with the Delivery Order Carres signed. A supplier's ask to move or cancel a pickup waits here for your answer."
        primaryAction={canAct ? <Button icon={<Plus size={14} />} onClick={() => setCreating(true)}>New Pickup Request</Button> : undefined}
      />
      <div className="mb-3">
        <FilterPills
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: "Open", count: rows.filter(isOpen).length },
            { value: "asked", label: "Asked by supplier", count: rows.filter((p) => !!p.ask).length },
            { value: "collected", label: "Collected", count: rows.filter((p) => p.status === "COLLECTED").length },
            { value: "cancelled", label: "Cancelled", count: rows.filter((p) => p.status === "CANCELLED").length },
            { value: "all", label: "All", count: rows.length },
          ]}
        />
      </div>
      {list.error && <div className="mb-3 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-[12.5px] text-err">{list.error}</div>}
      {!list.data && !list.error ? <ListSkeleton rows={5} /> : (
        <DataTable<StaffPickup>
          tableId="carres-staff-supplier-pickups"
          documentLabel="Supplier Pickups"
          exportName={`supplier-pickups-${tab}`}
          columns={COLUMNS}
          rows={shown}
          getRowKey={(p) => p.id}
          getRowClassName={(p) => (p.id === openId ? "bg-primary-soft/40" : undefined)}
          onRowClick={(p) => { setFresh(null); setOpenId(p.id); }}
          emptyLabel={tab === "open" ? "No pickup request is open. Start one with New Pickup Request." : tab === "asked" ? "No supplier is waiting for an answer." : "No pickup requests here."}
          clientSearch={{ placeholder: "Search request no, supplier or SO no" }}
        />
      )}
      <RequestView
        pickup={opened}
        canAct={canAct}
        onClose={() => setOpenId(null)}
        onChanged={(p) => { setFresh(p); list.reload(); }}
      />
    </>
  );
}
