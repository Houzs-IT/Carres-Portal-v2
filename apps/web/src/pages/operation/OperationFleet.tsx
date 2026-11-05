import { useMemo, useState } from "react";
import type { OrderActionTone } from "@carres/shared";
import {
  isOnLeave, lorryCapacity, lorryCards, proposeCrew, stopMatches,
  type FleetCrew, type FleetStop, type FleetStopStatus, type LorryCapacityRow, type LorryRunStatus,
} from "@carres/shared/fleet";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import ScheduleCard from "@/components/kit/ScheduleCard";
import SearchInput from "@/components/kit/SearchInput";
import Select from "@/components/kit/Select";
import StatusPill from "@/components/kit/StatusPill";
import Tabs from "@/components/kit/Tabs";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";
import ModuleHeader from "./components/ModuleHeader";
import OperationKpiTile from "./components/OperationKpiTile";
import { FL, mapHref, monthRange, refusalOf, useFleet, useFleetWrite, type FleetPayload } from "./fleet";

/**
 * Carres' own lorries (migration 0724). Weisiang's decision (Mr Lim, WhatsApp
 * 2026-10-22): build Houzs Last Mile crew proposals + run sheet, Lorry Live
 * Map, Lorry Capacity and Driver Leave. Jess was not part of this decision;
 * her Delivery MASTER rejections (§11, §14, §15) are marked overturned.
 *
 * Lorries and crew are Settings → Logistics → Carres Lorries → Vehicles and
 * Drivers; a lorry run is one lorry on one day, read from the Monitor's
 * delivery dates whose vehicle is that lorry's plate.
 */

const dateInput = "h-8 rounded-md border border-border bg-background px-2 text-body";

function Page({ word, testId, payload, error, children }: {
  word: string; testId: string; payload: FleetPayload | undefined; error: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <ModuleHeader destinationHeader testId={`${testId}-destination-header`} word={word} docTitle={`${word} · Carres`} />
      {error ? (
        <p role="alert" className="p-4 text-body">{FL.failed}</p>
      ) : payload && !payload.company ? (
        <p className="p-4 text-body" data-testid={`${testId}-not-set-up`}>{FL.noOwnFleet}</p>
      ) : (
        <ListPageShell register>{children}</ListPageShell>
      )}
    </div>
  );
}

/* ── Last Mile Delivery: one card per lorry (Houzs FleetDay lorry cards, #5094 → #5107) ── */

type StopFilter = "all" | FleetStopStatus;
const STOP_WORD: Record<FleetStopStatus, string> = {
  scheduled: FL.scheduled, delivered: FL.delivered, partial: FL.partiallyDelivered, failed: FL.failedDelivery,
};
const STOP_TONE: Record<FleetStopStatus, OrderActionTone> = { scheduled: "neutral", delivered: "success", partial: "warning", failed: "danger" };
const RUN_WORD: Record<LorryRunStatus, string> = { scheduled: FL.scheduled, on_the_way: FL.outForDelivery, completed: FL.completed };
const RUN_TONE: Record<LorryRunStatus, OrderActionTone> = { scheduled: "neutral", on_the_way: "info", completed: "success" };

