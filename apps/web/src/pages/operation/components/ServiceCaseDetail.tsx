import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CASE_COPIES } from "@/pages/print/ServiceCasePrintPage";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import {
  CASE_ITEM_LOCATION_KEYS,
  CASE_LEG_BY_KEYS,
  CASE_PICKUP_STATUS_KEYS,
  CASE_REPORTERS,
  caseDelayReasonLabel,
  caseFollowUpPlan,
  caseLegLabel,
  caseNeedsManager,
  caseResolutionRoute,
  caseStageDwell,
  fmtMoney,
  caseUsableLabel,
  caseWantLabel,
  logisticsConfirmedText,
  type ServiceCase,
  type ServiceCaseConfig,
  type ServiceCaseListResponse,
  casePickupPicOptions,
} from "@carres/shared";
import { ArrowLeft } from "lucide-react";
import CaseOrderLink from "./CaseOrderLink";
import CaseEvidenceGallery from "./CaseEvidenceGallery";
import CaseFollowUps from "./CaseFollowUps";
import CaseDeadline from "./CaseDeadline";
import CaseCostSuggestion from "./CaseCostSuggestion";
import CaseRemedyApproval from "./CaseRemedyApproval";
import ConfirmActionDialog from "./ConfirmActionDialog";
import Button from "@/components/kit/Button";
import Select from "@/components/kit/Select";

/**
 * A Service Case's own page, after Houzs DetailContent (ServiceCases.tsx:3182):
 * title row, stage workflow, then Issue + Product Info and the working sections
 * on the left, Customer, Assigned to, deadline, history and Timeline on the right.
 *
 * Case Type + Stage come from the config tables (never hardcoded).
 */
