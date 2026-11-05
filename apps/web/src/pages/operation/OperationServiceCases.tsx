import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import {
  caseFollowUpPlan,
  caseIssueLabel,
  caseNeedsManager,
  caseOpenSteps,
  caseProductCategoryLabel,
  caseSlaAction,
  caseSlaClock,
  caseSlaCountLabel,
  caseStageDwell,
  myHolidaySet,
  type CasePriority,
  type CaseSlaClock,
  type ServiceCase,
  type ServiceCaseListResponse,
} from "@carres/shared";
import { useAuth } from "@/lib/auth";
import ServiceCaseDetail from "./components/ServiceCaseDetail";
import { CasesBoard, CasesCalendar, caseStageDescription, downloadCasesCsv } from "./components/serviceCaseViews";
import ServiceCaseNumbersPanel from "./components/ServiceCaseNumbersPanel";
import ServiceCaseWizard from "./components/ServiceCaseWizard";
import CaseOrderLink from "./components/CaseOrderLink";
import Button from "@/components/kit/Button";
import Checkbox from "@/components/kit/Checkbox";
import Tabs from "@/components/kit/Tabs";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { REGISTER_FIELD_WIDTH as W } from "@/components/register/register-field-widths";
import ListPageShell from "@/components/ListPageShell";
import ModuleHeader from "./components/ModuleHeader";

/**
 * Operation Service Cases — the case (病历) list.
 * Each case classifies an issue (Case Type + Status) and holds the medical
 * record. A printable Service Note dispatch order is generated under a case (P2).
 *
 * List, filters and case page follow Houzs ServiceCases.tsx (Weisiang, WhatsApp 2026-11-01).
 */
