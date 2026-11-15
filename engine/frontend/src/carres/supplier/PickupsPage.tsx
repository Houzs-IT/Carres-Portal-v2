// Carres only (not part of Houzs's code): the pickup requests Carres sends a supplier.
//
// Carres collects goods at the supplier's warehouse. A request names the Sales Orders, the items, their unit and
// quantity, and the day Carres expects to arrive. The supplier accepts it, which tells Carres the goods will be
// ready; after the lorry has the goods, Carres marks it Collected.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "../../components/Button";
import { TabStrip } from "../../components/TabStrip";
import { supplierApi, type Pickup, type PickupStatus } from "./api";
import { useSupplierSession } from "./SupplierApp";
import { Card, Drawer, Fact, LineList, LoadError, Loading, Missing, PageTitle, PickupBadge, Table, count, fmtDay, fmtStamp, useLoad, type Column } from "./ui";

type Tab = "todo" | "accepted" | "collected" | "cancelled" | "all";
const TAB_STATUS: Record<Exclude<Tab, "all">, PickupStatus> = { todo: "REQUESTED", accepted: "ACCEPTED", collected: "COLLECTED", cancelled: "CANCELLED" };

const collectOn = (p: Pickup): string => `${fmtDay(p.expectedDate)}${p.expectedTime ? `, ${p.expectedTime}` : ""}`;

const COLUMNS: Column<Pickup>[] = [
  { key: "no", header: "Request No", sortValue: (p) => p.requestNo, cell: (p) => <span className="font-mono text-[12.5px] font-bold text-primary-ink">{p.requestNo}</span> },
  { key: "date", header: "Carres collects on", sortValue: (p) => `${p.expectedDate} ${p.expectedTime ?? ""}`, cell: collectOn, className: "whitespace-nowrap" },
  {
    key: "orders", header: "Sales Orders", wrap: true,
    cell: (p) => (
      <div className="flex min-w-[150px] max-w-[320px] flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11.5px]">
        {p.soDocNos.slice(0, 4).map((d) => <span key={d}>{d}</span>)}
        {p.soDocNos.length > 4 && <span className="text-ink-muted">+{p.soDocNos.length - 4} more</span>}
      </div>
    ),
  },
  { key: "lines", header: "Lines", align: "right", sortValue: (p) => p.lineCount, cell: (p) => p.lineCount },
  { key: "units", header: "Qty", align: "right", sortValue: (p) => p.unitCount, cell: (p) => p.unitCount },
  { key: "requested", header: "Requested", sortValue: (p) => p.requestedAt, cell: (p) => fmtStamp(p.requestedAt), className: "text-ink-secondary" },
  { key: "status", header: "Status", sortValue: (p) => p.status, cell: (p) => <PickupBadge status={p.status} /> },
];

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
  const list = useLoad("pickups", () => supplierApi.pickups().then((r) => r.rows));
  const rows = list.data ?? [];
  const shown = tab === "all" ? rows : rows.filter((p) => p.status === TAB_STATUS[tab]);
  const n = (s: PickupStatus) => rows.filter((p) => p.status === s).length;

  return (
    <>
      <PageTitle
        title="Pickup Requests"
        description="Carres collects goods at your warehouse. Accept a request to tell Carres the goods will be ready on the day; Carres marks it Collected after the lorry has them."
      />
      <TabStrip
        value={tab}
        onChange={setTab}
        options={[
          { value: "todo", label: "To accept", count: n("REQUESTED") },
          { value: "accepted", label: "Accepted", count: n("ACCEPTED") },
          { value: "collected", label: "Collected" },
          { value: "cancelled", label: "Cancelled" },
          { value: "all", label: "All" },
        ]}
      />
      {list.error && <div className="mb-3"><LoadError message={list.error} onRetry={list.reload} /></div>}
      {!list.data && !list.error ? <Loading /> : (
        <Table
          columns={COLUMNS}
          rows={shown}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/supplier/pickups/${p.id}`)}
          selectedKey={id ?? null}
          empty={tab === "todo" ? "Nothing to accept. New requests from Carres appear here." : "No pickup requests here."}
        />
      )}
      <PickupView
        id={id ?? null}
        onClose={() => navigate("/supplier/pickups")}
        onChanged={() => { list.reload(); refresh(); }}
      />
    </>
  );
}