export default function ServiceCaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [remedyDirty, setRemedyDirty] = useState(false);
  const [remedyBusy, setRemedyBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const configQ = useQuery<ServiceCaseConfig>({
    queryKey: ["ops", "service-cases", "config"],
    queryFn: () => apiFetch("/api/ops/service-cases/config"),
    staleTime: 5 * 60_000,
  });

  // Houzs PickupTrackingFields.tsx:31-39: the drivers for the Pickup PIC dropdown.
  const driversQ = useQuery<{ data: Array<{ name: string }> }>({
    queryKey: ["ops", "service-cases", "pickup-pic-drivers"],
    queryFn: () => apiFetch("/api/ops/service-cases/pickup-pic-drivers"),
    staleTime: 5 * 60_000,
  });
  const existingQ = useQuery<ServiceCase>({
    queryKey: ["ops", "service-cases", id],
    queryFn: () => apiFetch(`/api/ops/service-cases/${id}`),
  });

  // Customer History reads the same list the page came from.
  const listQ = useQuery<ServiceCaseListResponse>({
    queryKey: ["ops", "service-cases", "list", false],
    queryFn: () => apiFetch("/api/ops/service-cases"),
    staleTime: 60_000,
  });

  const staffQ = useQuery<{ staff?: Array<{ user_id: string; name: string | null }> }>({
    queryKey: ["operation", "staff"],
    queryFn: () => apiFetch("/api/operation/staff"),
    staleTime: 60_000,
  });
  const staff = staffQ.data?.staff;
  const nameOf = useMemo(() => new Map((staff ?? []).map((p) => [p.user_id, p.name ?? ""])), [staff]);

  // Houzs InlineEdit: each field saves itself, so there is no page-wide Save.
  const save = async (patch: Record<string, unknown>) => {
    await apiFetch(`/api/ops/service-cases/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await qc.invalidateQueries({ queryKey: ["ops", "service-cases"] });
  };
  // The selects have no field of their own to show a refusal in.
  const [selectError, setSelectError] = useState<string | null>(null);
  const saveSelect = (patch: Record<string, unknown>) => {
    setSelectError(null);
    save(patch).catch((e: Error) => setSelectError(e.message));
  };
  const d = existingQ.data;

  // 0711 — staff move a case to any stage by hand, and Close Case sits on every
  // open case (Houzs ServiceCases.tsx), Weisiang's decision 2026-10-22.
  const stageMut = useMutation({
    mutationFn: (statusId: string) =>
      apiFetch(`/api/ops/service-cases/${id}`, { method: "PATCH", body: JSON.stringify({ statusId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "service-cases"] }),
  });

  const requestBack = () => {
    if (remedyBusy) return;
    if (remedyDirty) setDiscardOpen(true); else onBack();
  };

  const back = (
    <button type="button" onClick={requestBack} className="inline-flex items-center gap-1 text-body text-base-500 hover:text-base-700">
      <ArrowLeft size={14} /> Service Cases
    </button>
  );

  if (existingQ.isError) {
    return (
      <div className="p-3">
        {back}
        <div role="alert" className="mt-3 flex flex-col items-center gap-3 rounded border border-base-200 bg-white p-12 text-center">
          <p className="text-body text-base-700">This case could not be opened</p>
          <Button variant="neutral" onClick={() => void existingQ.refetch()}>Try again</Button>
        </div>
      </div>
    );
  }
  if (!d) return <div className="p-3">{back}<p className="mt-3 text-body text-base-500">Loading…</p></div>;

  const stages = configQ.data?.statuses ?? [];
  const closedStage = stages.find((st) => st.isClosed);
  const firstOpenStage = stages.find((st) => !st.isClosed);
  const currentIndex = stages.findIndex((st) => st.id === d.statusId);
  const nextStage = d.statusIsClosed ? undefined : stages.slice(currentIndex + 1).find((st) => !st.isClosed);
  const stageBusy = stageMut.isPending || remedyBusy;
  const subStatuses = (configQ.data?.subStatuses ?? []).filter((ss) => ss.statusId === d.statusId);
  const history = customerHistory(d, listQ.data?.items ?? []);
  const stageLabel = new Map(stages.map((st) => [st.id, st.label] as const));
  const timeline = caseTimeline(d, (u) => nameOf.get(u) ?? "", (id) => stageLabel.get(id) ?? "");
  const dwell = d.stageSince && !d.statusIsClosed ? caseStageDwell(d.stageSince, d.stageTargetDays, new Date()) : null;

  return (
    <>
      <div className="h-full min-h-0 space-y-3 overflow-auto p-3" data-testid="service-case-detail">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-meta uppercase tracking-wider text-base-500">Service Case</p>
            <h1 className="font-mono text-strong font-semibold text-base-900">{d.caseNo}</h1>
            <p className="mt-1 text-body text-base-600">
              Customer <b className="font-semibold text-base-900">{d.customerName}</b>
              {" · "}Stage <b className="font-semibold text-base-900">{d.statusLabel ?? "Unset"}</b>
              {/* 0745 — Houzs LeadTimePill (ServiceCases.tsx:7133): days in the stage against its target. */}
              {dwell && (
                <>{" · "}<span className={dwell.overTarget ? "font-semibold text-error-700" : ""}>
                  In stage {dwell.days} {d.stageTargetDays != null ? `of ${d.stageTargetDays} ` : ""}days
                </span></>
              )}
              {d.so != null && <>{" · "}<span className="font-mono">SO-{d.so}</span></>}
              {d.refNo && <>{" · "}Ref <span className="font-mono">{d.refNo}</span></>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.statusIsClosed && firstOpenStage && (
              <Button onClick={() => stageMut.mutate(firstOpenStage.id)} loading={stageMut.isPending} disabled={stageBusy}>Reopen Case</Button>
            )}
            {!d.statusIsClosed && closedStage && (
              <Button onClick={() => stageMut.mutate(closedStage.id)} loading={stageMut.isPending} disabled={stageBusy}>Close Case</Button>
            )}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded border border-base-300 bg-white px-3 py-1.5 text-body font-medium text-base-700 hover:bg-base-50">Print</summary>
              <div role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded border border-base-200 bg-white py-1">
                {CASE_COPIES.map((copy) => (
                  <a key={copy.key} role="menuitem" href={`/print/service-case/${id}?copy=${copy.key}`} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-base-50">
                    <span className="block text-body text-base-900">{copy.label}</span>
                    <span className="block text-meta text-base-500">{copy.hint}</span>
                  </a>
                ))}
              </div>
            </details>
          </div>
        </div>

        {selectError && <p role="alert" className="text-meta text-error-700 break-words">Save failed: {selectError}</p>}
        {stageMut.isError && <p role="alert" className="text-meta text-error-700 break-words">Stage change failed: {(stageMut.error as Error)?.message ?? "unknown error"}</p>}

        {/* Workflow — click a stage to move the case there. */}
        <section aria-label="Workflow" className="rounded border border-base-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ol className="flex flex-wrap gap-2">
              {stages.map((st, i) => (
                <li key={st.id}>
                  <button type="button" aria-current={st.id === d.statusId ? "step" : undefined} disabled={stageBusy || st.id === d.statusId}
                    onClick={() => stageMut.mutate(st.id)}
                    className={`rounded border px-3 py-1.5 text-body ${st.id === d.statusId ? "border-base-900 bg-base-900 text-white" : "border-base-200 bg-white text-base-600 hover:bg-base-50 disabled:opacity-60"}`}>
                    {i + 1}. {st.label}
                  </button>
                </li>
              ))}
            </ol>
            {nextStage && (
              <span className="ml-auto"><Button variant="neutral" onClick={() => stageMut.mutate(nextStage.id)} disabled={stageBusy}>Move to {nextStage.label}</Button></span>
            )}
          </div>
          {/* 0760 — Houzs WorkflowCard onSubChange: staff switch the sub-status directly. */}
          {subStatuses.length > 0 && (
            <div className="mt-3 max-w-xs">
              <Select id="case-sub-status" label="Sub-status" value={d.subStatusId ?? undefined} onValueChange={(v) => saveSelect({ subStatusId: v })} placeholder="Sub-status"
                options={subStatuses.map((ss) => ({ value: ss.id, label: ss.label }))} />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.62fr_1fr]">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Panel title="Issue">
                <InlineField id="scm-happened" label="Complaint" textarea value={d.whatHappened} onSave={(v) => save({ whatHappened: v })} />
                <Field label="Case Type" htmlFor="scm-type">
                  <select id="scm-type" value={d.caseTypeId ?? ""} onChange={(e) => saveSelect({ caseTypeId: e.target.value || null })} className="w-full rounded border border-base-300 bg-white px-2 py-1.5 text-body">
                    <option value="">Case Type</option>
                    {configQ.data?.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                {/* 0764 — Houzs 065_assr_lookups.sql: priorities, issue and product categories, root causes from Service Settings. */}
                <Select id="case-priority" label="Priority" value={d.priority ?? undefined} onValueChange={(v) => saveSelect({ priority: v })} placeholder="Priority"
                  options={lookupOptions(configQ.data?.priorities, d.priority, d.priorityLabel)} />
                <Select id="case-issue-category" label="Issue Category" value={d.issueType ?? undefined} onValueChange={(v) => saveSelect({ issueType: v })} placeholder="Issue Category"
                  options={lookupOptions(configQ.data?.issueCategories, d.issueType, d.issueTypeLabel)} />
                <Select id="case-product-category" label="Product Category" value={d.productCategory ?? undefined} onValueChange={(v) => saveSelect({ productCategory: v })} placeholder="Product Category"
                  options={lookupOptions(configQ.data?.productCategories, d.productCategory, d.productCategoryLabel)} />
                <Select id="case-root-cause" label="Root Cause" value={d.rootCause ?? undefined} onValueChange={(v) => saveSelect({ rootCause: v })} placeholder="Root Cause"
                  options={lookupOptions(configQ.data?.rootCauses, d.rootCause, d.rootCauseLabel)} />
                {d.priority && caseNeedsManager(d.priority) && <p className="text-meta text-base-600">tell manager</p>}
                <InlineField id="scm-opened" label="Date" type="date" required value={d.openedAt} onSave={(v) => save({ openedAt: v })} />
              </Panel>
              <Panel title="Product Info">
                {/* S1 — the guided intake's answers are asked once and only read here. */}
                <dl className="space-y-1.5">
                  <InfoRow label="Product" value={d.productSku ?? null} />
                  <InfoRow label="Found by" value={reporterLabel(d.reportedBy)} />
                  <InfoRow label="Still usable" value={d.usable ? caseUsableLabel(d.usable) : null} />
                  <InfoRow label="Customer wants" value={(d.customerWants ?? []).map(caseWantLabel).join(", ")} />
                  <InfoRow label="Supplier" value={d.supplierName ?? null} />
                  <InfoRow label="DO No" value={(d.doNumbers ?? []).join(" · ")} />
                  <InfoRow label="PO" value={(d.poNumbers ?? []).join(" · ")} />
                </dl>
              </Panel>
            </div>

            <Panel title="Photos and videos">
              <CaseEvidenceGallery caseId={id} issueType={d.issueType ?? null} reportedBy={d.reportedBy ?? null} />
            </Panel>

            {/* S3 — the follow-up chain, derived from what the customer asked for. */}
            <CaseFollowUps
              caseId={id}
              answers={{ customerWants: d.customerWants ?? [], customerName: d.customerName, supplierName: d.supplierName ?? null }}
              progress={d.progress ?? []}
            />

            {/* 0746 — Houzs PickupTrackingFields + DeliveryByCard. The date Service keys is a
                request; until Delivery Planning reads cases, staff key the confirmed date here. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Panel title="Pickup / Return">
                <Select id="case-pickup-by" label="Pickup by" value={d.pickupBy ?? undefined} onValueChange={(v) => saveSelect({ pickupBy: v })} placeholder="Pickup by" options={legOptions(CASE_LEG_BY_KEYS)} />
                <Select id="case-pickup-status" label="Pickup Status" value={d.pickupStatus ?? undefined} onValueChange={(v) => saveSelect({ pickupStatus: v })} placeholder="Pickup Status" options={legOptions(CASE_PICKUP_STATUS_KEYS)} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <InlineField id="scm-pickup-eta" label="Scheduled Pickup Date (ETA)" type="date" value={d.pickupRequestedAt} onSave={(v) => save({ pickupRequestedAt: v || null })} />
                  <InlineField id="scm-pickup-confirmed" label="Logistics Confirmed Date" type="date" value={d.pickupConfirmedAt} onSave={(v) => save({ pickupConfirmedAt: v || null })} />
                  <InlineField id="scm-pickup-actual" label="Actual Pickup Date" type="date" value={d.actualPickupAt} onSave={(v) => save({ actualPickupAt: v || null })} />
                </div>
                {d.pickupBy === "own" && !d.actualPickupAt && <LegNote requested={d.pickupRequestedAt} confirmed={d.pickupConfirmedAt} />}
                <Select id="case-pickup-pic" label="Pickup PIC" value={d.pickupPic ?? undefined} onValueChange={(v) => saveSelect({ pickupPic: v })} placeholder="Pickup PIC"
                  options={casePickupPicOptions((driversQ.data?.data ?? []).map((r) => r.name), d.supplierName ?? null, d.pickupPic ?? null)} />
                <Select id="case-item-location" label="Current Item Location" value={d.itemLocation ?? undefined} onValueChange={(v) => saveSelect({ itemLocation: v })} placeholder="Current Item Location" options={legOptions(CASE_ITEM_LOCATION_KEYS)} />
              </Panel>
              <Panel title="Delivery Back">
                <Select id="case-delivery-by" label="Delivery by" value={d.deliveryBy ?? undefined} onValueChange={(v) => saveSelect({ deliveryBy: v })} placeholder="Delivery by" options={legOptions(CASE_LEG_BY_KEYS)} />
                {d.deliveryBy === "own" && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <InlineField id="scm-delivery-date" label="Delivery Date" type="date" value={d.deliveryRequestedAt} onSave={(v) => save({ deliveryRequestedAt: v || null })} />
                      <InlineField id="scm-delivery-confirmed" label="Logistics Confirmed Date" type="date" value={d.deliveryConfirmedAt} onSave={(v) => save({ deliveryConfirmedAt: v || null })} />
                    </div>
                    <LegNote requested={d.deliveryRequestedAt} confirmed={d.deliveryConfirmedAt} />
                  </>
                )}
                {d.deliveryBy === "supplier" && <p className="text-meta text-base-600">The supplier delivers it back.</p>}
              </Panel>
            </div>

            <Panel title="Resolution">
              <div className="flex flex-wrap gap-4 text-body">
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=customer-return&case=${id}`}>Plan Customer Return</Link>
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=failed-delivery-return&case=${id}`}>Plan Failed Delivery return</Link>
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=repair-return&case=${id}`}>Plan Repair</Link>
              </div>
              {/* 0761 — Houzs ServiceCases.tsx:4139: the resolution method, from Service Settings. */}
              <div className="max-w-xs">
                <Select id="case-resolution-method" label="Resolution Method" value={d.resolutionMethodId ?? undefined} onValueChange={(v) => saveSelect({ resolutionMethodId: v })} placeholder="Resolution Method"
                  options={(configQ.data?.resolutionMethods ?? []).map((m) => ({ value: m.id, label: m.label }))} />
              </div>
              {/* Houzs ServiceCases.tsx:4150-4190: the route chip and its one line under the method. */}
              <RouteLine route={caseResolutionRoute(d.resolutionMethodCode)} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InlineField id="scm-action" label="Resolution" textarea value={d.carresAction} onSave={(v) => save({ carresAction: v })} />
                <InlineField id="scm-affected" label="What was affected" textarea value={d.whatAffected} onSave={(v) => save({ whatAffected: v })} />
                <InlineField id="scm-charges" label="Incurred charges" textarea value={d.incurredCharges} onSave={(v) => save({ incurredCharges: v })} />
              </div>
            </Panel>

            {/* 0763 — Houzs ServiceCases.tsx:7253 Cost tracking. Records only: nothing posts to the ledger. */}
            <Panel title="Cost">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <InlineField id="scm-customer-amount" label="Customer Amount (RM)" type="number" value={d.customerAmount?.toString()} onSave={(v) => save({ customerAmount: v ? Number(v) : null })} />
                <InlineField id="scm-supplier-cost" label="Supplier Cost (RM)" type="number" value={d.supplierCostAmount?.toString()} onSave={(v) => save({ supplierCostAmount: v ? Number(v) : null })} />
                <InlineField id="scm-supplier-invoice" label="Supplier Invoice Ref" mono value={d.supplierInvoiceRef} onSave={(v) => save({ supplierInvoiceRef: v || null })} />
              </div>
              {d.customerAmount != null && d.supplierCostAmount != null && <MarginLine margin={d.customerAmount - d.supplierCostAmount} />}
              <CaseCostSuggestion caseId={id} onApply={save} />
            </Panel>

            <CaseRemedyApproval caseId={id} onDirtyChange={setRemedyDirty} onBusyChange={setRemedyBusy} />
          </div>

          <div className="min-w-0 space-y-3">
            <Panel title="Customer">
              <InlineField id="scm-name" label="Customer Name *" required value={d.customerName} onSave={(v) => save({ customerName: v })} />
              <InlineField id="scm-phone" label="Phone" value={d.customerPhone} onSave={(v) => save({ customerPhone: v })} />
              <InlineField id="scm-address" label="Address" value={d.customerAddress} onSave={(v) => save({ customerAddress: v })} />
              <InlineField id="scm-ref" label="Ref No." mono value={d.refNo} onSave={(v) => save({ refNo: v })} />
              <Field label="SO No"><CaseOrderLink orderId={d.orderId} so={d.so} /></Field>
              <dl><InfoRow label="Salesperson" value={d.salespersonName ?? null} /></dl>
            </Panel>

            <Panel title="Assigned to">
              {/* 0711 — the Sales Order PIC picks the admin who owns the case. */}
              <Select id="case-owner" label="Assigned To" hint={d.ownerPickable ? undefined : "The sales order PIC picks the case owner"} disabled={!d.ownerPickable}
                value={d.ownerUserId ?? undefined} onValueChange={(v) => saveSelect({ ownerUserId: v })} placeholder="No owner yet"
                options={(staff ?? []).map((p) => ({ value: p.user_id, label: p.name ?? "" }))} />
            </Panel>

            {/* S4 — the one thing here with a date the customer is waiting on. */}
            <CaseDeadline caseId={id} openedAt={d.openedAt ?? null} slaHours={d.slaHours ?? null} closed={d.statusIsClosed} customerName={d.customerName} events={d.slaEvents ?? []} />

            <Panel title={history.length ? `Customer History (${history.length})` : "Customer History"}>
              {history.length === 0 && <p className="text-meta text-base-500">No prior cases for this customer.</p>}
              {history.map((h) => (
                <Link key={h.id} to={`/operation?tab=service-notes&case=${h.id}`} className="block rounded border border-base-200 px-3 py-2 text-meta hover:bg-base-50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-base-900">{h.caseNo}</span>
                    <span className="text-base-500">{h.statusLabel ?? "Unset"}</span>
                  </span>
                  <span className="mt-1 block text-base-600">{fmtDate(h.openedAt)}{h.whatHappened ? ` · ${h.whatHappened}` : ""}</span>
                </Link>
              ))}
            </Panel>

            <Panel title="Timeline">
              <ol className="space-y-2">
                {timeline.map((t, i) => (
                  <li key={i} className="border-l-2 border-base-200 pl-3 text-meta">
                    <span className="block text-base-900">{t.text}</span>
                    <span className="block text-base-500">{fmtDate(t.on)}{t.who ? ` · ${t.who}` : ""}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
      <ConfirmActionDialog open={discardOpen} title="Discard changes?"
        message="What you typed in the remedy form has not been saved."
        confirmLabel="Discard" cancelLabel="Keep editing"
        onConfirm={() => { setDiscardOpen(false); onBack(); }} onCancel={() => setDiscardOpen(false)} />
    </>
  );
}

/** Other cases of the same customer: phone when the case has one, else exact name
 *  (Houzs CustomerHistory, ServiceCases.tsx:7465). */
export function customerHistory(c: ServiceCase, all: readonly ServiceCase[]): ServiceCase[] {
  const phone = c.customerPhone?.trim();
  return all.filter((o) => o.id !== c.id && (phone ? o.customerPhone?.trim() === phone : o.customerName === c.customerName));
}

/** What the case already records, newest first. Stage moves come from the 0745
 *  stage history (Houzs assr_activity stage_change rows); Carres keeps no notes. */
export function caseTimeline(
  c: ServiceCase,
  nameOf: (userId: string) => string,
  stageLabelOf: (statusId: string) => string = () => "",
): { on: string; text: string; who: string }[] {
  const steps = new Map(
    caseFollowUpPlan({ customerWants: c.customerWants ?? [], customerName: c.customerName, supplierName: c.supplierName ?? null }).map((s) => [s.key as string, s.label]),
  );
  const rows = [
    { on: c.openedAt, text: "Case opened", who: c.createdBy ? nameOf(c.createdBy) : "" },
    ...(c.evidence ?? []).map((e) => ({ on: e.at, text: e.kind === "video" ? "Video added" : "Photo added", who: nameOf(e.by) })),
    ...(c.progress ?? []).map((p) => ({ on: p.on, text: `${steps.get(p.step) ?? p.step}${p.note ? `: ${p.note}` : ""}`, who: nameOf(p.by) })),
    ...(c.slaEvents ?? []).map((s) => ({ on: s.on, text: `Customer told: ${caseDelayReasonLabel(s.reason)}`, who: "" })),
    // The row written when the case was filed repeats "Case opened", so it is left out.
    ...(c.stageHistory ?? []).filter((h) => h.enteredAt !== c.createdAt).map((h) => ({
      on: h.enteredAt,
      text: `Moved to ${(h.statusId && stageLabelOf(h.statusId)) || "another stage"}`,
      who: h.changedBy ? nameOf(h.changedBy) : "",
    })),
  ];
  return rows.sort((a, z) => z.on.localeCompare(a.on));
}

// shortcut: a leg select cannot be cleared once set (the kit Select has no blank option); add one if staff need it.
function legOptions(keys: readonly string[]) {
  return keys.map((k) => ({ value: k, label: caseLegLabel(k) }));
}

/** Houzs LogisticsConfirmedNote. */
function LegNote({ requested, confirmed }: { requested: string | null | undefined; confirmed: string | null | undefined }) {
  return <p className={`text-meta ${confirmed ? "font-semibold text-kit-blue-11" : "text-base-600"}`}>{logisticsConfirmedText(requested, confirmed, (iso) => fmtDate(iso))}</p>;
}

/** One field that saves itself when you leave it (Houzs InlineEdit). */
function InlineField({ id, label, value, onSave, textarea, type = "text", required, mono }: {
  id: string; label: string; value: string | null | undefined; onSave: (value: string) => Promise<void>;
  textarea?: boolean; type?: "text" | "date" | "number"; required?: boolean; mono?: boolean;
}) {
  const saved = value ?? "";
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setDraft(saved), [saved]);
  const commit = async () => {
    const next = draft.trim();
    if (next === saved) { setProblem(null); return; }
    if (required && !next) { setProblem(`${label.replace(" *", "")} cannot be empty.`); return; }
    setStatus("saving");
    setProblem(null);
    try {
      await onSave(next);
      setStatus("saved");
    } catch (e) {
      setStatus("idle");
      setProblem((e as Error).message);
    }
  };
  const look = `w-full rounded border px-2.5 py-1.5 text-body ${problem ? "border-error-700" : "border-base-300"} ${mono ? "font-mono" : ""}`;
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-meta text-base-500 uppercase tracking-wider">{label}</label>
        <span role="status" className="text-meta text-base-500">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}</span>
      </div>
      <div className="mt-1">
        {textarea
          ? <textarea id={id} rows={3} value={draft} onChange={(e) => { setDraft(e.target.value); setStatus("idle"); }} onBlur={() => void commit()} className={look} />
          : <input id={id} type={type} value={draft} onChange={(e) => { setDraft(e.target.value); setStatus("idle"); }} onBlur={() => void commit()} className={look} />}
      </div>
      {problem && <p role="alert" className="mt-1 text-meta text-error-700 break-words">{problem}</p>}
    </div>
  );
}

