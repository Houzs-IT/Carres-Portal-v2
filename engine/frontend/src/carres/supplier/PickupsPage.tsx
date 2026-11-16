// Carres only (not part of Houzs's code): the pickup requests Carres sends a supplier.
//
// Carres collects goods at the supplier's warehouse. A request names the Sales Orders, the items, their unit and
// quantity, and the day Carres expects to arrive. The supplier accepts it, which tells Carres the goods will be
// ready; after the lorry has the goods, Carres marks it Collected.
//
// Drawn with the staff list's own parts (owner, 16 Nov 2026): the header, the figure cards, the status pills,
// Table / Cards, the staff table and the quick view beside the list.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type Column } from "../../components/DataTable";
import { FilterPills } from "../../components/FilterPills";
import { StatCard } from "../../components/StatCard";
import { cn } from "../../lib/utils";
import { supplierApi, type Pickup, type PickupStatus } from "./api";
import { useSupplierSession } from "./SupplierApp";
import {
  Card, CardsGrid, Drawer, Fact, LineList, LoadError, Loading, Missing, PICKUP_STATUS, PageHeader, PickupBadge, ViewToggle,
  count, fmtDay, fmtStamp, useLoad, type ViewMode,
} from "./ui";

type Tab = "todo" | "accepted" | "collected" | "cancelled" | "all";
const TAB_STATUS: Record<Exclude<Tab, "all">, PickupStatus> = { todo: "REQUESTED", accepted: "ACCEPTED", collected: "COLLECTED", cancelled: "CANCELLED" };

const collectOn = (p: Pickup): string => `${fmtDay(p.expectedDate)}${p.expectedTime ? `, ${p.expectedTime}` : ""}`;
const sum = (rows: Pickup[], value: (p: Pickup) => number): string => rows.reduce((a, p) => a + value(p), 0).toLocaleString("en-MY");

const COLUMNS: Column<Pickup>[] = [
  {
    key: "no", label: "Request No", alwaysVisible: true, getValue: (p) => p.requestNo,
    render: (p) => <span className="font-docno text-[12.5px] font-semibold text-primary-ink">{p.requestNo}</span>,
  },
  {
    key: "date", label: "Carres collects on", getValue: (p) => `${p.expectedDate} ${p.expectedTime ?? ""}`.trim(), filterType: "date",
    dateValue: (p) => p.expectedDate, filterLabel: (v) => fmtDay(v) || v, render: collectOn,
  },
  {
    key: "orders", label: "Sales Orders", getValue: (p) => p.soDocNos.join(", "), getFilterValues: (p) => p.soDocNos, disableSort: true,
    render: (p) => (
      <div className="flex min-w-[150px] max-w-[320px] flex-wrap gap-x-2 gap-y-0.5 whitespace-normal font-docno text-[11.5px]">
        {p.soDocNos.slice(0, 4).map((d) => <span key={d}>{d}</span>)}
        {p.soDocNos.length > 4 && <span className="text-ink-muted">+{p.soDocNos.length - 4} more</span>}
      </div>
    ),
  },
  { key: "lines", label: "Lines", align: "right", getValue: (p) => p.lineCount, render: (p) => p.lineCount, total: (rows) => sum(rows, (p) => p.lineCount) },
  { key: "units", label: "Qty", align: "right", getValue: (p) => p.unitCount, render: (p) => p.unitCount, total: (rows) => sum(rows, (p) => p.unitCount) },
  { key: "requested", label: "Requested", getValue: (p) => p.requestedAt, disableFilter: true, render: (p) => <span className="text-ink-secondary">{fmtStamp(p.requestedAt)}</span> },
  { key: "status", label: "Status", getValue: (p) => PICKUP_STATUS[p.status].label, render: (p) => <PickupBadge status={p.status} /> },
];

/** One request as a card, in the staff cards' shape. */
function PickupCard({ p }: { p: Pickup }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-docno text-[12.5px] font-semibold text-ink">{p.requestNo}</span>
        <PickupBadge status={p.status} />
      </div>
      <div className="mt-2 text-[15px] font-semibold text-ink">Carres collects on {collectOn(p)}</div>
      <div className="mt-1 truncate font-docno text-[11.5px] text-ink-muted">{p.soDocNos.join(" · ")}</div>
      <div className="mt-3.5 flex items-end justify-between border-t border-border-subtle pt-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Requested</div>
          <div className="mt-0.5 truncate font-mono text-[12px] font-semibold text-ink-secondary">{fmtStamp(p.requestedAt)}</div>
        </div>
        <span className="font-mono text-[15px] font-bold text-ink">{p.unitCount} <span className="text-[10.5px] font-semibold text-ink-muted">{p.unitCount === 1 ? "UNIT" : "UNITS"}</span></span>
      </div>
    </>
  );
}

