// Carres only (not part of Houzs's code): the supplier's Pickup Requests.
//
// Carres asks to collect goods at the supplier's warehouse on a day. The supplier accepts (the goods will be ready),
// and when Carres's lorry has the goods the supplier marks the request collected with the Delivery Order Carres
// signed. A supplier that cannot keep the day ASKS Carres for another one, or asks Carres to cancel: nothing moves
// until Carres agrees (owner, 17 Nov 2026), because Carres has already planned the lorry. A request is a notice and
// its answer; it moves no stock.
//
// Drawn to the owner's design of 17 Nov 2026: a row opens in place with the request's goods and its next step;
// ticking rows puts a review above the list that accepts, or marks collected, many requests at once.
import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { supplierApi, type Pickup } from "./api";
import { ORDERS_KEY, refreshShared, usePickups } from "./data";
import { Calendar, fromToText } from "./Calendar";
import { CardsCount, CardsView, ListCount, ListTable, Toolbar, exportList, useListPrefs, type CardSpec, type Column } from "./ListTable";
import { PageBar, PageBody, useSupplierSession } from "./Shell";
import { Badge, Facts, LoadError, Loading, PdfMark, Pills, StatStrip, ViewToggle, collectOn, count, fmtDay, fmtStamp, pickupBadge, play, plural, todayMyt, useToast, type FactSpec } from "./ui";

type Tab = "todo" | "accepted" | "collected" | "cancelled" | "all";
const TAB_STATUS: Record<Exclude<Tab, "all">, Pickup["status"]> = { todo: "REQUESTED", accepted: "ACCEPTED", collected: "COLLECTED", cancelled: "CANCELLED" };
const tabOf = (p: Pickup): Tab => (p.status === "REQUESTED" ? "todo" : p.status === "ACCEPTED" ? "accepted" : p.status === "COLLECTED" ? "collected" : "cancelled");

const units = (lines: Array<{ qty: number }>) => lines.reduce((a, l) => a + l.qty, 0);
const customersOf = (p: Pickup) => new Map((p.orders ?? []).map((o) => [o.docNo, o.customerName]));

