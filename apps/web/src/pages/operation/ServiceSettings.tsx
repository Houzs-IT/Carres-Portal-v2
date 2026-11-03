// design-standard: not-a-list-page — this is a central Settings editor, not a Register.
/**
 * Settings → Service (migration 0711). Weisiang's decision (Mr Lim, WhatsApp
 * 2026-10-22): Houzs Service Maintenance inside Carres — the default case
 * owner (used until the Sales Order PIC picks one) and the Case Type and Stage
 * pick lists staff choose from on a case. Everyone in the office reads; the
 * owner or a person named for Service in Settings editors changes it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServicePickList } from "@carres/shared";
import { apiFetch } from "@/lib/api";
import { useCanEditSettings } from "@/lib/settings-queries";
import Button from "@/components/kit/Button";
import Checkbox from "@/components/kit/Checkbox";
import Input from "@/components/kit/Input";
import PageShell from "@/components/kit/PageShell";
import Select from "@/components/kit/Select";
import { W } from "./settings-core/parts";
import ServiceLeadTime from "./ServiceLeadTime";

type PickItem = { id: string; label: string; active: boolean; isClosed: boolean; targetDays?: number | null; slaHours?: number | null; statusId?: string | null };
type ServiceSettingsRead = { defaultOwnerUserId: string | null; types: PickItem[]; statuses: PickItem[]; subStatuses?: PickItem[]; resolutionMethods?: PickItem[];
  issueCategories?: PickItem[]; productCategories?: PickItem[]; priorities?: PickItem[]; rootCauses?: PickItem[] };
const KEY = ["ops", "service-cases", "settings"] as const;

export default function ServiceSettings() {
  useEffect(() => { document.title = "Service Maintenance · Carres"; return () => { document.title = "Carres Portal"; }; }, []);
  const qc = useQueryClient();
  const canEdit = useCanEditSettings("service");
  const q = useQuery<ServiceSettingsRead>({ queryKey: KEY, queryFn: () => apiFetch("/api/ops/service-cases/settings") });
  const staffQ = useQuery<{ staff?: Array<{ user_id: string; name: string | null }> }>({
    queryKey: ["operation", "staff"],
    queryFn: () => apiFetch("/api/operation/staff"),
    staleTime: 60_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["ops", "service-cases", "config"] });
  };
  const owner = useMutation({
    mutationFn: (defaultOwnerUserId: string) =>
      apiFetch("/api/ops/service-cases/settings", { method: "PATCH", body: JSON.stringify({ defaultOwnerUserId }) }),
    onSuccess: refresh,
  });
  const staff = staffQ.data?.staff ?? [];

  return (
    <PageShell variant="settings" title="Service Settings">
      <div className="mx-auto grid w-full max-w-4xl gap-5 overflow-auto rounded-card border border-kit-slate-5 bg-white p-5">
        {q.isError && <p role="alert" className="text-body">{W.loadFailed}</p>}
        {!canEdit && <p className="text-meta text-kit-slate-11">{W.readOnly}</p>}
        <section className="grid gap-2">
          <h2 className="text-strong">Default case owner</h2>
          <p className="text-body text-kit-slate-11">A new case goes to this person until the sales order PIC picks the case owner.</p>
          <div className="max-w-sm">
            <Select
              id="service-default-owner"
              disabled={!canEdit}
              value={q.data?.defaultOwnerUserId ?? undefined}
              onValueChange={(v) => owner.mutate(v)}
              placeholder={W.notSet}
              options={staff.map((p) => ({ value: p.user_id, label: p.name ?? "" }))}
            />
          </div>
        </section>
        <PickList list="statuses" title="Stages" help="The stages staff pick on a case. A stage that closes the case cannot be added here. Target days per stage are set under Lead Time." items={q.data?.statuses ?? []} canEdit={canEdit} onChanged={refresh} />
        {/* 0766 — Houzs ServiceLeadTimePortal.tsx: stage target days live in Lead Time profiles. */}
        <ServiceLeadTime stages={q.data?.statuses ?? []} canEdit={canEdit} />
        {/* 0760 — Houzs assr-sub-statuses.ts: sub-statuses inside a stage, one list per open stage. */}
        {(q.data?.statuses ?? []).filter((st) => st.active && !st.isClosed).map((st) => (
          <PickList key={st.id} list="subStatuses" statusId={st.id} title={`Sub-statuses in ${st.label}`}
            help="A case entering this stage starts on the first sub-status in use; staff switch it on the case."
            items={(q.data?.subStatuses ?? []).filter((ss) => ss.statusId === st.id)} canEdit={canEdit} onChanged={refresh} />
        ))}
        <PickList list="types" title="Case types" help="The case types staff pick on a case." items={q.data?.types ?? []} canEdit={canEdit} onChanged={refresh} />
        {/* 0761 — Houzs 065_assr_lookups.sql resolution methods. */}
        <PickList list="resolutionMethods" title="Resolution methods" help="How a case is resolved. Staff pick one on the case." items={q.data?.resolutionMethods ?? []} canEdit={canEdit} onChanged={refresh} />
        {/* 0764 — Houzs ServiceSettings.tsx:90-111 lookup lists. */}
        <PickList list="priorities" title="Priorities" help="The priorities staff pick on a case. SLA hours: the case deadline counts from the case date. Blank: 14 working days." items={q.data?.priorities ?? []} canEdit={canEdit} onChanged={refresh} />
        <PickList list="issueCategories" title="Issue categories" help="The issue categories staff pick on a case." items={q.data?.issueCategories ?? []} canEdit={canEdit} onChanged={refresh} />
        <PickList list="productCategories" title="Product categories" help="The product categories staff pick on a case." items={q.data?.productCategories ?? []} canEdit={canEdit} onChanged={refresh} />
        <PickList list="rootCauses" title="Root causes" help="Why the problem happened. Staff pick one on the case." items={q.data?.rootCauses ?? []} canEdit={canEdit} onChanged={refresh} />
      </div>
    </PageShell>
  );
}