function PickupView({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const one = useLoad<Pickup | null>(id ? `pickup:${id}` : "none", () => (id ? supplierApi.pickup(id).then((r) => r.pickup) : Promise.resolve(null)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Pickup | null>(null);
  useEffect(() => { setFresh(null); setError(null); }, [id]);
  const p = fresh ?? one.data;

  const accept = async () => {
    if (!p || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await supplierApi.acceptPickup(p.id);
      setFresh(out.pickup);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be accepted.");
      one.reload();
    } finally {
      setBusy(false);
    }
  };

  const bySo = useMemo(() => {
    const groups = new Map<string, Pickup["lines"]>();
    for (const l of p?.lines ?? []) groups.set(l.soDocNo, [...(groups.get(l.soDocNo) ?? []), l]);
    return [...groups.entries()];
  }, [p]);

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p?.requestNo ?? ""}
      subtitle="Pickup Request"
      headerRight={p && <PickupBadge status={p.status} />}
      footer={p?.status === "REQUESTED" && (
        <>
          <Button icon={<Check size={14} />} onClick={accept} disabled={busy}>{busy ? "Accepting" : "Accept pickup"}</Button>
          <span className="text-[11.5px] text-ink-secondary">Accepting tells Carres the goods will be ready on {fmtDay(p.expectedDate)}.</span>
        </>
      )}
    >
      {one.error && <LoadError message={one.error} onRetry={one.reload} />}
      {!p && !one.error && <div className="text-[12.5px] text-ink-muted">Loading</div>}
      {p && (
        <>
          {error && <div role="alert" className="mb-4 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">{error}</div>}
          {p.status === "CANCELLED" && (
            <div className="mb-4 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">
              Carres cancelled this request{p.cancelReason ? `: ${p.cancelReason}` : "."}
            </div>
          )}
          <div className="text-[19px] font-bold text-ink">Carres collects on {collectOn(p)}</div>
          <div className="mt-1 text-[12.5px] text-ink-secondary">{count(p.soDocNos.length, "sales order")} · {count(p.lineCount, "line")} · {count(p.unitCount, "unit")}</div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-border bg-surface-2 px-4 py-4">
            <Fact label="Requested by Carres">{fmtStamp(p.requestedAt)}</Fact>
            <Fact label="Accepted">{p.acceptedAt ? <>{fmtStamp(p.acceptedAt)}{p.acceptedByName ? ` · ${p.acceptedByName}` : ""}</> : <Missing>Not accepted yet</Missing>}</Fact>
            <Fact label="Collected">{p.collectedAt ? fmtStamp(p.collectedAt) : <Missing>Not collected yet</Missing>}</Fact>
            <Fact label="Note from Carres">{p.note || <Missing>No note</Missing>}</Fact>
          </dl>

          {bySo.map(([docNo, lines]) => (
            <Card
              key={docNo}
              className="mt-5"
              title={`${docNo} · ${count(lines.reduce((a, l) => a + l.qty, 0), "unit")}`}
              aside={<Link to={`/supplier/orders/${encodeURIComponent(docNo)}`} className="text-[11.5px] font-semibold text-primary hover:underline">Open order</Link>}
            >
              <LineList lines={lines.map((l) => ({ key: l.soItemId, itemCode: l.itemCode, description: l.description, spec: l.spec, modelName: l.modelName, uom: l.uom, qty: l.qty }))} />
            </Card>
          ))}
        </>
      )}
    </Drawer>
  );
}

export function PickupsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useSupplierSession();
  const [tab, setTab] = useState<Tab>("todo");
  const [mode, setMode] = useState<ViewMode>("table");
  const list = useLoad("pickups", () => supplierApi.pickups().then((r) => r.rows));
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const shown = tab === "all" ? rows : rows.filter((p) => p.status === TAB_STATUS[tab]);
  const n = (s: PickupStatus) => rows.filter((p) => p.status === s).length;
  /** The next day Carres comes: the earliest request still open (waiting, or accepted). */
  const next = useMemo(
    () => rows.filter((p) => p.status === "REQUESTED" || p.status === "ACCEPTED").sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).at(0) ?? null,
    [rows],
  );

  const unknown = !list.data;
  const failed = unknown && !!list.error;
  const waiting = n("REQUESTED");
  const open = (p: Pickup) => navigate(`/supplier/pickups/${p.id}`);
  const empty = tab === "todo" ? "Nothing to accept. New requests from Carres appear here." : "No pickup requests here.";

  return (
    <div className={cn("transition-[padding] duration-200", id && "md:pr-[540px]")}>
      <PageHeader
        eyebrow="Warehouse and Operation"
        title="Pickup Requests"
        description="Carres collects goods at your warehouse. Accept a request to tell Carres the goods will be ready on the day; Carres marks it Collected after the lorry has them."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="To Accept" value={waiting.toLocaleString("en-MY")} subtitle={waiting ? "Waiting for you" : "Nothing waiting"}
          tone={waiting ? "warning" : "default"} rail={waiting ? "bg-err" : "bg-primary"} active={tab === "todo"} onClick={() => setTab("todo")}
          pending={unknown && !failed} failed={failed} onRetry={list.reload}
        />
        <StatCard
          label="Accepted" value={n("ACCEPTED").toLocaleString("en-MY")} subtitle="Ready on the day" rail="bg-accent"
          active={tab === "accepted"} onClick={() => setTab("accepted")} pending={unknown && !failed} failed={failed} onRetry={list.reload}
        />
        <StatCard
          label="Next Pickup" value={next ? fmtDay(next.expectedDate) : "None"} subtitle={next ? next.requestNo : "No pickup coming"} rail="bg-warning-text"
          onClick={next ? () => open(next) : undefined} pending={unknown && !failed} failed={failed} onRetry={list.reload}
        />
        <StatCard
          label="Collected" value={n("COLLECTED").toLocaleString("en-MY")} subtitle="By Carres" rail="bg-synced" tone="success"
          active={tab === "collected"} onClick={() => setTab("collected")} pending={unknown && !failed} failed={failed} onRetry={list.reload}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterPills
          value={tab}
          onChange={setTab}
          options={[
            { value: "todo", label: "To accept", count: list.data ? waiting : undefined },
            { value: "accepted", label: "Accepted", count: list.data ? n("ACCEPTED") : undefined },
            { value: "collected", label: "Collected", count: list.data ? n("COLLECTED") : undefined },
            { value: "cancelled", label: "Cancelled", count: list.data ? n("CANCELLED") : undefined },
            { value: "all", label: "All", count: list.data ? rows.length : undefined },
          ]}
        />
        <div className="flex-1" />
        <div className="hidden md:block"><ViewToggle value={mode} onChange={setMode} /></div>
      </div>
      {failed && <div className="mb-3"><LoadError message={list.error!} onRetry={list.reload} /></div>}
      {/* A phone always has the cards; on a computer Table / Cards decides (as the staff list). */}
      <div className="md:hidden">
        {list.data ? (
          <CardsGrid rows={shown} rowKey={(p) => p.id} onOpen={open} empty={empty} render={(p) => <PickupCard p={p} />} />
        ) : !failed && <Loading />}
      </div>
      <div className="hidden md:block">
      {mode === "table" ? (
        <DataTable<Pickup>
          tableId="carres-supplier-pickups"
          documentLabel="Pickup Requests"
          exportName="pickup-requests"
          columns={COLUMNS}
          rows={list.data ? shown : null}
          loading={unknown && !failed}
          getRowKey={(p) => p.id}
          getRowClassName={(p) => (p.id === id ? "bg-primary-soft/40" : undefined)}
          onRowClick={open}
          emptyLabel={empty}
          clientSearch={{ placeholder: "Search request no or SO no" }}
        />
      ) : list.data ? (
        <CardsGrid rows={shown} rowKey={(p) => p.id} onOpen={open} empty={empty} render={(p) => <PickupCard p={p} />} />
      ) : !failed && <Loading />}
      </div>
      <PickupView
        id={id ?? null}
        onClose={() => navigate("/supplier/pickups")}
        onChanged={() => { list.reload(); refresh(); }}
      />
    </div>
  );
}