const COLUMNS: Column<Pickup>[] = [
  { key: "no", label: "Request No", width: 140, render: (p) => ({ kind: "doc", v: p.requestNo }), exportValue: (p) => p.requestNo },
  { key: "collect", label: "Carres collects on", width: 170, render: (p) => ({ kind: "text", v: collectOn(p), bold: true }), exportValue: (p) => collectOn(p) },
  { key: "sos", label: "Sales Orders", width: 260, render: (p) => ({ kind: "text", v: p.soDocNos.join(", "), fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (p) => p.soDocNos.join(", ") },
  { key: "lines", label: "Lines", width: 70, align: "right", render: (p) => ({ kind: "text", v: p.lineCount }), exportValue: (p) => p.lineCount },
  { key: "qty", label: "Qty", width: 64, align: "right", render: (p) => ({ kind: "text", v: p.unitCount }), exportValue: (p) => p.unitCount },
  { key: "requested", label: "Requested", width: 140, render: (p) => ({ kind: "text", v: fmtStamp(p.requestedAt), fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (p) => fmtStamp(p.requestedAt) },
  { key: "note", label: "Note from Carres", width: 220, hidden: true, render: (p) => ({ kind: "text", v: p.note || "No note", fg: p.note ? undefined : "rgb(var(--hz-ink-muted))" }), exportValue: (p) => p.note ?? "" },
  { key: "status", label: "Status", width: 170, render: (p) => ({ kind: "badge", b: pickupBadge(p) }), exportValue: (p) => pickupBadge(p).label },
];

const matches = (p: Pickup, q: string) => !q || `${p.requestNo} ${p.soDocNos.join(" ")}`.toLowerCase().includes(q.toLowerCase());

export function PickupsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { can, refresh } = useSupplierSession();
  const pickups = usePickups();
  const api = useListPrefs("pickups");
  const search = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>(() => (search.get("open") ? ((search.get("tab") as Tab | null) ?? "all") : "todo"));
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(() => search.get("open"));
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // A link to one request (from a Sales Order, or an old address) opens it once, then leaves the address plain.
  useEffect(() => {
    if (search.get("open")) navigate("/supplier/pickups", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = pickups.data ?? [];
  const n = (s: Pickup["status"]) => all.filter((p) => p.status === s).length;
  const waiting = n("REQUESTED");
  const shown = useMemo(() => all.filter((p) => (tab === "all" || p.status === TAB_STATUS[tab]) && matches(p, q.trim())), [all, tab, q]);
  const next = [...all].filter((p) => p.status === "REQUESTED" || p.status === "ACCEPTED").sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).at(0);

  const ticked = all.filter((p) => picked[p.id]);
  const reviewing = ticked.length > 0;

  /** Put what the server answered in place, and read again what it changes elsewhere. */
  const landed = (changed: Pickup[]) => {
    const byId = new Map(changed.map((p) => [p.id, p]));
    pickups.put(all.map((p) => byId.get(p.id) ?? p));
    refreshShared(ORDERS_KEY);
    refresh();
  };

  const doExport = async () => {
    try { await exportList("pickup-requests", COLUMNS, api.prefs, ticked.length ? shown.filter((p) => picked[p.id]) : shown); }
    catch (e) { toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red"); }
  };

  const openRow = (p: Pickup) => {
    setTab((t) => (t === "all" || t === tabOf(p) ? t : tabOf(p)));
    setOpenKey(p.id);
  };

  const cards: CardSpec[] = shown.map((p) => ({
    key: p.id, doc: p.requestNo, badge: pickupBadge(p), title: `Carres collects on ${collectOn(p)}`, line: p.soDocNos.join(" · "),
    footLabel: "Requested", footValue: fmtStamp(p.requestedAt), rightLabel: count(p.lineCount, "line"), right: count(p.unitCount, "unit"),
    onOpen: () => { api.setMode("table"); openRow(p); },
  }));

  const empty = q.trim() ? `No pickup request matches "${q.trim()}".` : tab === "todo" ? "Nothing to accept. New requests from Carres appear here." : "No pickup requests here.";

  return (
    <>
      <PageBar eyebrow="Warehouse and Operation" title="Pickup Requests" />
      <PageBody scroll={false} riseKey="pickups">
        {!reviewing && (
          <StatStrip
            stats={[
              { label: "To Accept", value: waiting, rail: "rgb(var(--hz-err))", fg: waiting ? "rgb(var(--hz-warning-text))" : undefined, active: tab === "todo", onClick: () => setTab("todo") },
              { label: "Accepted", value: n("ACCEPTED"), rail: "rgb(var(--hz-primary-ink))", active: tab === "accepted", onClick: () => setTab("accepted") },
              { label: "Next Pickup", value: next ? fmtDay(next.expectedDate) : "None", rail: "rgb(var(--hz-warning-text))", onClick: next ? () => openRow(next) : undefined },
              { label: "Collected", value: n("COLLECTED"), rail: "rgb(var(--hz-synced))", fg: "rgb(var(--hz-synced))", active: tab === "collected", onClick: () => setTab("collected") },
            ]}
          />
        )}
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
          <Pills<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { key: "todo", label: "To accept", count: waiting },
              { key: "accepted", label: "Accepted", count: n("ACCEPTED") },
              { key: "collected", label: "Collected", count: n("COLLECTED") },
              { key: "cancelled", label: "Cancelled", count: n("CANCELLED") },
              { key: "all", label: "All", count: all.length },
            ]}
          />
          <div className="flex-1" />
          <ViewToggle value={api.prefs.mode} onChange={api.setMode} />
        </div>
        <Toolbar search={q} onSearch={setQ} placeholder="Search request no or SO no" rowCount={shown.length} columns={COLUMNS} api={api}
          onExport={doExport} exportCount={ticked.length} canExport={can("operation", "a_export")} />
        {reviewing && <Review picked={ticked} onClear={() => setPicked({})} onDone={(changed) => { setPicked({}); landed(changed); }} />}
        {pickups.error && !pickups.data ? (
          <LoadError message={pickups.error} onRetry={pickups.reload} />
        ) : !pickups.data ? (
          <Loading />
        ) : api.prefs.mode === "cards" ? (
          <CardsView cards={cards} picked={picked} onPick={setPicked} empty={empty} footer={<CardsCount>{count(shown.length, "pickup request")}</CardsCount>} />
        ) : (
          <ListTable<Pickup>
            columns={COLUMNS} rows={shown} rowKey={(p) => p.id} api={api}
            openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
            expanded={(p) => <PickupExpansion pickup={p} onChanged={landed} />}
            picked={picked} onPick={setPicked} empty={empty}
            footer={<ListCount>{count(shown.length, "pickup request")}</ListCount>}
          />
        )}
      </PageBody>
    </>
  );
}

// ── One request, opened in its row ──────────────────────────────────────────────────────────────────────────────

const ACT = "inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-all duration-[160ms]";
const BACK = "inline-flex h-[38px] w-auto shrink-0 items-center justify-center rounded-lg border border-border bg-surface px-[14px] text-[13px] font-semibold text-ink-secondary transition-all duration-[160ms]";

type Step = { mode: "collect" } | { mode: "date"; day: string } | { mode: "cancel" } | null;

function PickupExpansion({ pickup: p, onChanged }: { pickup: Pickup; onChanged: (changed: Pickup[]) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useSupplierSession();
  const [step, setStep] = useState<Step>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayMyt();

  const run = async (work: () => Promise<Pickup[]>, ok: string, tone: "green" | "red" = "green") => {
    if (busy) return;
    setBusy(true);
    try {
      const changed = await work();
      setStep(null);
      setFile(null);
      onChanged(changed);
      toast(ok, tone);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not work. Try again.", "red");
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const by = new Map<string, Pickup["lines"]>();
    for (const l of p.lines) by.set(l.soDocNo, [...(by.get(l.soDocNo) ?? []), l]);
    return [...by.entries()];
  }, [p.lines]);

  const done = p.status === "ACCEPTED" || p.status === "COLLECTED";
  const facts: FactSpec[] = [
    { label: "Requested by Carres", value: fmtStamp(p.requestedAt) || "Not known", muted: !p.requestedAt },
    { label: "Accepted", value: done && p.acceptedAt ? `${fmtStamp(p.acceptedAt)}${p.acceptedByName ? ` · ${p.acceptedByName}` : ""}` : "Not accepted yet", muted: !(done && p.acceptedAt) },
    {
      label: "Collected",
      value: p.status === "COLLECTED" ? `${fmtStamp(p.collectedAt)}${p.collectedBySupplierName ? ` · ${p.collectedBySupplierName}` : ""}` : "Not collected yet",
      muted: p.status !== "COLLECTED",
    },
    ...(p.previousExpectedDate ? [{ label: "Date changed", value: `${fmtDay(p.previousExpectedDate)} → ${fmtDay(p.expectedDate)}`, fg: "rgb(var(--hz-warning-text))" }] : []),
    ...(p.ask ? [{
      label: "Waiting for Carres",
      value: p.ask.kind === "date" ? `New date ${fmtDay(p.ask.date)} asked ${fmtStamp(p.ask.askedAt)}` : `Cancel asked ${fmtStamp(p.ask.askedAt)}`,
      fg: "rgb(var(--hz-warning-text))",
    }] : []),
    ...(!p.ask && p.answer && !p.answer.approved ? [{
      label: "Carres answered",
      value: `${p.answer.kind === "date" ? "Kept the date" : "Kept the pickup"}${p.answer.reason ? `: ${p.answer.reason}` : ""}`,
      fg: "rgb(var(--hz-ink))",
    }] : []),
    ...(p.status === "COLLECTED" && p.deliveryOrder ? [{
      label: "Delivery Order",
      value: (
        <button type="button" onClick={(e) => { e.stopPropagation(); void supplierApi.deliveryOrder(p.id, p.deliveryOrder!.name).catch((err: unknown) => toast(err instanceof Error ? err.message : "The file could not be read.", "red")); }}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-primary-ink hover:underline">
          {p.deliveryOrder.name}
        </button>
      ),
    }] : []),
    { label: "Note from Carres", value: p.note || "No note", muted: !p.note },
  ];

  const pk = p.lines.length;
  const summary = `${count(p.soDocNos.length, "sales order")} · ${count(pk, "line")} · ${count(units(p.lines), "unit")}`;

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) minmax(0,0.9fr)" }}>
      <div className="min-w-0 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge b={pickupBadge(p)} size="md" />
          <span className="text-[12.5px] text-ink-muted">{summary}</span>
        </div>
        <Facts facts={facts} />
      </div>
      <div className="min-w-0 border-l border-border-subtle px-5 py-4">
        {groups.map(([so, lines]) => (
          <div key={so} className="mb-3">
            <div className="mb-1 flex justify-between gap-3">
              <h3 className="m-0 text-[12px] font-semibold text-ink-muted">{so} · {count(units(lines), "unit")}</h3>
              {can("operation", "v_orders") && (
                <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/supplier/orders/${encodeURIComponent(so)}`); }} className="text-[12px] font-semibold text-primary-ink hover:underline">Open order</a>
              )}
            </div>
            {lines.map((l, i) => (
              <div key={l.soItemId} className="flex justify-between gap-3 py-[7px]" style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{l.description}</div>
                  <div className="mt-0.5 text-[12px] text-ink-muted">{[l.itemCode, l.modelName, l.spec].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="shrink-0 text-[14px] font-bold text-ink">{l.qty} <span className="text-[11px] text-ink-muted">{l.uom}</span></div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 border-l border-border-subtle px-5 py-4">
        {p.status === "REQUESTED" && (
          can("operation", "a_accept") ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => (await supplierApi.acceptPickups([p.id])).pickups, `${p.requestNo} accepted`)}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border-0 bg-primary text-[13.5px] font-semibold text-white transition-colors duration-[160ms] hover:bg-primary-ink"
              >
                <Check size={14} aria-hidden="true" />Accept pickup
              </button>
              <div className="text-center text-[12px] text-ink-muted">Goods ready on {fmtDay(p.expectedDate)}</div>
            </>
          ) : (
            <div className="text-center text-[12px] text-ink-muted">Carres collects on {collectOn(p)}</div>
          )
        )}

        {p.status === "ACCEPTED" && step === null && (
          <>
            {can("operation", "a_collect") && (
              <button type="button" onClick={() => setStep({ mode: "collect" })} className={cn(ACT, "border-0 bg-synced text-white hover:bg-[#256F49]")}>
                <Check size={14} aria-hidden="true" />Done, goods collected
              </button>
            )}
            {p.ask ? (
              <AskWaiting pickup={p} busy={busy} canWithdraw={can("operation", p.ask.kind === "date" ? "a_date" : "a_cancel")}
                onWithdraw={() => run(async () => [(await supplierApi.withdrawAsk(p.id)).pickup], "Request taken back")} />
            ) : (can("operation", "a_date") || can("operation", "a_cancel")) && (
              <div className="flex gap-1.5">
                {can("operation", "a_date") && (
                  <button type="button" onClick={() => setStep({ mode: "date", day: p.expectedDate })} className={cn(ACT, "border border-border bg-surface text-ink hover:border-primary")}>Change date</button>
                )}
                {can("operation", "a_cancel") && (
                  <button type="button" onClick={() => setStep({ mode: "cancel" })} className={cn(ACT, "border border-err/35 bg-surface text-err hover:bg-err/[0.06]")}>Request cancel</button>
                )}
              </div>
            )}
          </>
        )}

        {p.status === "ACCEPTED" && step?.mode === "collect" && (
          <>
            <div className="text-[12px] font-semibold text-ink-secondary">Attach the Delivery Order signed by Carres</div>
            {file ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2">
                <PdfMark w={26} h={30} fs={8} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} title="Remove" aria-label="Remove" className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-ink-muted hover:bg-border-subtle hover:text-ink">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <PdfDrop onFile={setFile} big>
                <Upload size={15} aria-hidden="true" />
                <span className="text-[12.5px] font-semibold text-ink">Upload DO (PDF)</span>
                <span className="text-[11.5px] text-ink-muted">Required before marking collected</span>
              </PdfDrop>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!file || busy}
                onClick={() => file && run(async () => (await supplierApi.collectPickups([p.id], { mode: "one", file })).pickups, `${p.requestNo} marked collected`)}
                className={cn(ACT, "border-0 text-white", file ? "cursor-pointer bg-synced" : "cursor-not-allowed bg-synced/35")}
              >
                Mark collected
              </button>
              <button type="button" onClick={() => { setStep(null); setFile(null); }} className={BACK}>Back</button>
            </div>
          </>
        )}

        {p.status === "ACCEPTED" && step?.mode === "date" && (
          <>
            <div className="text-[12px] font-semibold text-ink-secondary">New pickup date</div>
            <Calendar today={today} current={p.expectedDate} value={step.day} onChange={(day) => setStep({ mode: "date", day })} />
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-ink-muted">{fromToText(p.expectedDate, step.day).from}</span>
              <span className="font-bold text-ink">{fromToText(p.expectedDate, step.day).to}</span>
            </div>
            <div className="text-[11.5px] leading-[1.45] text-ink-muted">Carres agrees the new day before it changes.</div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={step.day === p.expectedDate || busy}
                onClick={() => run(async () => [(await supplierApi.askDate(p.id, step.day)).pickup], "Date change sent to Carres")}
                className={cn(ACT, "border-0 bg-primary text-white hover:bg-primary-ink")}
                style={{ opacity: step.day === p.expectedDate ? 0.45 : 1 }}
              >
                Send to Carres
              </button>
              <button type="button" onClick={() => setStep(null)} className={BACK}>Back</button>
            </div>
          </>
        )}

        {p.status === "ACCEPTED" && step?.mode === "cancel" && (
          <>
            <div className="rounded-lg bg-err/[0.07] px-3 py-2.5 text-[12.5px] leading-[1.5] text-err">
              Ask Carres to cancel this pickup? If Carres agrees, its sales orders go back to Not requested and wait for Carres to send a new request.
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => [(await supplierApi.askCancel(p.id)).pickup], "Cancel request sent to Carres", "red")}
                className={cn(ACT, "border-0 bg-err text-white hover:bg-[#962F2F]")}
              >
                Yes, ask to cancel
              </button>
              <button type="button" onClick={() => setStep(null)} className={BACK}>Keep</button>
            </div>
          </>
        )}

        {p.status === "CANCELLED" && (
          <div className="rounded-lg bg-border-subtle px-3 py-2.5 text-[12.5px] leading-[1.5] text-ink-secondary">
            {p.cancelledBySupplier
              ? `Carres cancelled this pickup as you asked. ${p.soDocNos.join(", ")} ${p.soDocNos.length === 1 ? "is" : "are"} back to Not requested, waiting for Carres to send a new request.`
              : `Carres cancelled this request${p.cancelReason ? `: ${p.cancelReason}` : "."}`}
          </div>
        )}
        {p.status === "COLLECTED" && <div className="text-center text-[12.5px] font-semibold text-synced">Collected by Carres</div>}
      </div>
    </div>
  );
}

/** An ask that Carres has not answered yet, and the way to take it back. */
function AskWaiting({ pickup: p, busy, canWithdraw, onWithdraw }: { pickup: Pickup; busy: boolean; canWithdraw: boolean; onWithdraw: () => void }) {
  const ask = p.ask!;
  return (
    <div className="rounded-lg bg-warning-bg px-3 py-2.5 text-[12.5px] leading-[1.5] text-warning-text">
      {ask.kind === "date"
        ? <>You asked to move this pickup from {fmtDay(p.expectedDate)} to <span className="font-bold">{fmtDay(ask.date)}</span>. Waiting for Carres.</>
        : <>You asked Carres to cancel this pickup. Waiting for Carres.</>}
      {canWithdraw && (
        <button type="button" disabled={busy} onClick={onWithdraw} className="mt-1.5 block border-0 bg-transparent p-0 text-[12px] font-semibold text-warning-text underline">
          Take the request back
        </button>
      )}
    </div>
  );
}

/** A file box that takes one PDF. Anything else is turned away with a word, before it is sent. */
function PdfDrop({ onFile, children, big, className }: { onFile: (f: File) => void; children: ReactNode; big?: boolean; className?: string }) {
  const toast = useToast();
  const take = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { toast("Choose a PDF file.", "red"); return; }
    if (f.size > 10 * 1024 * 1024) { toast("The PDF is larger than 10 MB.", "red"); return; }
    onFile(f);
  };
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files.item(0)); }}
      className={cn(
        "flex cursor-pointer rounded-lg border-[1.5px] border-dashed border-border-strong text-ink-secondary transition-all duration-[160ms] hover:border-primary hover:bg-primary-soft/30",
        big ? "flex-col items-center gap-1 bg-surface-2 px-3 py-[14px] text-center" : "items-center gap-2.5 bg-surface px-3 py-2.5",
        className,
      )}
    >
      {children}
      <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

// ── The review over the list, for ticked requests ───────────────────────────────────────────────────────────────

function Review({ picked, onClear, onDone }: { picked: Pickup[]; onClear: () => void; onDone: (changed: Pickup[]) => void }) {
  const toast = useToast();
  const { can } = useSupplierSession();
  const ref = useRef<HTMLDivElement | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doMode, setDoMode] = useState<"one" | "each">("one");
  const [oneFile, setOneFile] = useState<File | null>(null);
  /** The Delivery Order attached to each request so far: a request with none has no entry. */
  const [files, setFiles] = useState<Partial<Record<string, File>>>({});
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], 300);
  }, []);
  // A different set of requests needs ticking the confirmation again.
  const ids = picked.map((p) => p.id).join(",");
  useEffect(() => { setOk(false); }, [ids]);

  const toAccept = picked.filter((p) => p.status === "REQUESTED");
  const toCollect = picked.filter((p) => p.status === "ACCEPTED");
  const mode: "accept" | "collect" | "none" = toAccept.length && can("operation", "a_accept") ? "accept" : toCollect.length && can("operation", "a_collect") ? "collect" : "none";
  const act = mode === "accept" ? toAccept : mode === "collect" ? toCollect : [];
  const skipped = picked.length - act.length;

  const sos = [...new Set(picked.flatMap((p) => p.soDocNos))];
  const products = useMemo(() => {
    const m = new Map<string, { desc: string; code: string; spec: string; uom: string; qty: number }>();
    for (const p of picked) for (const l of p.lines) {
      const k = `${l.itemCode}|${l.spec ?? ""}`;
      const e = m.get(k) ?? { desc: `${l.description}${l.modelName ? ` · ${l.modelName}` : ""}`, code: l.itemCode, spec: l.spec || "Standard", uom: l.uom, qty: 0 };
      e.qty += l.qty;
      m.set(k, e);
    }
    return [...m.values()];
  }, [picked]);
  const unitCount = products.reduce((a, x) => a + x.qty, 0);
  const skus = new Set(products.map((x) => x.code)).size;
  const days = [...new Set(act.map((p) => collectOn(p)))];

  const doReady = mode !== "collect" || (doMode === "one" ? !!oneFile : toCollect.every((p) => files[p.id]));
  const canGo = act.length > 0 && ok && doReady && !busy;
  const doCount = doMode === "one" ? (oneFile ? "1 file · all attached" : "Not attached") : `${toCollect.filter((p) => files[p.id]).length} of ${toCollect.length} attached`;

  const title = mode === "collect" ? "Review before marking collected" : mode === "accept" ? "Review before accepting" : "Nothing to do";
  const these = unitCount === 1 ? "this 1 unit" : `these ${unitCount} units`;
  const confirm = mode === "accept"
    ? `${these.charAt(0).toUpperCase()}${these.slice(1)} will be ready on ${days.join(" and ")}.`
    : mode === "collect" ? `Carres has collected ${these}.` : "Nothing selected needs an action.";
  const btn = mode === "accept" ? `Accept ${act.length} pickup${act.length === 1 ? "" : "s"}` : mode === "collect" ? `Mark ${act.length} pickup${act.length === 1 ? "" : "s"} collected` : "Nothing to do";

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    try {
      if (mode === "accept") {
        const out = await supplierApi.acceptPickups(act.map((p) => p.id));
        onDone(out.pickups);
        toast(`${act.length} pickup${act.length === 1 ? "" : "s"} accepted`);
      } else {
        // One file per request: only the requests being marked, each with the file attached to it.
        const each: Record<string, File> = {};
        for (const p of act) {
          const f = files[p.id];
          if (f) each[p.id] = f;
        }
        const out = await supplierApi.collectPickups(act.map((p) => p.id), doMode === "one" ? { mode: "one", file: oneFile! } : { mode: "each", files: each });
        onDone(out.pickups);
        toast(`${act.length} pickup${act.length === 1 ? "" : "s"} marked collected`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not work. Try again.", "red");
    } finally {
      setBusy(false);
    }
  };

  const CARD = "min-w-0 max-h-[240px] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface px-4 py-[14px]";
  return (
    <div ref={ref} className="mb-3 shrink-0 overflow-hidden rounded-[10px] border border-primary bg-surface-2 shadow-[0_12px_28px_-18px_rgba(27,27,57,.45)]">
      <div className="flex flex-wrap items-center gap-5 bg-primary px-[18px] py-3 text-white">
        <div className="whitespace-nowrap text-[13px] font-bold">{title}</div>
        <div className="flex gap-[18px]">
          {[{ v: sos.length, label: sos.length === 1 ? "Sales order" : "Sales orders" }, { v: skus, label: skus === 1 ? "Product" : "Products" }, { v: unitCount, label: "Units" }].map((t) => (
            <div key={t.label} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[20px] font-extrabold leading-none">{t.v}</span>
              <span className="text-[11.5px] text-white/70">{t.label}</span>
            </div>
          ))}
        </div>
        <span className="flex-1" />
        <label className="flex max-w-[340px] cursor-pointer items-center gap-2 text-[12px] leading-[1.4] text-white/90">
          <input type="checkbox" checked={ok} onChange={() => setOk(!ok)} disabled={mode === "none"} className="m-0 h-[15px] w-[15px] shrink-0 accent-white" />
          <span>{confirm}</span>
        </label>
        <button
          type="button"
          onClick={go}
          disabled={!canGo}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-0 px-4 text-[13px] font-bold transition-all duration-[160ms]"
          style={{
            background: canGo ? "#fff" : "rgba(255,255,255,0.25)",
            color: canGo ? (mode === "collect" ? "rgb(var(--hz-synced))" : "rgb(var(--hz-primary))") : "rgba(255,255,255,0.7)",
            cursor: canGo ? "pointer" : "not-allowed",
          }}
        >
          <Check size={14} aria-hidden="true" />
          {busy ? "Saving" : btn}
        </button>
        <button type="button" onClick={onClear} className="shrink-0 border-0 bg-transparent text-[12.5px] font-semibold text-white/75 hover:text-white">Cancel</button>
      </div>
      {skipped > 0 && mode !== "none" && (
        <div className="mx-3 mt-3 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning-text">
          {skipped} of the selected requests {skipped === 1 ? "is" : "are"} not {mode === "collect" ? "accepted" : "waiting for you"} and will be left as {skipped === 1 ? "it is" : "they are"}.
        </div>
      )}
      <div className="grid gap-3 p-3" style={{ gridTemplateColumns: mode === "collect" ? "minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <div className={CARD}>
          <h3 className="m-0 mb-2.5 text-[12px] font-semibold text-ink-muted">Products to prepare</h3>
          {products.map((x, i) => (
            <div key={`${x.code}|${x.spec}`} className="flex justify-between gap-3 py-2" style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{x.desc}</div>
                <div className="mt-0.5 truncate text-[12px] text-ink-muted">{x.code} · {x.spec}</div>
              </div>
              <div className="shrink-0 text-[16px] font-extrabold text-ink">{x.qty} <span className="text-[11px] text-ink-muted">{x.uom}</span></div>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-border pt-2 text-[12.5px] font-bold text-ink">
            <span>Total · {skus} SKU{skus === 1 ? "" : "s"}</span>
            <span>{count(unitCount, "unit")}</span>
          </div>
        </div>
        <div className={CARD}>
          <h3 className="m-0 mb-2.5 text-[12px] font-semibold text-ink-muted">Pickups and sales orders</h3>
          {picked.map((p, i) => {
            const names = customersOf(p);
            const perSo = new Map<string, number>();
            for (const l of p.lines) perSo.set(l.soDocNo, (perSo.get(l.soDocNo) ?? 0) + l.qty);
            return (
              <div key={p.id} className="py-2" style={{ borderTop: i ? "1px solid rgb(var(--hz-border-subtle))" : "0" }}>
                <div className="flex justify-between gap-2.5">
                  <span className="font-docno text-[12px] font-semibold text-primary-ink">{p.requestNo}</span>
                  <span className="whitespace-nowrap text-[12px] font-semibold text-ink">{collectOn(p)}</span>
                </div>
                {p.soDocNos.map((so) => (
                  <div key={so} className="mt-1 flex justify-between gap-2.5 text-[12px] text-ink-secondary">
                    <span className="truncate"><span className="font-docno">{so}</span>{names.get(so) ? ` · ${names.get(so)}` : ""}</span>
                    <span className="whitespace-nowrap">{count(perSo.get(so) ?? 0, "unit")}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {mode === "collect" && (
          <div className={CARD}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-ink-secondary">Delivery Orders (PDF)</span>
              <span className="text-[11.5px] text-ink-muted">{doCount}</span>
            </div>
            <div className="mt-1.5 flex gap-0.5 rounded-md border border-border bg-surface p-0.5">
              {(["one", "each"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setDoMode(m)}
                  className={cn("flex-1 rounded border-0 px-2 py-[5px] text-[11.5px] font-semibold transition-all duration-150", doMode === m ? "bg-primary text-white" : "bg-transparent text-ink-secondary")}>
                  {m === "one" ? "One DO for all" : "One DO per request"}
                </button>
              ))}
            </div>
            {doMode === "one" ? (
              oneFile ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-[7px]">
                  <PdfMark w={24} h={28} fs={8} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-ink">{oneFile.name}</span>
                    <span className="block text-[11px] text-ink-muted">For {toCollect.map((p) => p.requestNo).join(", ")}</span>
                  </span>
                  <button type="button" onClick={() => setOneFile(null)} title="Remove" aria-label="Remove" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-ink-muted hover:bg-border-subtle hover:text-ink">
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <PdfDrop onFile={setOneFile} className="mt-1.5">
                  <Upload size={15} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">Upload one DO (PDF)</span>
                    <span className="block text-[11.5px] text-ink-muted">Attached to all {toCollect.length} pickups</span>
                  </span>
                </PdfDrop>
              )
            ) : (
              toCollect.map((p) => {
                const f = files[p.id];
                return (
                  <div key={p.id} className="mt-1.5 flex items-center gap-2 rounded-lg border bg-surface px-2 py-1.5" style={{ borderColor: f ? "rgb(var(--hz-border))" : "rgba(178,58,58,0.35)" }}>
                    <span className="shrink-0 font-docno text-[11.5px] font-semibold text-primary-ink">{p.requestNo}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: f ? "rgb(var(--hz-ink))" : "rgb(var(--hz-err))" }}>{f ? f.name : "No DO attached"}</span>
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-[3px] text-[11.5px] font-semibold text-primary hover:border-primary">
                      {f ? "Replace" : "Upload"}
                      <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
                        const got = e.target.files?.[0];
                        e.target.value = "";
                        if (!got) return;
                        if (!/\.pdf$/i.test(got.name) && got.type !== "application/pdf") { toast("Choose a PDF file.", "red"); return; }
                        if (got.size > 10 * 1024 * 1024) { toast("The PDF is larger than 10 MB.", "red"); return; }
                        setFiles((cur) => ({ ...cur, [p.id]: got }));
                      }} />
                    </label>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