export default function OperationServiceCases() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Houzs lands on the New Case panel from ?new=1 and on My Cases from the sidebar.
  const [showCreate, setShowCreate] = useState(searchParams.get("new") === "1");
  // 0711 — Weisiang's decision (Mr Lim, WhatsApp 2026-10-22), Houzs way: a
  // My cases switch (mine + my downline, decided by the server) and a stage
  // card filter (click a card, click it again to clear).
  const mine = searchParams.get("mine") === "1";
  // 0762 — Houzs Archived filter: the list shows archived cases only while it is on.
  const archived = searchParams.get("archived") === "1";
  const [hideCompleted, setHideCompleted] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignNote, setAssignNote] = useState<string | null>(null);
  const { user } = useAuth();
  const qc = useQueryClient();
  // Houzs ?creditor_code. A Carres creditor is the case's supplier.
  const creditorId = searchParams.get("creditor");

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value === null) params.delete(key);
    else params.set(key, value);
    setSearchParams(params, { replace: key !== "case" });
  };

  const setMine = (on: boolean) => setParam("mine", on ? "1" : null);

  // `?case=<id>` is the case's own page (Houzs /assr/:id), which is what the
  // order drawer's Related-cases row links to. It stays in the URL so a refresh
  // and Back land where they should.
  const caseId = searchParams.get("case");

  // S5 — the Quality Overview tab, `?view=quality`. Not `tab`: OperationApp reads that key to pick the module.
  const tab = searchParams.get("view") === "quality" ? "numbers" : "cases";
  const viewParam = searchParams.get("cases");
  const caseView = viewParam === "board" || viewParam === "calendar" ? viewParam : "list";

  const listQ = useQuery<ServiceCaseListResponse>({
    queryKey: ["ops", "service-cases", "list", mine, archived],
    queryFn: () => {
      const params = new URLSearchParams();
      if (mine) params.set("mine", "1");
      if (archived) params.set("archived", "1");
      return apiFetch(`/api/ops/service-cases${params.size ? `?${params}` : ""}`);
    },
    refetchInterval: 30_000,
    // The Quality Overview tab and the case page read their own endpoints.
    enabled: tab === "cases" && !caseId,
  });

  // 0711 — the owner's name on each row, from the same staff list every
  // Operation picker reads.
  const staffQ = useQuery<{ staff?: Array<{ user_id: string; name: string | null }> }>({
    queryKey: ["operation", "staff"],
    queryFn: () => apiFetch("/api/operation/staff"),
    staleTime: 60_000,
  });
  const staff = staffQ.data?.staff;
  const nameOf = useMemo(() => new Map((staff ?? []).map((p) => [p.user_id, p.name ?? ""])), [staff]);
  const ownerOf = useCallback((r: ServiceCase) => (r.ownerUserId ? nameOf.get(r.ownerUserId) ?? "" : ""), [nameOf]);

  // S4 — the deadline is counted in WORKING days, so the holiday calendar is
  // injected once for the whole table rather than rebuilt per row.
  const holidayOpts = useMemo(() => ({ holidays: myHolidaySet() }), []);
  const todayIso = appTodayIso();
  const clockOf = useCallback((r: ServiceCase) =>
    caseSlaClock(
      { openedAt: r.openedAt, todayIso, events: r.slaEvents ?? [], closed: r.statusIsClosed, customerName: r.customerName },
      holidayOpts,
    ), [holidayOpts, todayIso]);

  // 0745 — days in the current stage against its target (Houzs stage clock).
  const now = useMemo(() => new Date(listQ.dataUpdatedAt || Date.now()), [listQ.dataUpdatedAt]);
  const dwellOf = useCallback((r: ServiceCase) =>
    r.stageSince && !r.statusIsClosed ? caseStageDwell(r.stageSince, r.stageTargetDays, now) : null, [now]);
  const pastTarget = useCallback((r: ServiceCase) => dwellOf(r)?.overTarget ?? false, [dwellOf]);

  const allRows: ServiceCase[] = listQ.data?.items ?? [];
  const stages = stageCounts(allRows, (r) => clockOf(r).state === "late", pastTarget);
  // A picked stage with no cases left in this list has no card to un-press, so
  // it stops filtering instead of hiding every row.
  const stageShown = stageId !== null && stages.some((st) => st.id === stageId);
  // Picking the closed stage overrides Hide completed, or the list would look broken.
  const pickedClosedStage = stageShown && allRows.some((r) => (r.statusId ?? "") === stageId && r.statusIsClosed);
  const rows = allRows.filter((r) =>
    (!creditorId || r.supplierId === creditorId) && (!stageShown || (r.statusId ?? "") === stageId) && (!hideCompleted || pickedClosedStage || !r.statusIsClosed));

  const openCount = allRows.filter((r) => !r.statusIsClosed).length;
  const lateCount = allRows.filter((r) => clockOf(r).state === "late").length;
  const pastTargetCount = allRows.filter(pastTarget).length;

  // An empty list under a filter is not an empty module: say which filter emptied it.
  const filtered = mine || archived || hideCompleted || stageShown || !!creditorId;
  const emptyFilteredSentence = `No ${archived ? "archived " : ""}${hideCompleted ? "open " : ""}cases${mine ? " of yours" : ""}${stageShown ? " at this stage" : ""}${creditorId ? " for this creditor" : ""}.`;
  const resetFilters = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("mine");
    params.delete("creditor");
    params.delete("archived");
    setSearchParams(params, { replace: true });
    setHideCompleted(false);
    setStageId(null);
  };
  const creditors = [...new Map(allRows.flatMap((r) => (r.supplierId ? [[r.supplierId, r.supplierName ?? ""] as const] : []))).entries()]
    .sort((a, z) => a[1].localeCompare(z[1]));

  // Houzs bulk Assign to me, one PATCH per case: the server's Sales Order PIC
  // check (0711) still decides each one, and a refused case is named, not hidden.
  const assignToMe = async (cases: ServiceCase[]) => {
    if (!user) return;
    const refused: string[] = [];
    for (const c of cases) {
      try {
        await apiFetch(`/api/ops/service-cases/${c.id}`, { method: "PATCH", body: JSON.stringify({ ownerUserId: user.id }) });
      } catch {
        refused.push(c.caseNo);
      }
    }
    setPicked(new Set());
    setAssignNote(refused.length
      ? `${cases.length - refused.length} assigned to you. Not assigned: ${refused.join(", ")}. Only the sales order PIC can pick who owns a case.`
      : `${cases.length} assigned to you.`);
    void qc.invalidateQueries({ queryKey: ["ops", "service-cases"] });
  };

  // 0762 — Houzs bulk archive / unarchive (assr.ts:1140), one PATCH per case like Assign to me.
  const setArchived = async (cases: ServiceCase[], on: boolean) => {
    const refused: string[] = [];
    for (const c of cases) {
      try {
        await apiFetch(`/api/ops/service-cases/${c.id}`, { method: "PATCH", body: JSON.stringify({ archived: on }) });
      } catch {
        refused.push(c.caseNo);
      }
    }
    setPicked(new Set());
    const done = `${cases.length - refused.length} ${on ? "archived" : "unarchived"}.`;
    setAssignNote(refused.length ? `${done} Not changed: ${refused.join(", ")}.` : done);
    void qc.invalidateQueries({ queryKey: ["ops", "service-cases"] });
  };


  // Houzs ServiceCases.tsx:578-948 and serviceCaseStageColumns.tsx, same order
  // and words. Days in stage and In stage since read the 0745 stage history.
  const columns = useMemo<DataGridColumn<ServiceCase>[]>(() => [
    {
      key: "stage", label: "Stage", width: W.status,
      accessor: (r) => (
        <span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`pill ${r.statusIsClosed ? "pill-confirmed" : "pill-neutral"}`}>{r.statusLabel ?? "Unset"}</span>
            {clockOf(r).state === "late" && <span className="pill pill-overdue">SLA</span>}
          </span>
          {/* 0760 — Houzs ServiceCases.tsx:625: the sub-status rides a muted second line. */}
          {r.subStatusLabel && <span className="block text-meta text-base-500">{r.subStatusLabel}</span>}
        </span>
      ),
      searchValue: (r) => r.statusLabel ?? "Unset",
    },
    {
      key: "caseNo", label: "ASSR No", width: W.documentNo,
      accessor: (r) => <Link to={`?${caseLink(searchParams, r.id)}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold">{r.caseNo}</Link>,
      searchValue: (r) => r.caseNo,
    },
    { key: "opened", label: "Date", width: W.date, accessor: (r) => fmtDate(r.openedAt), dateValue: (r) => r.openedAt, filterType: "date" },
    // J2 — the case→order link answers "which order is this about".
    { key: "so", label: "SO No", width: W.documentNo, accessor: (r) => <CaseOrderLink orderId={r.orderId} so={r.so} compact />, searchValue: (r) => String(r.so ?? "") },
    { key: "ref", label: "Ref No.", width: W.documentNo, accessor: (r) => (r.refNo ? <span className="font-mono">{r.refNo}</span> : null), searchValue: (r) => r.refNo ?? "" },
    { key: "do", label: "DO No", width: W.documentNo, accessor: (r) => <span className="font-mono">{(r.doNumbers ?? []).join(" · ")}</span>, searchValue: (r) => (r.doNumbers ?? []).join(" ") },
    { key: "po", label: "PO", width: W.documentNo, accessor: (r) => <span className="font-mono">{(r.poNumbers ?? []).join(" · ")}</span>, searchValue: (r) => (r.poNumbers ?? []).join(" ") },
    { key: "customer", label: "Customer", width: W.customer, accessor: (r) => r.customerName || null, searchValue: (r) => r.customerName ?? "" },
    { key: "salesperson", label: "Salesperson", width: W.requestedBy, accessor: (r) => r.salespersonName ?? null, searchValue: (r) => r.salespersonName ?? "" },
    // S1 — the urgency a new case starts from, and staff edit it after (0711).
    { key: "priority", label: "Priority", width: W.status, accessor: (r) => <PriorityCell priority={r.priority ?? null} />, searchValue: (r) => r.priority ?? "" },
    // 0745 — Houzs ServiceCases.tsx:773 (dwell in the current stage); red at or past the stage's target days.
    { key: "dwell", label: "Days in stage", width: W.status, align: "right", accessor: (r) => <DwellCell dwell={dwellOf(r)} target={r.stageTargetDays ?? null} /> },
    { key: "stageSince", label: "In stage since", width: W.date, defaultHidden: true, accessor: (r) => (r.stageSince ? fmtDate(r.stageSince) : null), dateValue: (r) => r.stageSince ?? "", filterType: "date" },
    { key: "owner", label: "Assigned To", width: W.requestedBy, accessor: (r) => ownerOf(r) || null, searchValue: ownerOf },
    { key: "item", label: "Item", width: W.documentNo, defaultHidden: true, accessor: (r) => (r.productSku ? <span className="font-mono">{r.productSku}</span> : null), searchValue: (r) => r.productSku ?? "" },
    { key: "what", label: "Complaint Issue", width: 260, accessor: (r) => <p className="line-clamp-2 whitespace-normal">{r.whatHappened || null}</p>, searchValue: (r) => r.whatHappened ?? "" },
    { key: "resolution", label: "Resolution", width: 260, defaultHidden: true, accessor: (r) => <p className="line-clamp-2 whitespace-normal">{r.carresAction || null}</p>, searchValue: (r) => r.carresAction ?? "" },
    { key: "phone", label: "Phone", width: W.documentNo, defaultHidden: true, accessor: (r) => (r.customerPhone ? <span className="font-mono">{r.customerPhone}</span> : null), searchValue: (r) => r.customerPhone ?? "" },
    { key: "location", label: "Location", width: W.customer, defaultHidden: true, accessor: (r) => r.customerAddress || null, searchValue: (r) => r.customerAddress ?? "" },
    { key: "category", label: "Service Category", width: W.category, defaultHidden: true, accessor: (r) => (r.productCategory ? caseProductCategoryLabel(r.productCategory) : null), searchValue: (r) => (r.productCategory ? caseProductCategoryLabel(r.productCategory) : "") },
    { key: "issue", label: "Issue Category", width: W.category, defaultHidden: true, accessor: (r) => (r.issueType ? caseIssueLabel(r.issueType) : null), searchValue: (r) => (r.issueType ? caseIssueLabel(r.issueType) : "") },
    { key: "method", label: "Resolution Method", width: W.category, defaultHidden: true, accessor: (r) => r.resolutionMethodLabel ?? null, searchValue: (r) => r.resolutionMethodLabel ?? "" },
    { key: "type", label: "Case Type", width: W.category, defaultHidden: true, accessor: (r) => r.caseTypeLabel ?? null, searchValue: (r) => r.caseTypeLabel ?? "" },
    { key: "supplier", label: "Supplier", width: W.customer, accessor: (r) => r.supplierName ?? null, searchValue: (r) => r.supplierName ?? "" },
    // S4 — 14 working days from the day it was reported, from the same clock the case view and server read.
    { key: "deadline", label: "Deadline", width: W.date, accessor: (r) => <DeadlineCell clock={clockOf(r)} /> },
    { key: "overdue", label: "Days overdue", width: W.status, align: "right", accessor: (r) => { const c = clockOf(r); return c.state === "off" ? null : <span className={c.state === "late" ? "font-semibold tabular-nums text-error-700" : "tabular-nums text-base-500"}>{c.workingDaysLate}</span>; } },
    { key: "age", label: "Case age", width: W.status, align: "right", accessor: (r) => <span className="tabular-nums">{caseAgeDays(r.openedAt, todayIso)} days</span> },
    // S3 — what to DO next, derived from the case's own answers. Houzs has no such column.
    { key: "next", label: "Next step", width: 240, defaultHidden: true, accessor: (r) => <NextStepCell row={r} clock={clockOf(r)} /> },
  ], [ownerOf, clockOf, dwellOf, todayIso, searchParams]);

  if (caseId) return <ServiceCaseDetail id={caseId} onBack={() => setParam("case", null)} />;

  const filters = (
    <CaseFilters view={caseView} onView={(v) => setParam("cases", v === "list" ? null : v)} mine={mine} onMine={setMine}
      hideCompleted={hideCompleted} onHideCompleted={setHideCompleted} filtered={filtered} onReset={resetFilters}
      archived={archived} onArchived={(v) => setParam("archived", v ? "1" : null)}
      creditors={creditors} creditorId={creditorId} onCreditor={(v) => setParam("creditor", v)} />
  );
  // Export All ignores the stage, search and creditor filters; the grid's own Export takes the current view.
  const newCase = (
    <>
      <Button variant="neutral" disabled={allRows.length === 0} onClick={() => downloadCasesCsv(allRows, clockOf, ownerOf, todayIso)}>Export All</Button>
      <Button variant="primary" icon="add" onClick={() => setShowCreate(true)}>New Case</Button>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="operation-service-cases">
      <ModuleHeader destinationHeader testId="operation-service-cases-header" word="Service Cases" docTitle="Service Cases · Carres" />
      {/* One page, two views. Houzs picks these from the sidebar; this stays
          until the sidebar rows land. */}
      <div className="flex items-center gap-4 px-3 pt-3">
        <Tabs label="Service Cases view" value={tab} onValueChange={(v) => setParam("view", v === "numbers" ? "quality" : null)}
          tabs={[{ value: "cases", label: "Service Cases" }, { value: "numbers", label: "Quality Overview" }]} />
        {/* 0711 — Houzs keeps Service Maintenance beside the cases. */}
        <Link to="/operation/settings/service" className="ml-auto py-2 text-body text-base-500 hover:text-base-700">
          Service Maintenance
        </Link>
      </div>

      {tab === "numbers" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3"><ServiceCaseNumbersPanel /></div>
      ) : (
      <ListPageShell register>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {allRows.length > 0 && (
            <>
              {/* Houzs ServiceCases.tsx:1297-1324, without Avg Resolution: Carres keeps no closing date. */}
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SummaryCard label="Open Cases" value={openCount} note={`${allRows.length} total`} />
                <SummaryCard label="SLA Risk" value={lateCount} note={lateCount > 0 ? "needs attention" : "on track"} alert={lateCount > 0} />
                <SummaryCard label="Completed" value={allRows.length - openCount} note="closed cases" />
              </div>
              {/* 0711 — Stage funnel: click a stage to filter, click again (or All) to clear. */}
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[{ id: null as string | null, label: "All", count: allRows.length, overdue: lateCount, pastTarget: pastTargetCount }, ...stages].map((st) => {
                  const active = st.id === null ? !stageShown : stageId === st.id;
                  return (
                    <button key={st.id ?? "all"} type="button" aria-pressed={active} data-testid={`case-stage-card-${st.id ?? "all"}`}
                      onClick={() => setStageId(st.id === null || stageId === st.id ? null : st.id)}
                      className={`kpi-box text-left ${active ? "border-base-900" : ""}`}>
                      <span className="flex items-center gap-1.5">
                        <span className="text-strong font-semibold t-num text-base-900">{st.count}</span>
                        {st.overdue > 0 && <span className="pill pill-overdue">{st.overdue} overdue</span>}
                        {st.pastTarget > 0 && <span className="pill pill-overdue">{st.pastTarget} past target</span>}
                      </span>
                      <span className="label mt-1 text-base-500">{st.label}</span>
                      <span className="text-meta text-base-500">{st.id === null ? "Every case in this list" : caseStageDescription(st.label)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {assignNote && <p role="status" className="mb-3 text-body text-base-700">{assignNote}</p>}
          {listQ.isError && !listQ.data ? (
            /* A failure sentence is never the empty sentence (COPY-STANDARD 2026-08-28). */
            <div role="alert" className="flex flex-col items-center gap-3 rounded border border-base-200 bg-white p-12 text-center">
              <p className="text-body text-base-700">Service Cases could not be opened</p>
              <Button variant="neutral" onClick={() => void listQ.refetch()}>Try again</Button>
            </div>
          ) : caseView === "list" ? (
            <DataGrid<ServiceCase>
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              storageKey="carres.operation.service-cases.v2"
              appearance="reference"
              groupBanner={false}
              isLoading={listQ.isLoading}
              onRowClick={(r) => setParam("case", r.id)}
              selectable={{
                selectedKeys: picked,
                onToggle: (key) => setPicked((prev) => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; }),
                onToggleAll: (keys, all) => setPicked(all ? new Set() : new Set(keys)),
              }}
              selectionActions={[
                { label: () => "Assign to me", kind: "write", onClick: (selected) => void assignToMe(selected as unknown as ServiceCase[]) },
                { label: () => (archived ? "Unarchive" : "Archive"), kind: "write", onClick: (selected) => void setArchived(selected as unknown as ServiceCase[], !archived) },
              ]}
              searchPlaceholder="Search ASSR no, SO no, Ref no, customer, salesperson, phone…"
              exportName="Service Cases"
              emptyMessage={filtered ? emptyFilteredSentence : "No service cases"}
              toolbarStart={filters}
              toolbarEnd={newCase}
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {filters}
                <span className="ml-auto">{newCase}</span>
              </div>
              {caseView === "board"
                ? <CasesBoard rows={rows} clockOf={clockOf} ownerOf={ownerOf} onOpen={(id) => setParam("case", id)} />
                : <CasesCalendar rows={rows} clockOf={clockOf} ownerOf={ownerOf} onOpen={(id) => setParam("case", id)} />}
            </>
          )}
        </div>
      </ListPageShell>
      )}

      {/* S1 — "+ New Case" opens the guided wizard. */}
      {showCreate && (
        <ServiceCaseWizard onClose={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function caseLink(params: URLSearchParams, id: string): string {
  const next = new URLSearchParams(params);
  next.set("case", id);
  return next.toString();
}

/** Calendar days since the case was reported (Houzs Case age). */
export function caseAgeDays(openedAt: string, todayIso: string): number {
  return Math.max(0, Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${openedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000));
}

/** 0745 — "4 days", or "4 / 3 days" when the stage has a target; red at or past it. */
function DwellCell({ dwell, target }: { dwell: { days: number; overTarget: boolean } | null; target: number | null }) {
  if (!dwell) return null;
  return (
    <span className={dwell.overTarget ? "font-semibold tabular-nums text-error-700" : "tabular-nums"}>
      {target != null ? `${dwell.days} / ${target}` : dwell.days} days
    </span>
  );
}

function SummaryCard({ label, value, note, alert = false }: { label: string; value: number; note: string; alert?: boolean }) {
  return (
    <div className="kpi-box">
      <span className="label text-base-500">{label}</span>
      <span className={`text-strong font-semibold t-num mt-1 ${alert ? "text-error-700" : "text-base-900"}`}>{value}</span>
      <span className="text-meta text-base-500">{note}</span>
    </div>
  );
}

function CaseFilters({ view, onView, mine, onMine, hideCompleted, onHideCompleted, filtered, onReset, creditors, creditorId, onCreditor, archived, onArchived }: {
  view: string; onView: (v: string) => void; mine: boolean; onMine: (v: boolean) => void;
  archived: boolean; onArchived: (v: boolean) => void;
  hideCompleted: boolean; onHideCompleted: (v: boolean) => void; filtered: boolean; onReset: () => void;
  creditors: (readonly [string, string])[]; creditorId: string | null; onCreditor: (id: string | null) => void;
}) {
  return (
    <>
      <div className="flex rounded border border-base-200 overflow-hidden text-body">
        {(["list", "board", "calendar"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}
            className={`px-3 py-1.5 font-medium ${view === v ? "bg-base-900 text-white" : "bg-white text-base-600 hover:bg-base-50"}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <Checkbox id="service-cases-mine" label="My cases" checked={mine} onCheckedChange={onMine} />
      <Checkbox id="service-cases-hide-completed" label="Hide completed" checked={hideCompleted} onCheckedChange={onHideCompleted} />
      <Checkbox id="service-cases-archived" label="Archived" checked={archived} onCheckedChange={onArchived} />
      <select aria-label="Creditor" value={creditorId ?? ""} onChange={(e) => onCreditor(e.target.value || null)}
        className="rounded border border-base-300 bg-white px-2 py-1.5 text-body">
        <option value="">All creditors</option>
        {creditors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      {filtered && <Button variant="neutral" onClick={onReset}>Reset filters</Button>}
    </>
  );
}

/**
 * S3 — the ONE follow-up that shows first, with the rest behind a "+N"
 * (ACTION-FLOW-STANDARD Law 1, layer 2: nothing is suppressed, only out-ranked;
 * every open step is visible the moment the case is opened).
 *
 * A closed case shows the terminal fact instead of an action — there is nothing
 * to do on it, and "Done" is a fact, not a to-do word.
 */
function NextStepCell({ row, clock }: { row: ServiceCase; clock: CaseSlaClock }) {
  if (row.statusIsClosed) return <span className="text-meta text-base-500">Done</span>;

  const open = caseOpenSteps(
    caseFollowUpPlan({
      customerWants: row.customerWants ?? [],
      customerName:  row.customerName,
      supplierName:  row.supplierName ?? null,
    }),
    row.progress ?? [],
  ).map((s) => s.label);

  // S4 — the deadline is its own TRACK, computed independently of the chain
  // (ACTION-FLOW-STANDARD Law 1: one track may never suppress another's
  // action). It goes FIRST because Law 4 ranks "the customer must be told
  // something" above every goods step — the chain's own work is unaffected and
  // rides behind it.
  const slaAction = caseSlaAction(clock, row.customerName);
  const actions = slaAction ? [slaAction, ...open] : open;

  if (actions.length === 0) {
    return (
      <span className="text-body text-base-700">Everything done. Close this case.</span>
    );
  }

  return (
    <span className="block">
      <span className="block text-body text-base-900">{actions[0]}</span>
      {actions.length > 1 && (
        <span className="text-meta text-base-500">+{actions.length - 1} more</span>
      )}
    </span>
  );
}

/**
 * S4 — the deadline, as a FACT: the date, and how the clock stands against it.
 * Never a to-do word (COPY-STANDARD) — the thing to DO about a deadline is in
 * the Next step column, where every other action lives.
 *
 * A closed case shows only the date it was working to: its clock is off, and a
 * count on a finished case would be a number nobody can act on.
 */
function DeadlineCell({ clock }: { clock: CaseSlaClock }) {
  if (!clock.dueIso) return null;
  const count = caseSlaCountLabel(clock);

  return (
    <span className="block">
      <span className="block text-body text-base-900 tabular-nums">{fmtDate(clock.dueIso)}</span>
      {count && (
        <span
          className={`text-meta block tabular-nums ${
            clock.state === "late" ? "text-error-700" : "text-base-500"
          }`}
        >
          {count}
        </span>
      )}
      {clock.extendedToIso && (
        <span className="text-meta block text-base-500">Moved once</span>
      )}
    </span>
  );
}

/** Urgency, derived — never typed. A case filed before the wizard (or through
 *  the edit modal, which asks no usability question) has none, and says so
 *  rather than inventing a middle value. */
function PriorityCell({ priority }: { priority: CasePriority | null }) {
  if (!priority) return null;
  if (priority === "high") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="pill pill-overdue">Urgent</span>
        {caseNeedsManager(priority) && (
          <span className="text-meta text-base-600">tell manager</span>
        )}
      </span>
    );
  }
  return (
    <span className="pill pill-neutral">{priority === "normal" ? "Normal" : "Low"}</span>
  );
}

/** 0711 — how many cases sit in each stage, in the order stages first appear,
 *  and how many of them are overdue. A case with no stage counts under "Unset". */
export function stageCounts(
  rows: readonly ServiceCase[],
  isLate: (r: ServiceCase) => boolean = () => false,
  isPastTarget: (r: ServiceCase) => boolean = () => false,
): { id: string; label: string; count: number; overdue: number; pastTarget: number }[] {
  const out = new Map<string, { id: string; label: string; count: number; overdue: number; pastTarget: number }>();
  for (const r of rows) {
    const id = r.statusId ?? "";
    const hit = out.get(id) ?? { id, label: r.statusLabel ?? "Unset", count: 0, overdue: 0, pastTarget: 0 };
    hit.count += 1;
    if (isLate(r)) hit.overdue += 1;
    if (isPastTarget(r)) hit.pastTarget += 1;
    out.set(id, hit);
  }
  return [...out.values()];
}
