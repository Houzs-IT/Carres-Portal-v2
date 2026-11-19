// Carres only (not part of Houzs's code): a 3PL company's own deliveries (owner, 19 Nov 2026).
//
// The jobs Carres gave the 3PL's own lorries, drivers and helpers: the customer, the address and phone, the goods,
// the customer's date and the planned date, and how Last Mile stands (left, arrived, delivered, proof). Never a
// price. A person who holds "Set delivery date" plans the day of an open job; the customer's own date never changes.
// The driver records Last Mile on the driver's phone page as before; this page shows what was recorded.
import { useMemo, useState, type ReactNode } from "react";
import { supplierApi, type DeliveryJob, type DeliveryView } from "./api";
import { useShared } from "./data";
import { Calendar } from "./Calendar";
import { ListCount, ListTable, Toolbar, exportList, useListPrefs, type Column } from "./ListTable";
import { PageBar, PageBody, useSupplierSession } from "./Shell";
import { Badge, Facts, LoadError, Loading, Pills, count, fmtDay, todayMyt, useToast, type BadgeSpec } from "./ui";

const STATUS: Record<string, BadgeSpec> = {
  DRAFT: { label: "Planned", tone: "neutral" },
  CONFIRMED: { label: "Planned", tone: "neutral" },
  LOADED: { label: "Loaded", tone: "accent" },
  DISPATCHED: { label: "On the way", tone: "warning" },
  IN_TRANSIT: { label: "On the way", tone: "warning" },
  SIGNED: { label: "Delivered", tone: "success" },
  DELIVERED: { label: "Delivered", tone: "success" },
  INVOICED: { label: "Delivered", tone: "success" },
};

/** Where the job stands in Last Mile, in the driver's own steps. */
export function deliveryBadge(j: DeliveryJob): BadgeSpec {
  if (j.done) return { label: "Delivered", tone: "success" };
  if (j.kind === "so") return { label: "Waiting for Delivery Order", tone: "neutral" };
  if (j.arrivedAt) return { label: "Arrived", tone: "warning" };
  if (j.departedAt) return { label: "On the way", tone: "warning" };
  return STATUS[j.status] ?? { label: "Planned", tone: "neutral" };
}

const dayOf = (j: DeliveryJob) => j.plannedDate ?? j.customerDate;
const units = (j: DeliveryJob) => j.items.reduce((a, i) => a + i.qty, 0);

/** The goods in one line: "1 × CARRES HUSHY.S MATTRESS (3FT), 2 × PILLOW". */
const goodsOf = (j: DeliveryJob) => j.items.map((i) => `${i.qty} × ${i.description || i.code}`).join(", ");