export function FleetDayPage() {
  const [day, setDay] = useState(appTodayIso);
  const q = useFleet(day);
  const write = useFleetWrite();
  const [edits, setEdits] = useState<Record<string, { driverId: string | null; helperId: string | null }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StopFilter>("all");
  const data = q.data;

  const lorries = useMemo(() => (data?.lorries ?? []).filter((l) => l.active), [data]);
  const cards = useMemo(() => lorryCards(day, data?.lorries ?? [], data?.stops ?? []), [data, day]);
  const picks = useMemo(
    () => proposeCrew({
      day, lorries, crew: data?.crew ?? [], leave: data?.leave ?? [],
      confirmed: data?.crewDays ?? [], history: data?.crewDays ?? [],
      templateDriverName: new Map(lorries.map((l) => [l.id, l.templateDriverName])),
    }),
    [data, day, lorries],
  );

  const crewFor = (role: "driver" | "helper") =>
    (data?.crew ?? []).filter((c) => c.active && c.role === role && !isOnLeave(c.id, day, data?.leave ?? []));
  const options = (people: FleetCrew[], none: string) => [{ value: "none", label: none }, ...people.map((c) => ({ value: c.id, label: c.name }))];
  const chosen = (vehicleId: string) => edits[vehicleId] ?? picks.get(vehicleId) ?? { driverId: null, helperId: null };
  const setPick = (vehicleId: string, key: "driverId" | "helperId", value: string) =>
    setEdits((e) => ({ ...e, [vehicleId]: { ...chosen(vehicleId), [key]: value === "none" ? null : value } }));

  const confirm = (vehicleId: string) => {
    const c = chosen(vehicleId);
    setMessage(null);
    write.mutate(
      { path: "/crew", body: { day, vehicleId, driverId: c.driverId, helperId: c.helperId } },
      {
        onSuccess: () => setEdits(({ [vehicleId]: _done, ...rest }) => rest),
        onError: (e) => setMessage(refusalOf(e)),
      },
    );
  };

  const allStops = cards.flatMap((c) => c.stops);
  const shown = (stops: readonly FleetStop[]) =>
    stops.filter((s) => (filter === "all" || (s.status ?? "scheduled") === filter) && stopMatches(s, query));

  return (
    <Page word={FL.fleetDay} testId="fleet-day" payload={data} error={q.isError}>
      <div className="grid grid-cols-2 gap-2 px-4 pb-2 lg:grid-cols-4" data-testid="fleet-day-tiles">
        <OperationKpiTile label={FL.lorriesOut} value={cards.filter((c) => c.vehicleId && c.stops.length > 0).length} hint="" accent="primary" />
        <OperationKpiTile label={FL.stops} value={allStops.length} hint="" accent="primary" />
        <OperationKpiTile label={FL.delivered} value={allStops.filter((s) => s.status === "delivered").length} hint="" accent="success" />
        <OperationKpiTile label={FL.revenue} value={rm(cards.reduce((n, c) => n + c.revenue, 0))} hint="" accent="muted" />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <input type="date" aria-label={FL.day} className={dateInput} value={day} data-testid="fleet-day-date"
          onChange={(e) => { if (e.target.value) { setDay(e.target.value); setEdits({}); } }} />
        <div className="w-72 max-md:w-full">
          <SearchInput id="fleet-day-search" toolbar placeholder={FL.searchStops} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Tabs variant="segmented" label={FL.status} value={filter} onValueChange={(v) => setFilter(v as StopFilter)} tabs={[
          { value: "all", label: FL.all }, { value: "scheduled", label: FL.scheduled }, { value: "delivered", label: FL.delivered },
          { value: "partial", label: FL.partiallyDelivered }, { value: "failed", label: FL.failedDelivery },
        ]} />
        <span className="flex-1" />
        {allStops.length > 0 ? (
          <a className="text-c-link underline" target="_blank" rel="noreferrer" href={`/print/run-sheet?day=${day}`}>{FL.printRunSheets}</a>
        ) : null}
      </div>
      {message ? <p role="alert" className="px-4 pb-2 text-body" data-testid="fleet-day-refusal">{message}</p> : null}
      {!q.isSuccess ? null : cards.length === 0 ? (
        <p className="px-4 text-body" data-testid="fleet-day-empty">{FL.noLorries}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3" data-testid="fleet-day-cards">
          {cards.map((card) => {
            const id = card.vehicleId;
            const stops = shown(card.stops);
            const busy = write.isPending && (write.variables?.body as { vehicleId?: string } | undefined)?.vehicleId === id;
            return (
              <ScheduleCard key={id ?? "none"} label={card.plate ?? FL.noLorryMatched} testId={`fleet-card-${id ?? "none"}`}
                header={<>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">{card.plate ?? FL.noLorryMatched}</span>
                    {card.capacity ? <span className="text-meta text-c-secondary">{card.capacity}</span> : null}
                  </span>
                  {card.stops.length > 0 ? <StatusPill tone={RUN_TONE[card.status]}>{RUN_WORD[card.status]}</StatusPill> : null}
                </>}
                footer={<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
                  <span data-testid={`fleet-card-${id ?? "none"}-progress`}>{card.delivered} of {card.stops.length} {FL.delivered.toLowerCase()}</span>
                  {card.failed > 0 ? <span>{card.failed} {FL.failedDelivery}</span> : null}
                  <span className="flex-1" />
                  <span className="tabular-nums">{rm(card.revenue)}</span>
                  {card.stops.length > 0 ? (
                    <a className="text-c-link underline" target="_blank" rel="noreferrer"
                      href={`/print/run-sheet?day=${day}&lorry=${id ?? "none"}`}>{FL.runSheet}</a>
                  ) : null}
                </div>}>
                {id ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 pb-1">
                    <Select id={`fleet-driver-${id}`} label={FL.driver} value={chosen(id).driverId ?? "none"} onValueChange={(v) => setPick(id, "driverId", v)}
                      options={options(crewFor("driver"), FL.noDriver)} />
                    <Select id={`fleet-helper-${id}`} label={FL.helper} value={chosen(id).helperId ?? "none"} onValueChange={(v) => setPick(id, "helperId", v)}
                      options={options(crewFor("helper"), FL.noHelper)} />
                    {picks.get(id)?.confirmed && !edits[id] ? (
                      <span className="pb-2 text-meta text-c-secondary">{FL.confirmed}</span>
                    ) : (
                      <Button size="sm" variant="primary" loading={busy} onClick={() => confirm(id)} data-testid={`fleet-confirm-${id}`}>{FL.confirmCrew}</Button>
                    )}
                  </div>
                ) : (
                  <p className="text-meta text-c-secondary">{FL.noLorryMatchedNote}</p>
                )}
                {stops.length === 0 ? (
                  <p className="py-1 text-meta text-c-secondary">{card.stops.length > 0 ? FL.noStopMatches : FL.noStops}</p>
                ) : (
                  <ol className="flex flex-col">
                    {stops.map((s) => {
                      const status = s.status ?? "scheduled";
                      return (
                        <li key={`${s.orderId}|${s.leg}`} data-testid={`fleet-stop-${s.orderId}-${s.leg}`}
                          className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2 border-t border-kit-slate-4 py-1.5">
                          <span className="text-meta tabular-nums text-c-secondary">{card.stops.indexOf(s) + 1}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{s.customerName}</span>
                            <span className="block truncate text-meta text-c-secondary">
                              {[s.so == null ? null : `SO-${s.so}`, s.doNumber, s.expectedArrival ?? s.confirmedTime].filter(Boolean).join(" · ")}
                            </span>
                            {s.customerAddress ? <span className="block truncate text-meta text-c-secondary">{s.customerAddress}</span> : null}
                          </span>
                          <StatusPill tone={STOP_TONE[status]}>{STOP_WORD[status]}</StatusPill>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </ScheduleCard>
            );
          })}
        </div>
      )}
    </Page>
  );
}

const nameOf = (data: FleetPayload | undefined, id: string | null) => data?.crew.find((c) => c.id === id)?.name ?? "";

/* ── Live Map (Houzs LorryLiveMap; no map library yet: a list with map links) ── */

interface MapRow { vehicleId: string; plate: string; lat: number | null; lng: number | null; recordedAt: string | null }

export function FleetLiveMapPage() {
  const today = appTodayIso();
  const q = useFleet(today);
  const rows = useMemo<MapRow[]>(() => (q.data?.lorries ?? []).filter((l) => l.active).map((l) => {
    const p = q.data?.positions.find((x) => x.vehicleId === l.id);
    return { vehicleId: l.id, plate: l.plate, lat: p?.lat ?? null, lng: p?.lng ?? null, recordedAt: p?.recordedAt ?? null };
  }), [q.data]);
  /* Houzs LorryLiveMap: last seen as an age, stale after 15 minutes. */
  const minutesAgo = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const ago = (m: number) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);
  const old = (iso: string) => minutesAgo(iso) > 15;
  const columns: DataGridColumn<MapRow>[] = [
    { key: "lorry", label: FL.lorry, width: 160, accessor: (r) => r.plate },
    { key: "seen", label: FL.lastSeen, width: 220, accessor: (r) => r.recordedAt
      ? `${ago(minutesAgo(r.recordedAt))} · ${fmtDate(r.recordedAt, { time: true })}${old(r.recordedAt) ? ` · ${FL.oldPosition}` : ""}` : FL.noPosition,
      dateValue: (r) => r.recordedAt ?? "" },
    { key: "position", label: FL.position, width: 200, accessor: (r) => (r.lat == null ? "" : `${r.lat}, ${r.lng}`) },
    { key: "map", label: "", exportLabel: FL.openMap, width: 120, sortable: false, filterable: false, accessor: (r) => r.lat == null ? "" : (
      <a className="text-c-link underline" target="_blank" rel="noreferrer" href={mapHref(r.lat, r.lng!)}>{FL.openMap}</a>
    ) },
  ];
  return (
    <Page word={FL.liveMap} testId="fleet-map" payload={q.data} error={q.isError}>
      <DataGrid rows={rows} columns={columns} rowKey={(r) => r.vehicleId} storageKey="carres.operation.fleet-map.v1"
        appearance="reference" exportName={FL.liveMap} groupBanner={false} isLoading={!q.isSuccess && !q.isError}
        emptyMessage={FL.noLorries} statusSummary={(v) => `${v.filter((r) => r.recordedAt).length} of ${v.length}`} />
    </Page>
  );
}

/* ── Lorry Capacity (Houzs LorryCapacity: utilisation + revenue per trip) ── */

const ALL_LORRIES = "all";

/** The page's tiles over the rows shown. */
export function capacityTotals(rows: readonly LorryCapacityRow[]) {
  const trips = rows.reduce((n, r) => n + r.trips, 0);
  const days = rows.reduce((n, r) => n + r.workingDays, 0);
  const stops = rows.reduce((n, r) => n + r.stops, 0);
  const revenue = rows.reduce((n, r) => n + r.revenue, 0);
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return { trips, days, revenue, utilisation: div(trips, days), ordersPerTrip: div(stops, trips), revenuePerOrder: div(revenue, stops), revenuePerTrip: div(revenue, trips) };
}

export function LorryCapacityPage() {
  const [range, setRange] = useState(() => monthRange(appTodayIso().slice(0, 7)));
  const { from, to } = range;
  const [lorry, setLorry] = useState(ALL_LORRIES);
  const q = useFleet(from, to);
  const rows = useMemo(
    () => lorryCapacity(from, to, q.data?.lorries ?? [], q.data?.stops ?? []).filter((r) => lorry === ALL_LORRIES || r.vehicleId === lorry),
    [q.data, from, to, lorry],
  );
  const t = capacityTotals(rows);
  const num = (n: number | null, f: (x: number) => string) => (n == null ? "" : f(n));
  const columns: DataGridColumn<LorryCapacityRow>[] = [
    { key: "lorry", label: FL.lorry, width: 150, accessor: (r) => r.plate },
    { key: "capacity", label: FL.lorryCapacity, width: 110, accessor: (r) => r.capacity ?? "" },
    { key: "days", label: FL.workingDays, width: 120, align: "right", accessor: (r) => String(r.workingDays), numberValue: (r) => r.workingDays },
    { key: "trips", label: FL.trips, width: 80, align: "right", accessor: (r) => String(r.trips), numberValue: (r) => r.trips },
    { key: "util", label: FL.utilisation, width: 110, align: "right", accessor: (r) => num(r.utilisation, (x) => `${Math.round(x * 100)}%`), numberValue: (r) => r.utilisation ?? 0 },
    { key: "stops", label: FL.stops, width: 80, align: "right", accessor: (r) => String(r.stops), numberValue: (r) => r.stops },
    { key: "spt", label: FL.stopsPerTrip, width: 120, align: "right", accessor: (r) => num(r.stopsPerTrip, (x) => x.toFixed(1)), numberValue: (r) => r.stopsPerTrip ?? 0 },
    { key: "revenue", label: FL.revenue, width: 130, align: "right", accessor: (r) => rm(r.revenue), numberValue: (r) => r.revenue, exportValue: (r) => r.revenue },
    { key: "rpt", label: FL.revenuePerTrip, width: 140, align: "right", accessor: (r) => num(r.revenuePerTrip, rm), numberValue: (r) => r.revenuePerTrip ?? 0, exportValue: (r) => r.revenuePerTrip ?? "" },
  ];
  return (
    <Page word={FL.capacity} testId="fleet-capacity" payload={q.data} error={q.isError}>
      {/* Houzs LorryCapacity.tsx:276-321. */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-2 lg:grid-cols-4 xl:grid-cols-8" data-testid="fleet-capacity-tiles">
        <OperationKpiTile label={FL.lorries} value={rows.length} hint="" accent="primary" />
        <OperationKpiTile label={FL.totalTrips} value={t.trips} hint="" accent="primary" />
        <OperationKpiTile label={FL.availableDays} value={t.days} hint="" accent="muted" />
        <OperationKpiTile label={FL.utilisation} value={t.utilisation == null ? "" : `${Math.round(t.utilisation * 100)}%`} hint="" accent="success" />
        <OperationKpiTile label={FL.ordersPerTrip} value={t.ordersPerTrip == null ? "" : t.ordersPerTrip.toFixed(1)} hint="" accent="muted" />
        <OperationKpiTile label={FL.deliveryRevenue} value={rm(t.revenue)} hint="" accent="success" />
        <OperationKpiTile label={FL.revenuePerOrder} value={t.revenuePerOrder == null ? "" : rm(t.revenuePerOrder)} hint="" accent="muted" />
        <OperationKpiTile label={FL.revenuePerTrip} value={t.revenuePerTrip == null ? "" : rm(t.revenuePerTrip)} hint="" accent="muted" />
      </div>
      <DataGrid rows={rows} columns={columns} rowKey={(r) => r.vehicleId} storageKey="carres.operation.fleet-capacity.v1"
        appearance="reference" exportName={`${FL.capacity} ${from} ${to}`} groupBanner={false} isLoading={!q.isSuccess && !q.isError}
        toolbarStart={
          <span className="flex items-center gap-2">
            <input type="date" aria-label={FL.from} className={dateInput} value={from} data-testid="fleet-capacity-from"
              onChange={(e) => e.target.value && setRange((x) => ({ ...x, from: e.target.value }))} />
            <input type="date" aria-label={FL.to} className={dateInput} value={to} data-testid="fleet-capacity-to"
              onChange={(e) => e.target.value && setRange((x) => ({ ...x, to: e.target.value }))} />
            <Select id="fleet-capacity-lorry" toolbar value={lorry} onValueChange={setLorry}
              options={[{ value: ALL_LORRIES, label: FL.allLorries }, ...(q.data?.lorries ?? []).map((l) => ({ value: l.id, label: l.plate }))]} />
          </span>
        }
        emptyMessage={FL.noLorries}
        statusSummary={(v) => {
          const trips = v.reduce((n, r) => n + r.trips, 0);
          const revenue = v.reduce((n, r) => n + r.revenue, 0);
          return `${trips} ${FL.trips.toLowerCase()} · ${rm(revenue)}${trips ? ` · ${FL.revenuePerTrip} ${rm(revenue / trips)}` : ""}`;
        }} />
    </Page>
  );
}

/* ── Crew Leave (Houzs DriverLeave; Fleet Day skips crew on leave) ───────── */

export function CrewLeavePage() {
  const today = appTodayIso();
  const q = useFleet(today);
  const write = useFleetWrite();
  const [form, setForm] = useState({ crewId: "", fromDate: today, toDate: today, reason: "" });
  const [message, setMessage] = useState<string | null>(null);
  const crew = q.data?.crew ?? [];
  type Row = FleetPayload["leave"][number];
  const columns: DataGridColumn<Row>[] = [
    { key: "crew", label: FL.crew, width: 180, accessor: (r) => nameOf(q.data, r.crewId) },
    { key: "role", label: FL.role, width: 100, accessor: (r) => (crew.find((c) => c.id === r.crewId)?.role === "helper" ? FL.helper : FL.driver) },
    { key: "from", label: FL.from, width: 130, accessor: (r) => fmtDate(r.fromDate), dateValue: (r) => r.fromDate },
    { key: "to", label: FL.to, width: 130, accessor: (r) => fmtDate(r.toDate), dateValue: (r) => r.toDate },
    { key: "reason", label: FL.reason, width: 240, accessor: (r) => r.reason },
    { key: "act", label: "", exportLabel: FL.remove, width: 110, sortable: false, filterable: false, accessor: (r) => (
      <Button size="sm" onClick={(e) => { e.stopPropagation(); write.mutate({ path: `/leave/${r.id}`, method: "DELETE" }, { onError: (err) => setMessage(refusalOf(err)) }); }}>{FL.remove}</Button>
    ) },
  ];
  const add = () => {
    setMessage(null);
    write.mutate({ path: "/leave", body: form }, {
      onSuccess: () => setForm((f) => ({ ...f, reason: "" })),
      onError: (e) => setMessage(refusalOf(e)),
    });
  };
  return (
    <Page word={FL.crewLeave} testId="crew-leave" payload={q.data} error={q.isError}>
      {message ? <p role="alert" className="px-4 pb-2 text-body">{message}</p> : null}
      <DataGrid rows={q.data?.leave ?? []} columns={columns} rowKey={(r) => r.id} storageKey="carres.operation.crew-leave.v1"
        appearance="reference" exportName={FL.crewLeave} groupBanner={false} isLoading={!q.isSuccess && !q.isError}
        emptyMessage={FL.noLeave}
        toolbarStart={
          <span className="flex items-center gap-2" data-testid="crew-leave-form">
            <Select id="crew-leave-crew" toolbar placeholder={FL.crew} value={form.crewId || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, crewId: v }))}
              options={crew.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} (${c.role === "helper" ? FL.helper : FL.driver})` }))} />
            <input type="date" aria-label={FL.from} className={dateInput} value={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} />
            <input type="date" aria-label={FL.to} className={dateInput} value={form.toDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} />
            <input aria-label={FL.reason} placeholder={FL.reason} maxLength={200} className={dateInput} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            <Button size="sm" variant="primary" disabled={!form.crewId || !form.reason.trim() || form.toDate < form.fromDate}
              loading={write.isPending} onClick={add} data-testid="crew-leave-add">{FL.addLeave}</Button>
          </span>
        } />
    </Page>
  );
}
