import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeadTimeRead } from "@carres/shared";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import Button from "@/components/kit/Button";
import Input from "@/components/kit/Input";
import Select from "@/components/kit/Select";

const KEY = ["ops", "service-cases", "lead-time"] as const;
type Stage = { id: string; label: string; active: boolean; isClosed: boolean };

/** 0766 — Houzs frontend/src/pages/ServiceLeadTimePortal.tsx: profiles of stage target days, one in
 *  use; a target change needs a reason and shows in the history. */
export default function ServiceLeadTime({ stages, canEdit }: { stages: Stage[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery<LeadTimeRead>({ queryKey: KEY, queryFn: () => apiFetch("/api/ops/service-cases/settings/lead-time") });
  const profiles = q.data?.profiles ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const profile = profiles.find((p) => p.id === picked) ?? profiles.find((p) => p.isActive) ?? profiles[0];
  const [newName, setNewName] = useState("");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["ops", "service-cases"] });
  };
  const create = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/api/ops/service-cases/settings/lead-time/profiles", { method: "POST", body: JSON.stringify({ name: newName }) }),
    onSuccess: (r) => { setNewName(""); setPicked(r.id); refresh(); },
  });
  const activate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ops/service-cases/settings/lead-time/profiles/${id}/activate`, { method: "POST" }),
    onSuccess: refresh,
  });
  const openStages = stages.filter((s) => s.active && !s.isClosed);
  const stageLabel = (id: string) => stages.find((s) => s.id === id)?.label ?? "Stage removed";
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? "";
  const failed = create.error ?? activate.error;

  return (
    <section className="grid gap-2" data-testid="service-lead-time">
      <h2 className="text-strong">Lead Time</h2>
      <p className="text-body text-kit-slate-11">
        Target days per stage. One profile is in use: a case entering a stage takes that profile&apos;s target, and a case past it shows red. A change needs a reason and also counts for open cases already in that stage.
      </p>
      {q.isError && <p role="alert" className="text-body">{(q.error as Error).message}</p>}
      {failed && <p role="alert" className="text-body">{failed.message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select id="service-lead-time-profile" label="Profile" value={profile?.id} onValueChange={setPicked} placeholder="Profile"
            options={profiles.map((p) => ({ value: p.id, label: p.isActive ? `${p.name} (in use)` : p.name }))} />
        </div>
        {profile && !profile.isActive && (
          <Button variant="neutral" size="sm" disabled={!canEdit} loading={activate.isPending} onClick={() => activate.mutate(profile.id)}>Use this profile</Button>
        )}
      </div>
      {profile?.description && <p className="text-meta text-kit-slate-11">{profile.description}</p>}
      {profile && (
        <ul className="grid gap-2">
          {openStages.map((s) => (
            <TargetRow key={`${profile.id}-${s.id}`} profileId={profile.id} stage={s} days={profile.targets[s.id] ?? null} canEdit={canEdit} onSaved={refresh} />
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Input id="service-lead-time-new" aria-label="New profile" placeholder="New profile, starts as a copy of the one in use" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Button size="sm" disabled={!newName.trim()} loading={create.isPending} onClick={() => create.mutate()}>Add profile</Button>
        </div>
      )}
      {(q.data?.amendments ?? []).length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-body font-semibold">Changes</h3>
          <ul className="grid gap-1">
            {q.data!.amendments.map((a) => (
              <li key={a.id} className="text-meta text-kit-slate-11">
                {fmtDate(a.createdAt)} · {profileName(a.profileId)} · {stageLabel(a.statusId)}: {a.beforeDays ?? "no target"} to {a.afterDays} days · {a.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TargetRow({ profileId, stage, days, canEdit, onSaved }: { profileId: string; stage: Stage; days: number | null; canEdit: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(days == null ? "" : String(days));
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => apiFetch("/api/ops/service-cases/settings/lead-time/targets", {
      method: "PATCH",
      body: JSON.stringify({ profileId, statusId: stage.id, targetDays: Number(value), reason }),
    }),
    onSuccess: () => { setReason(""); onSaved(); },
  });
  const n = Number(value);
  const changed = value.trim() !== "" && n > 0 && n <= 365 && n !== days;
  return (
    <li className="grid gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-48 text-body">{stage.label}</span>
        <div className="w-28">
          <Input id={`service-lead-time-${stage.id}`} aria-label={`Target days for ${stage.label}`} placeholder="Target days" type="number"
            min={0.5} max={365} step={0.5} value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} />
        </div>
        {changed && (
          <>
            <div className="min-w-48 flex-1">
              <Input id={`service-lead-time-${stage.id}-reason`} aria-label={`Reason for ${stage.label}`} placeholder="Reason, at least 10 characters"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button size="sm" disabled={reason.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </>
        )}
      </div>
      {save.isError && <p role="alert" className="text-meta text-error-700">{save.error.message}</p>}
    </li>
  );
}