/** The planned date, set right in its cell as on Delivery Planning (owner, 20 Nov 2026), for someone who may. */
function DateCell({ job, canSet, onSaved }: { job: DeliveryJob; canSet: boolean; onSaved: (date: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const day = dayOf(job);
  if (!canSet || job.done) return <span className="font-semibold">{fmtDay(day) || "Not set"}</span>;
  const save = async (date: string) => {
    if (!date || date === day) return;
    setBusy(true);
    try {
      await supplierApi.setDeliveryDate(job, date);
      onSaved(date);
      toast(`Delivery date set to ${fmtDay(date)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not work. Try again.", "red");
    } finally {
      setBusy(false);
    }
  };
  return (
    <input type="date" value={day ?? ""} min={todayMyt()} disabled={busy} aria-label="Delivery date"
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => void save(e.target.value)}
      className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-semibold text-ink outline-none focus:border-primary disabled:opacity-60" />
  );
}

const columnsFor = (dateCell: (j: DeliveryJob) => ReactNode): Column<DeliveryJob>[] => [
  { key: "date", label: "Delivery date", width: 150, render: (j) => ({ kind: "text", v: dateCell(j) }), exportValue: (j) => dayOf(j) ?? "" },
  { key: "doc", label: "Document", width: 150, render: (j) => ({ kind: "doc", v: j.doNo ?? j.soDocNo ?? "" }), exportValue: (j) => j.doNo ?? j.soDocNo ?? "" },
  { key: "customer", label: "Customer", width: 180, render: (j) => ({ kind: "text", v: j.customer }), exportValue: (j) => j.customer },
  { key: "goods", label: "Goods", width: 300, shrink: true, render: (j) => ({ kind: "text", v: goodsOf(j), title: goodsOf(j) }), exportValue: (j) => goodsOf(j) },
  { key: "qty", label: "Qty", width: 64, align: "right", render: (j) => ({ kind: "text", v: units(j) }), exportValue: (j) => units(j) },
  { key: "address", label: "Address", width: 280, shrink: true, render: (j) => ({ kind: "text", v: j.address, fg: "rgb(var(--hz-ink-secondary))" }), exportValue: (j) => j.address },
  { key: "phone", label: "Phone", width: 130, render: (j) => ({ kind: "text", v: j.phone ?? "" }), exportValue: (j) => j.phone ?? "" },
  { key: "exemption", label: "Sales Exemption Expiry", width: 170, render: (j) => ({ kind: "text", v: fmtDay(j.exemptionDate) }), exportValue: (j) => j.exemptionDate ?? "" },
  { key: "lorry", label: "Lorry", width: 100, render: (j) => ({ kind: "text", v: j.lorry ?? "" }), exportValue: (j) => j.lorry ?? "" },
  { key: "driver", label: "Driver", width: 140, render: (j) => ({ kind: "text", v: j.driver ?? "" }), exportValue: (j) => j.driver ?? "" },
  { key: "status", label: "Last Mile", width: 190, render: (j) => ({ kind: "badge", b: deliveryBadge(j) }), exportValue: (j) => deliveryBadge(j).label },
];

const matches = (j: DeliveryJob, q: string) =>
  !q || `${j.doNo ?? ""} ${j.soDocNo ?? ""} ${j.customer} ${j.address} ${j.lorry ?? ""} ${j.driver ?? ""}`.toLowerCase().includes(q.toLowerCase());

export function DeliveriesPage() {
  const toast = useToast();
  const { can } = useSupplierSession();
  const [view, setView] = useState<DeliveryView>("open");
  // Every job is read once; the pills only filter it, so each pill can show its count.
  const jobs = useShared<DeliveryJob[]>("deliveries", async () => (await supplierApi.deliveries("all")).rows);
  const api = useListPrefs("deliveries");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const all = jobs.data ?? [];
  const inView = (j: DeliveryJob) => (view === "all" ? true : view === "done" ? j.done : !j.done);
  const shown = useMemo(() => all.filter((j) => inView(j) && matches(j, q.trim())), [all, q, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = all.filter((j) => !j.done).length;
  const canSetDate = can("operation", "a_deldate");
  const savedDate = (j: DeliveryJob, date: string) => jobs.put(all.map((x) => (x.kind === j.kind && x.key === j.key ? { ...x, plannedDate: date } : x)));
  const COLUMNS = columnsFor((j) => <DateCell job={j} canSet={canSetDate} onSaved={(d) => savedDate(j, d)} />);

  const doExport = async () => {
    try { await exportList("deliveries", COLUMNS, api.prefs, shown); }
    catch (e) { toast(`The file was not made. ${e instanceof Error ? e.message : ""}`.trim(), "red"); }
  };

  const empty = q.trim() ? `No delivery matches "${q.trim()}".` : view === "done" ? "No delivered jobs yet." : "No deliveries on your lorries right now.";

  return (
    <>
      <PageBar eyebrow="Logistics" title="Deliveries" />
      <PageBody scroll={false} riseKey="deliveries">
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
          <Pills<DeliveryView>
            value={view}
            onChange={(v) => { setView(v); setOpenKey(null); }}
            options={[
              { key: "open", label: "To deliver", count: open },
              { key: "done", label: "Delivered", count: all.length - open },
              { key: "all", label: "All", count: all.length },
            ]}
          />
        </div>
        <Toolbar search={q} onSearch={setQ} placeholder="Search document, customer, address, lorry or driver" rowCount={shown.length}
          columns={COLUMNS} api={api} onExport={doExport} exportCount={0} canExport={can("operation", "a_export")} />
        {jobs.error && !jobs.data ? (
          <LoadError message={jobs.error} onRetry={jobs.reload} />
        ) : !jobs.data ? (
          <Loading />
        ) : (
          <ListTable<DeliveryJob>
            columns={COLUMNS} rows={shown} rowKey={(j) => `${j.kind}:${j.key}`} api={api}
            openKey={openKey} onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
            expanded={(j) => (
              <DeliveryExpansion job={j} canSetDate={canSetDate} onSaved={(date) => savedDate(j, date)} />
            )}
            empty={empty}
            footer={<ListCount>{count(shown.length, "delivery", "deliveries")}</ListCount>}
          />
        )}
      </PageBody>
    </>
  );
}

const BTN = "inline-flex h-[38px] items-center justify-center rounded-lg px-4 text-[13px] font-semibold transition-all duration-[160ms]";

function DeliveryExpansion({ job, canSetDate, onSaved }: { job: DeliveryJob; canSetDate: boolean; onSaved: (date: string) => void }) {
  const toast = useToast();
  const today = todayMyt();
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(() => (dayOf(job) && dayOf(job)! >= today ? dayOf(job)! : today));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await supplierApi.setDeliveryDate(job, day);
      onSaved(day);
      setPicking(false);
      toast(`Delivery date set to ${fmtDay(day)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not work. Try again.", "red");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Delivery</div>
        <Facts facts={[
          { label: "Customer", value: job.customer },
          { label: "Address", value: job.address || "Not given", muted: !job.address },
          { label: "Phone", value: job.phone ?? "Not given", muted: !job.phone },
          { label: "Customer's date", value: fmtDay(job.customerDate) || "Not given", muted: !job.customerDate },
          { label: "Planned date", value: fmtDay(job.plannedDate) || "Not set", muted: !job.plannedDate },
          { label: "Sales Exemption Expiry", value: fmtDay(job.exemptionDate) || "Not given", muted: !job.exemptionDate },
          { label: "Sales Order", value: job.soDocNo ?? "" },
          { label: "Delivery Order", value: job.doNo ?? "Not made yet", muted: !job.doNo },
          { label: "Lorry", value: job.lorry ?? "Not given", muted: !job.lorry },
          { label: "Driver", value: job.driver ?? "Not given", muted: !job.driver },
          { label: "Helpers", value: job.helpers.join(", ") || "None", muted: !job.helpers.length },
        ]} />
        {canSetDate && !job.done && (
          picking ? (
            <div className="mt-4 max-w-[340px]">
              <Calendar today={today} current={dayOf(job) ?? today} value={day} onChange={setDay} />
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void save()} className={`${BTN} bg-primary text-white disabled:opacity-60`}>
                  {busy ? "Saving" : `Set ${fmtDay(day)}`}
                </button>
                <button type="button" disabled={busy} onClick={() => setPicking(false)} className={`${BTN} border border-border bg-surface text-ink-secondary`}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setPicking(true)} className={`${BTN} mt-4 bg-primary text-white`}>Set delivery date</button>
          )
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Last Mile</div>
        <div className="mb-3"><Badge b={deliveryBadge(job)} size="md" /></div>
        <Facts facts={[
          { label: "Left", value: job.departedAt ?? "Not yet", muted: !job.departedAt },
          { label: "Arrived", value: job.arrivedAt ?? "Not yet", muted: !job.arrivedAt },
          { label: "Delivered", value: job.deliveredAt ?? "Not yet", muted: !job.deliveredAt },
          { label: "Proof of delivery", value: job.proof ? "Received" : "Not yet", muted: !job.proof },
        ]} />
        <div className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Goods</div>
        {job.items.length ? (
          <table className="w-full text-[13px]">
            <tbody>
              {job.items.map((i, n) => (
                <tr key={`${i.code}-${n}`} className="border-b border-border-subtle last:border-0">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="font-semibold text-ink">{i.description || i.code}</div>
                    {i.description2 && <div className="text-[12px] text-ink-secondary">{i.description2}</div>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right align-top">{i.qty} {i.uom ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-[13px] text-ink-muted">No goods listed.</div>
        )}
      </div>
    </div>
  );
}