function PickList({ list, statusId, title, help, items, canEdit, onChanged }: {
  list: ServicePickList;
  statusId?: string;
  title: string;
  help: string;
  items: PickItem[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const add = useMutation({
    mutationFn: () => apiFetch(`/api/ops/service-cases/settings/${list}`, { method: "POST", body: JSON.stringify({ label, statusId }) }),
    onSuccess: () => { setLabel(""); onChanged(); },
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { label?: string; active?: boolean; slaHours?: number | null } }) =>
      apiFetch(`/api/ops/service-cases/settings/${list}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: onChanged,
  });
  // YH (chat, 2026-10-26): Close Case needs a closing stage, so the last one in
  // use stays in use (0711 §6 refuses it in the database too).
  const closingInUse = items.filter((i) => i.isClosed && i.active).length;
  const key = statusId ? `${list}-${statusId}` : list;
  return (
    <section className="grid gap-2" data-testid={`service-pick-${key}`}>
      <h2 className="text-strong">{title}</h2>
      <p className="text-body text-kit-slate-11">{help}</p>
      {edit.isError && <p role="alert" className="text-body">{edit.error.message}</p>}
      <ul className="grid gap-2">
        {items.map((it) => {
          const locked = it.isClosed && it.active && closingInUse === 1;
          return (
            <li key={it.id} className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  id={`service-${list}-${it.id}`}
                  aria-label={title}
                  defaultValue={it.label}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== it.label) edit.mutate({ id: it.id, body: { label: next } });
                  }}
                />
              </div>
              {/* 0764 — Houzs assr_priorities.sla_hours: the case deadline. */}
              {list === "priorities" && (
                <div className="w-28">
                  <Input
                    id={`service-${list}-${it.id}-sla`}
                    aria-label={`SLA hours for ${it.label}`}
                    placeholder="SLA hours"
                    type="number"
                    min={1}
                    max={8760}
                    step={1}
                    defaultValue={it.slaHours ?? ""}
                    disabled={!canEdit}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === "" ? null : Number(raw);
                      if (next !== null && !(Number.isInteger(next) && next > 0 && next <= 8760)) return;
                      if (next !== (it.slaHours ?? null)) edit.mutate({ id: it.id, body: { slaHours: next } });
                    }}
                  />
                </div>
              )}
              <Checkbox
                id={`service-${list}-${it.id}-active`}
                label="In use"
                checked={it.active}
                disabled={!canEdit || locked}
                onCheckedChange={(active) => edit.mutate({ id: it.id, body: { active } })}
              />
              {locked && <span className="text-meta text-kit-slate-11">Close Case needs this stage.</span>}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input id={`service-${key}-new`} label={list === "subStatuses" ? "New sub-status" : `New ${title.toLowerCase().replace(/ies$/, "y").replace(/s$/, "")}`} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button variant="primary" disabled={!label.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
    </section>
  );
}
