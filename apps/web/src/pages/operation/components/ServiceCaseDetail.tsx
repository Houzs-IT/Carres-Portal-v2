import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import {
  CASE_REPORTERS,
  caseDelayReasonLabel,
  caseFollowUpPlan,
  caseIssueLabel,
  caseNeedsManager,
  caseProductCategoryLabel,
  caseUsableLabel,
  caseWantLabel,
  type ServiceCase,
  type ServiceCaseConfig,
  type ServiceCaseListResponse,
} from "@carres/shared";
import { ArrowLeft } from "lucide-react";
import CaseOrderLink from "./CaseOrderLink";
import CaseEvidenceGallery from "./CaseEvidenceGallery";
import CaseFollowUps from "./CaseFollowUps";
import CaseDeadline from "./CaseDeadline";
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

  // ── form state ──────────────────────────────────────────────────────────────
  const [refNo, setRefNo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [caseTypeId, setCaseTypeId] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [carresAction, setCarresAction] = useState("");
  const [whatAffected, setWhatAffected] = useState("");
  const [incurredCharges, setIncurredCharges] = useState("");
  const [openedAt, setOpenedAt] = useState(appTodayIso());
  // 0711 — Weisiang's decision (Mr Lim, WhatsApp 2026-10-22), Houzs way: the
  // Sales Order PIC picks the case owner; staff set the priority by hand.
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);

  const d = existingQ.data;
  useEffect(() => {
    if (!d) return;
    setRefNo(d.refNo ?? "");
    setCustomerName(d.customerName ?? "");
    setCustomerPhone(d.customerPhone ?? "");
    setCustomerAddress(d.customerAddress ?? "");
    setCaseTypeId(d.caseTypeId ?? "");
    setWhatHappened(d.whatHappened ?? "");
    setCarresAction(d.carresAction ?? "");
    setWhatAffected(d.whatAffected ?? "");
    setIncurredCharges(d.incurredCharges ?? "");
    setOpenedAt(d.openedAt ?? appTodayIso());
    setOwnerUserId(d.ownerUserId ?? null);
    setPriority(d.priority ?? null);
  }, [d]);

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ops/service-cases/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          refNo: refNo.trim() || undefined,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          customerAddress: customerAddress.trim() || undefined,
          caseTypeId: caseTypeId || null,
          whatHappened: whatHappened.trim() || undefined,
          carresAction: carresAction.trim() || undefined,
          whatAffected: whatAffected.trim() || undefined,
          incurredCharges: incurredCharges.trim() || undefined,
          openedAt,
          // 0711 — sent only when changed, so a save by someone who is not the
          // PIC never trips the owner check over a field they did not touch.
          ...(ownerUserId !== (d?.ownerUserId ?? null) ? { ownerUserId } : {}),
          ...(priority !== (d?.priority ?? null) ? { priority } : {}),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "service-cases"] }),
  });

  // 0711 — staff move a case to any stage by hand, and Close Case sits on every
  // open case (Houzs ServiceCases.tsx), Weisiang's decision 2026-10-22.
  const stageMut = useMutation({
    mutationFn: (statusId: string) =>
      apiFetch(`/api/ops/service-cases/${id}`, { method: "PATCH", body: JSON.stringify({ statusId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "service-cases"] }),
  });

  const formDirty = !!d && (
    refNo !== (d.refNo ?? "") || customerName !== (d.customerName ?? "") || customerPhone !== (d.customerPhone ?? "") ||
    customerAddress !== (d.customerAddress ?? "") || caseTypeId !== (d.caseTypeId ?? "") ||
    whatHappened !== (d.whatHappened ?? "") || carresAction !== (d.carresAction ?? "") || whatAffected !== (d.whatAffected ?? "") ||
    incurredCharges !== (d.incurredCharges ?? "") || openedAt !== (d.openedAt ?? appTodayIso()) ||
    ownerUserId !== (d.ownerUserId ?? null) || priority !== (d.priority ?? null));

  const requestBack = () => {
    if (remedyBusy || saveMut.isPending) return;
    if (formDirty || remedyDirty) setDiscardOpen(true); else onBack();
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
  const stageBusy = stageMut.isPending || remedyBusy || formDirty;
  const canSave = customerName.trim().length > 0 && !saveMut.isPending && !remedyBusy;
  const history = customerHistory(d, listQ.data?.items ?? []);
  const timeline = caseTimeline(d, (u) => nameOf.get(u) ?? "");

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
            <Button variant="primary" onClick={() => saveMut.mutate()} disabled={!canSave} loading={saveMut.isPending}>Save</Button>
          </div>
        </div>

        {saveMut.isError && <p role="alert" className="text-meta text-error-700 break-words">Save failed: {(saveMut.error as Error)?.message ?? "unknown error"}</p>}
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
          {formDirty && <p className="mt-2 text-meta text-base-500">Save your changes before moving the stage.</p>}
        </section>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.62fr_1fr]">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Panel title="Issue">
                <Field label="Complaint" htmlFor="scm-happened">
                  <textarea id="scm-happened" value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} rows={3} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
                </Field>
                <Field label="Case Type" htmlFor="scm-type">
                  <select id="scm-type" value={caseTypeId} onChange={(e) => setCaseTypeId(e.target.value)} className="w-full rounded border border-base-300 bg-white px-2 py-1.5 text-body">
                    <option value="">Case Type</option>
                    {configQ.data?.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                <Select id="case-priority" label="Priority" value={priority ?? undefined} onValueChange={setPriority} placeholder="Priority"
                  options={[{ value: "high", label: "Urgent" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }]} />
                {d.priority && caseNeedsManager(d.priority) && <p className="text-meta text-base-600">tell manager</p>}
                <Field label="Date" htmlFor="scm-opened">
                  <input id="scm-opened" type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className="w-full rounded border border-base-300 px-2 py-1.5 text-body" />
                </Field>
              </Panel>
              <Panel title="Product Info">
                {/* S1 — the guided intake's answers are asked once and only read here. */}
                <dl className="space-y-1.5">
                  <InfoRow label="Product" value={[d.productCategory ? caseProductCategoryLabel(d.productCategory) : null, d.productSku].filter(Boolean).join(" · ")} />
                  <InfoRow label="Issue Category" value={d.issueType ? caseIssueLabel(d.issueType) : null} />
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

            <Panel title="Resolution">
              <div className="flex flex-wrap gap-4 text-body">
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=customer-return&case=${id}`}>Plan Customer Return</Link>
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=failed-delivery-return&case=${id}`}>Plan Failed Delivery return</Link>
                <Link className="text-kit-blue-11" to={`/operation?tab=arrival-source&kind=repair-return&case=${id}`}>Plan Repair</Link>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Resolution" htmlFor="scm-action">
                  <textarea id="scm-action" value={carresAction} onChange={(e) => setCarresAction(e.target.value)} rows={3} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
                </Field>
                <Field label="What was affected" htmlFor="scm-affected">
                  <textarea id="scm-affected" value={whatAffected} onChange={(e) => setWhatAffected(e.target.value)} rows={3} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
                </Field>
                <Field label="Incurred charges" htmlFor="scm-charges">
                  <textarea id="scm-charges" value={incurredCharges} onChange={(e) => setIncurredCharges(e.target.value)} rows={2} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
                </Field>
              </div>
            </Panel>

            <CaseRemedyApproval caseId={id} onDirtyChange={setRemedyDirty} onBusyChange={setRemedyBusy} disabled={formDirty} />
          </div>

          <div className="min-w-0 space-y-3">
            <Panel title="Customer">
              <Field label="Customer Name *" htmlFor="scm-name">
                <input id="scm-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
              </Field>
              <Field label="Phone" htmlFor="scm-phone">
                <input id="scm-phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
              </Field>
              <Field label="Address" htmlFor="scm-address">
                <input id="scm-address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} className="w-full rounded border border-base-300 px-2.5 py-1.5 text-body" />
              </Field>
              <Field label="Ref No." htmlFor="scm-ref">
                <input id="scm-ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} className="w-full rounded border border-base-300 px-2.5 py-1.5 font-mono text-body" />
              </Field>
              <Field label="SO No"><CaseOrderLink orderId={d.orderId} so={d.so} /></Field>
              <dl><InfoRow label="Salesperson" value={d.salespersonName ?? null} /></dl>
            </Panel>

            <Panel title="Assigned to">
              {/* 0711 — the Sales Order PIC picks the admin who owns the case. */}
              <Select id="case-owner" label="Assigned To" hint={d.ownerPickable ? undefined : "The sales order PIC picks the case owner"} disabled={!d.ownerPickable}
                value={ownerUserId ?? undefined} onValueChange={setOwnerUserId} placeholder="No owner yet"
                options={(staff ?? []).map((p) => ({ value: p.user_id, label: p.name ?? "" }))} />
            </Panel>

            {/* S4 — the one thing here with a date the customer is waiting on. */}
            <CaseDeadline caseId={id} openedAt={d.openedAt ?? null} closed={d.statusIsClosed} customerName={d.customerName} events={d.slaEvents ?? []} />

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
        message="What you changed on this case has not been saved."
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

/** What the case already records, newest first. Carres keeps no stage-change
 *  history or notes on a case, so those Houzs Timeline rows cannot appear. */
export function caseTimeline(c: ServiceCase, nameOf: (userId: string) => string): { on: string; text: string; who: string }[] {
  const steps = new Map(
    caseFollowUpPlan({ customerWants: c.customerWants ?? [], customerName: c.customerName, supplierName: c.supplierName ?? null }).map((s) => [s.key as string, s.label]),
  );
  const rows = [
    { on: c.openedAt, text: "Case opened", who: c.createdBy ? nameOf(c.createdBy) : "" },
    ...(c.evidence ?? []).map((e) => ({ on: e.at, text: e.kind === "video" ? "Video added" : "Photo added", who: nameOf(e.by) })),
    ...(c.progress ?? []).map((p) => ({ on: p.on, text: `${steps.get(p.step) ?? p.step}${p.note ? `: ${p.note}` : ""}`, who: nameOf(p.by) })),
    ...(c.slaEvents ?? []).map((s) => ({ on: s.on, text: `Customer told: ${caseDelayReasonLabel(s.reason)}`, who: "" })),
  ];
  return rows.sort((a, z) => z.on.localeCompare(a.on));
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