/** Houzs shows the margin in red when negative; no minus sign on screen, so a loss says Loss. */
function MarginLine({ margin }: { margin: number }) {
  return (
    <p className="flex items-baseline justify-between text-body">
      <span className="text-meta text-base-500 uppercase tracking-wider">Gross margin</span>
      <span className={`font-mono tabular-nums ${margin < 0 ? "text-error-700" : "text-base-900"}`}>{margin < 0 ? `Loss ${fmtMoney(-margin)}` : fmtMoney(margin)}</span>
    </p>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded border border-base-200 bg-white p-3">
      <h2 className="text-body font-semibold text-base-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      {htmlFor
        ? <label htmlFor={htmlFor} className="text-meta text-base-500 uppercase tracking-wider">{label}</label>
        : <span className="text-meta text-base-500 uppercase tracking-wider">{label}</span>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-meta w-28 shrink-0 pt-0.5 text-base-500">{label}</dt>
      <dd className="text-body text-base-800">{value || ""}</dd>
    </div>
  );
}

function reporterLabel(key: string | null | undefined): string {
  if (!key) return "";
  return CASE_REPORTERS.find((r) => r.key === key)?.label ?? key;
}

/** The list's codes in use, plus the case's own code when it was taken out of use. */
function lookupOptions(items: Array<{ code: string; label: string }> | undefined, current: string | null | undefined, currentLabel: string | null | undefined) {
  const opts = (items ?? []).map((m) => ({ value: m.code, label: m.label }));
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: currentLabel ?? current });
  return opts;
}

function RouteLine({ route }: { route: "supplier" | "internal" | null }) {
  const [chip, line] =
    route === "supplier" ? ["Supplier", "Supplier flow: assign a supplier."]
    : route === "internal" ? ["Internal", "Internal handling: own team, no supplier needed."]
    : ["No route yet", "Pick a method. It decides the supplier or internal path."];
  return (
    <p className="flex flex-wrap items-center gap-2 text-meta text-kit-slate-11" data-testid="case-route">
      <span className="pill pill-neutral">{chip}</span>
      {line}
    </p>
  );
}
