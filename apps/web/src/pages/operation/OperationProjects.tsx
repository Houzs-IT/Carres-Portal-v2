import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CHECKLIST_STATUSES, checklistDueDate, checklistProgress, PROJECT_EVENT_TYPES, PROJECT_MASTER_KINDS, PROJECT_STAGES, PROJECT_STATUSES, projectDurationDays,
  type ChecklistTask, type ProjectCreateInput, type ProjectMaster, type ProjectMasterKind, type ProjectRow, type ProjectStage, type ProjectStatus, type ProjectTeamMember,
} from "@carres/shared/projects";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import DatePicker from "@/components/kit/DatePicker";
import Drawer from "@/components/kit/Drawer";
import Input from "@/components/kit/Input";
import Panel from "@/components/kit/Panel";
import Select from "@/components/kit/Select";
import StatusPill from "@/components/kit/StatusPill";
import { Step } from "@/components/kit/StepList";
import Textarea from "@/components/kit/Textarea";
import { fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";
import ModuleHeader from "./components/ModuleHeader";
import CouldNotLoad from "./components/CouldNotLoad";
import { PJ, STATUS_TONE, refusalOf, useChecklistTemplates, useProject, useProjectMasters, useProjectSalesOrders, useProjectWrite, useProjects, useStaffOptions } from "./projects";

/**
 * Projects (0750): Project List, create and detail. Follows Houzs
 * frontend/src/pages/Projects.tsx (ProjectsListView :571, ProjectDetailContent
 * :1830, ProjectStageStepper :3469) per Weisiang's ruling (2026-10-22): clear
 * Carres rules, implement Houzs. Jess was not part of this decision.
 * `?tab=projects&project=<id>` opens one project; the list keeps its filters.
 */

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get("project");
  const open = (next: string | null) => {
    const p = new URLSearchParams(params);
    if (next) p.set("project", next); else p.delete("project");
    setParams(p);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="projects-page">
      <ModuleHeader destinationHeader testId="projects-destination-header" word={PJ.projectList} docTitle={`${PJ.projectList} · Carres`} />
      {id ? <ProjectDetail id={id} onBack={() => open(null)} /> : <ProjectList onOpen={open} />}
    </div>
  );
}

/* ── Project List (Houzs Table view) ─────────────────────────────────────── */

function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const q = useProjects({ status, archived });
  if (q.isError) return <CouldNotLoad detail={PJ.failed} onRetry={() => void q.refetch()} />;

  const columns: DataGridColumn<ProjectRow>[] = [
    { key: "start", label: PJ.start, width: 110, accessor: (r) => fmtDate(r.startDate), dateValue: (r) => r.startDate, filterType: "date" },
    { key: "end", label: PJ.end, width: 110, accessor: (r) => fmtDate(r.endDate), dateValue: (r) => r.endDate, filterType: "date" },
    { key: "name", label: PJ.name, width: 320, accessor: (r) => r.name },
    { key: "status", label: PJ.status, width: 120, accessor: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{PJ.statuses[r.status]}</StatusPill>,
      exportValue: (r) => PJ.statuses[r.status], filterValue: (r) => PJ.statuses[r.status], filterType: "enum" },
    { key: "stage", label: PJ.stage, width: 110, accessor: (r) => PJ.stages[r.stage], filterType: "enum" },
    { key: "brand", label: PJ.brand, width: 120, accessor: (r) => r.brand, filterType: "enum" },
    { key: "venue", label: PJ.venue, width: 200, accessor: (r) => r.venue },
    { key: "state", label: PJ.state, width: 120, accessor: (r) => r.state, filterType: "enum" },
    { key: "organizer", label: PJ.organizer, width: 160, accessor: (r) => r.organizer ?? "" },
    { key: "pic", label: PJ.pic, width: 140, accessor: (r) => r.picName ?? "" },
    { key: "code", label: PJ.code, width: 260, accessor: (r) => r.code, defaultHidden: true },
  ];
  const toolbar = (
    <span className="flex items-center gap-2">
      <Select id="projects-archived" toolbar value={archived ? "archived" : "live"} onValueChange={(v) => setArchived(v === "archived")}
        options={[{ value: "live", label: PJ.live }, { value: "archived", label: PJ.archivedList }]} />
      <Select id="projects-status" toolbar value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}
        options={[{ value: "all", label: PJ.allStatuses }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: PJ.statuses[s] }))]} />
      <Button size="sm" variant="primary" onClick={() => setCreating(true)}>{PJ.newProject}</Button>
    </span>
  );
  return (
    <ListPageShell register>
      <DataGrid rows={q.data?.projects ?? []} columns={columns} rowKey={(r) => r.id} storageKey="carres.operation.projects.v1"
        appearance="reference" exportName={PJ.projectList} groupBanner={false} isLoading={!q.isSuccess}
        toolbarStart={toolbar} emptyMessage={PJ.noProjects} onRowClick={(r) => onOpen(r.id)} />
      {creating ? <ProjectForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); onOpen(id); }} /> : null}
    </ListPageShell>
  );
}

/* ── Create / edit form (Houzs CreateProjectPanel, MobileEditProjectSheet) ── */

type Draft = Omit<ProjectCreateInput, "sizeSqm" | "eventType"> & { sizeSqm: string; eventType: string };
const blank: Draft = {
  name: "", eventType: "exhibition", brand: "", state: "", venue: "", venueAddress: "", organizer: "", contractor: "",
  boothNo: "", sizeSqm: "", startDate: "", endDate: "", picId: "", notes: "",
};
const fromRow = (p: ProjectRow): Draft => ({
  name: p.name, eventType: p.eventType ?? "", brand: p.brand, state: p.state, venue: p.venue, venueAddress: p.venueAddress ?? "",
  organizer: p.organizer ?? "", contractor: p.contractor ?? "", boothNo: p.boothNo ?? "", sizeSqm: p.sizeSqm == null ? "" : String(p.sizeSqm),
  startDate: p.startDate, endDate: p.endDate, picId: p.picId ?? "", notes: p.notes ?? "",
});

function ProjectForm({ project, onClose, onSaved }: { project?: ProjectRow; onClose: () => void; onSaved: (id: string) => void }) {
  const [d, setD] = useState<Draft>(project ? fromRow(project) : blank);
  const [message, setMessage] = useState<string | null>(null);
  const write = useProjectWrite();
  const staff = useStaffOptions().data?.staff ?? [];
  const masters = useProjectMasters().data?.masters ?? [];
  const set = (k: keyof Draft) => (v: string | null) => setD((x) => ({ ...x, [k]: v ?? "" }));
  const text = (k: keyof Draft, label: string, extra: { hint?: string; required?: boolean; maxLength?: number } = {}) => (
    <Input id={`project-${k}`} label={label} value={String(d[k] ?? "")} onChange={(e) => set(k)(e.target.value)} {...extra} />
  );
  /** Houzs pickers: a Project Maintenance list once it has entries, typed text until then. */
  const pick = (k: ProjectMasterKind & keyof Draft, extra: { hint?: string; required?: boolean } = {}) => {
    const list = masters.filter((m) => m.kind === k && (m.active || m.name === d[k]));
    if (!list.length) return text(k, PJ.kindOne[k], { ...extra, maxLength: 120 });
    const onPick = (v: string) => {
      const m = list.find((x) => x.name === v);
      // Houzs: picking a venue fills its state and address when they are still empty.
      setD((x) => ({ ...x, [k]: v, ...(k === "venue" && m ? { state: x.state || m.state || "", venueAddress: x.venueAddress || m.address || "" } : {}) }));
    };
    return (
      <Select id={`project-${k}`} label={PJ.kindOne[k]} value={String(d[k] ?? "") || undefined} onValueChange={onPick}
        options={list.map((m) => ({ value: m.name, label: m.name }))} />
    );
  };
  const ready = d.brand.trim() && d.state.trim() && d.venue.trim() && d.startDate && d.endDate && d.endDate >= d.startDate;
  const save = () => {
    setMessage(null);
    const body = {
      name: d.name?.trim() || (project ? project.name : null), eventType: d.eventType || null, brand: d.brand, state: d.state, venue: d.venue,
      venueAddress: d.venueAddress || null, organizer: d.organizer || null, contractor: d.contractor || null, boothNo: d.boothNo || null,
      sizeSqm: d.sizeSqm ? Number(d.sizeSqm) : null, startDate: d.startDate, endDate: d.endDate, picId: d.picId || null, notes: d.notes || null,
    };
    write.mutate(
      project ? { path: `/${project.id}`, method: "PATCH", body } : { path: "", body },
      { onSuccess: (r) => onSaved(r.project?.id ?? project?.id ?? ""), onError: (e) => setMessage(refusalOf(e)) },
    );
  };
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={project ? PJ.editProject : PJ.newProject}
      footer={<span className="flex gap-2">
        <Button variant="primary" disabled={!ready} loading={write.isPending} onClick={save}>{PJ.save}</Button>
        <Button onClick={onClose}>{PJ.cancel}</Button>
      </span>}>
      <div className="flex flex-col gap-3" data-testid="project-form">
        {message ? <p role="alert" className="text-body">{message}</p> : null}
        <Select id="project-eventType" label={PJ.eventType} value={d.eventType || undefined} onValueChange={set("eventType")}
          options={[{ value: "exhibition", label: PJ.eventTypes.exhibition }, { value: "solo", label: PJ.eventTypes.solo }]} />
        {pick("brand", { required: true })}
        {pick("venue", { required: true })}
        {text("state", PJ.state, { required: true, maxLength: 60 })}
        {pick("organizer", { hint: PJ.organizerHint })}
        <DatePicker id="project-start" label={PJ.start} required value={d.startDate || null} onChange={set("startDate")} />
        <DatePicker id="project-end" label={PJ.end} required minDate={d.startDate || undefined} value={d.endDate || null} onChange={set("endDate")} />
        {text("name", PJ.name, { hint: project ? undefined : PJ.nameHint, maxLength: 200 })}
        <Select id="project-pic" label={PJ.pic} value={d.picId || "none"} onValueChange={(v) => set("picId")(v === "none" ? "" : v)}
          options={[{ value: "none", label: PJ.none }, ...staff.map((s) => ({ value: s.user_id, label: s.name ?? s.user_id }))]} />
        {text("venueAddress", PJ.venueAddress, { maxLength: 300 })}
        {pick("contractor")}
        {text("boothNo", PJ.boothNo, { maxLength: 40 })}
        <Input id="project-size" label={PJ.size} type="number" min={0} value={d.sizeSqm} onChange={(e) => set("sizeSqm")(e.target.value)} />
        <Textarea id="project-notes" label={PJ.notes} value={d.notes ?? ""} maxLength={2000} onChange={(e) => set("notes")(e.target.value)} />
      </div>
    </Drawer>
  );
}

/* ── Project detail (Houzs spec strip, stage stepper, status, activity) ──── */

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useProject(id);
  const write = useProjectWrite();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (q.isError) return <CouldNotLoad detail={(q.error as { status?: number })?.status === 404 ? PJ.notFound : PJ.failed} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const { project: p, activity, team, checklist } = q.data;
  const archived = !!p.archivedAt;
  const act: Act = (path, body, method = "POST", done) => {
    setMessage(null);
    // `/team/<id>` and `/checklist/<id>/...` are not under the project; every other door is.
    const own = path.startsWith("/team/") || (path.startsWith("/checklist/") && path !== "/checklist/apply");
    write.mutate({ path: own ? path : `/${p.id}${path}`, method, body }, { onSuccess: done, onError: (e) => setMessage(refusalOf(e)) });
  };
  const stageAt = PROJECT_STAGES.indexOf(p.stage);
  const facts: Array<[string, string]> = [
    [PJ.code, p.code],
    [PJ.eventType, p.eventType ? PJ.eventTypes[p.eventType] : ""],
    [PJ.brand, p.brand],
    [PJ.organizer, p.organizer ?? ""],
    [PJ.venue, [p.venue, p.state].join(", ")],
    [PJ.venueAddress, p.venueAddress ?? ""],
    [PJ.start, fmtDate(p.startDate)],
    [PJ.end, fmtDate(p.endDate)],
    [PJ.days, String(projectDurationDays(p.startDate, p.endDate))],
    [PJ.pic, p.picName ?? ""],
    [PJ.contractor, p.contractor ?? ""],
    [PJ.boothNo, p.boothNo ?? ""],
    [PJ.size, p.sizeSqm == null ? "" : String(p.sizeSqm)],
    [PJ.notes, p.notes ?? ""],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="project-detail">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onBack}>{PJ.back}</Button>
        <span className="text-strong text-c-ink">{p.name}</span>
        <StatusPill tone={STATUS_TONE[p.status]}>{PJ.statuses[p.status]}</StatusPill>
        <span className="ml-auto flex items-center gap-2">
          <Select id="project-status" toolbar disabled={archived} value={p.status}
            onValueChange={(v) => act("", { status: v as ProjectStatus }, "PATCH")}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: PJ.statuses[s] }))} />
          <PrintSheet projectId={p.id} data={q.data} onFail={setMessage} />
          <Button size="sm" onClick={() => setEditing(true)}>{PJ.editProject}</Button>
          <Button size="sm" loading={write.isPending} onClick={() => act(archived ? "/unarchive" : "/archive")}>{archived ? PJ.unarchive : PJ.archive}</Button>
        </span>
      </div>
      {archived ? <p className="text-body text-c-secondary">{PJ.archivedNote}</p> : null}
      {message ? <p role="alert" className="text-body">{message}</p> : null}

      <Panel title={PJ.stage}>
        <div className="flex flex-col" data-testid="project-stages">
          {PROJECT_STAGES.map((s: ProjectStage, i) => (
            <Step key={s} n={i + 1} title={PJ.stages[s]} state={i < stageAt ? "done" : i === stageAt ? "current" : "pending"}
              action={i !== stageAt ? <Button size="sm" onClick={() => act("", { stage: s }, "PATCH")}>{PJ.stages[s]}</Button> : undefined} />
          ))}
        </div>
      </Panel>

      <Panel title={PJ.details}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body md:grid-cols-2">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-c-secondary">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
          ))}
        </dl>
      </Panel>

      <SalesOrdersPanel projectId={p.id} act={act} busy={write.isPending} />

      <ChecklistPanel startDate={p.startDate} tasks={checklist} act={act} busy={write.isPending} />

      <TeamPanel team={team} act={act} busy={write.isPending} />

      <Panel title={PJ.activity}>
        <div className="flex flex-col gap-3">
          <span className="flex items-end gap-2">
            <span className="flex-1">
              <Textarea id="project-note" rows={2} placeholder={PJ.notePlaceholder} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </span>
            <Button size="sm" variant="primary" disabled={!note.trim()} loading={write.isPending}
              onClick={() => act("/notes", { note: note.trim() }, "POST", () => setNote(""))}>{PJ.addNote}</Button>
          </span>
          {activity.length ? (
            <ul className="flex flex-col gap-2 text-body" data-testid="project-activity">
              {activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="w-40 shrink-0 text-c-secondary">{fmtDate(a.createdAt, { time: true })}</span>
                  <span className="min-w-0 break-words">
                    {PJ.actions[a.action] ?? a.action}
                    {a.action === "stage_change" && a.toValue ? `: ${PJ.stages[a.toValue as ProjectStage] ?? a.toValue}` : ""}
                    {a.action === "status_change" && a.toValue ? `: ${PJ.statuses[a.toValue as ProjectStatus] ?? a.toValue}` : ""}
                    {a.note ? `: ${a.note}` : ""}
                    {a.byName ? <span className="text-c-secondary">{` · ${a.byName}`}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-body text-c-secondary">{PJ.noActivity}</p>}
        </div>
      </Panel>
      {editing ? <ProjectForm project={p} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
    </div>
  );
}

/* ── Team (Houzs project_team: a person and a free text role) ───────────── */

type Act = (path: string, body?: unknown, method?: "POST" | "PATCH" | "DELETE", done?: () => void) => void;

function TeamPanel({ team, act, busy }: { team: ProjectTeamMember[]; act: Act; busy: boolean }) {
  const staff = useStaffOptions().data?.staff ?? [];
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  return (
    <Panel title={PJ.team}>
      <div className="flex flex-col gap-3" data-testid="project-team">
        <span className="flex flex-wrap items-end gap-2">
          <Select id="project-team-user" label={PJ.pic} value={userId || undefined} onValueChange={setUserId}
            options={staff.map((s) => ({ value: s.user_id, label: s.name ?? s.user_id }))} />
          <Input id="project-team-role" label={PJ.role} placeholder={PJ.rolePlaceholder} maxLength={40} value={role} onChange={(e) => setRole(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!userId} loading={busy}
            onClick={() => act("/team", { userId, role: role.trim() || null }, "POST", () => { setUserId(""); setRole(""); })}>{PJ.addMember}</Button>
        </span>
        {team.length ? (
          <ul className="flex flex-col gap-2 text-body">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words">{m.name ?? ""}{m.role ? <span className="text-c-secondary">{` · ${m.role}`}</span> : null}</span>
                <Button size="sm" onClick={() => act(`/team/${m.id}`, undefined, "DELETE")}>{PJ.remove}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-c-secondary">{PJ.noTeam}</p>}
      </div>
    </Panel>
  );
}

/* ── Project Maintenance (Houzs ProjectMaintenance: one list per master) ── */

export function ProjectMaintenancePage() {
  const q = useProjectMasters();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-maintenance-page">
      <ModuleHeader destinationHeader testId="project-maintenance-destination-header" word={PJ.maintenance} docTitle={`${PJ.maintenance} · Carres`} />
      {q.isError ? <CouldNotLoad detail={PJ.failed} onRetry={() => void q.refetch()} /> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-2">
          {PROJECT_MASTER_KINDS.map((k) => <MasterList key={k} kind={k} rows={(q.data?.masters ?? []).filter((m) => m.kind === k)} />)}
          <TemplateList />
        </div>
      )}
    </div>
  );
}

function MasterList({ kind, rows }: { kind: ProjectMasterKind; rows: ProjectMaster[] }) {
  const write = useProjectWrite();
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const venue = kind === "venue";
  const run = (path: string, method: "POST" | "PATCH", body: unknown, done?: () => void) => {
    setMessage(null);
    write.mutate({ path, method, body }, { onSuccess: done, onError: (e) => setMessage(refusalOf(e)) });
  };
  return (
    <Panel title={PJ.kinds[kind]}>
      <div className="flex flex-col gap-3" data-testid={`project-masters-${kind}`}>
        <span className="flex flex-wrap items-end gap-2">
          <Input id={`master-${kind}-name`} label={PJ.kindOne[kind]} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          {venue ? <Input id="master-venue-state" label={PJ.state} maxLength={60} value={state} onChange={(e) => setState(e.target.value)} /> : null}
          <Button size="sm" variant="primary" disabled={!name.trim()} loading={write.isPending}
            onClick={() => run("/masters", "POST", { kind, name, state: venue ? state : null }, () => { setName(""); setState(""); })}>{PJ.add}</Button>
        </span>
        {message ? <p role="alert" className="text-body">{message}</p> : null}
        {rows.length ? (
          <ul className="flex flex-col gap-2 text-body">
            {rows.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 break-words ${m.active ? "" : "text-c-secondary"}`}>
                  {m.name}{m.state ? <span className="text-c-secondary">{` · ${m.state}`}</span> : null}
                </span>
                {m.active ? <StatusPill tone="success">{PJ.inUse}</StatusPill> : null}
                <Button size="sm" onClick={() => run(`/masters/${m.id}`, "PATCH", { active: !m.active })}>{m.active ? PJ.retire : PJ.reuse}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-c-secondary">{PJ.noMasters}</p>}
      </div>
    </Panel>
  );
}

/* ── Checklist (Houzs project_checklist: tasks by section, due = start + offset) ── */

function ChecklistPanel({ startDate, tasks, act, busy }: { startDate: string; tasks: ChecklistTask[]; act: Act; busy: boolean }) {
  const templates = (useChecklistTemplates().data?.templates ?? []).filter((t) => t.active && t.items.length);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [offset, setOffset] = useState("");
  const sections = [...new Set(tasks.map((t) => t.section ?? ""))];
  const progress = checklistProgress(tasks);
  return (
    <Panel title={PJ.checklist} right={tasks.length ? <span className="text-body text-c-secondary">{PJ.progress(progress)}</span> : undefined}>
      <div className="flex flex-col gap-3" data-testid="project-checklist">
        {templates.length ? (
          <span className="flex flex-wrap items-end gap-2">
            <Select id="project-checklist-template" label={PJ.template} value={templateId || undefined} onValueChange={setTemplateId}
              options={templates.map((t) => ({ value: t.id, label: t.name }))} />
            <Button size="sm" disabled={!templateId} loading={busy} onClick={() => act("/checklist/apply", { templateId }, "POST", () => setTemplateId(""))}>{PJ.applyTemplate}</Button>
          </span>
        ) : null}
        {sections.map((s) => (
          <div key={s} className="flex flex-col gap-1">
            {s ? <span className="text-strong text-c-ink">{s}</span> : null}
            <ul className="flex flex-col gap-1 text-body">
              {tasks.filter((t) => (t.section ?? "") === s).map((t) => {
                const due = checklistDueDate(startDate, t.dueOffsetDays);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words">{t.title}</span>
                    {due ? <span className="text-c-secondary">{fmtDate(due)}</span> : null}
                    {t.completedByName && (t.status === "done" || t.status === "na") ? <span className="text-c-secondary">{t.completedByName}</span> : null}
                    <Select id={`checklist-${t.id}`} toolbar value={t.status} onValueChange={(v) => act(`/checklist/${t.id}/status`, { status: v }, "POST")}
                      options={CHECKLIST_STATUSES.map((x) => ({ value: x, label: PJ.checklistStatuses[x] }))} />
                    <Button size="sm" onClick={() => act(`/checklist/${t.id}`, undefined, "DELETE")}>{PJ.remove}</Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!tasks.length ? <p className="text-body text-c-secondary">{PJ.noChecklist}</p> : null}
        <span className="flex flex-wrap items-end gap-2">
          <Input id="project-task-section" label={PJ.section} maxLength={80} value={section} onChange={(e) => setSection(e.target.value)} />
          <Input id="project-task-title" label={PJ.task} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input id="project-task-offset" label={PJ.dueOffset} hint={PJ.dueOffsetHint} type="number" min={-365} max={365} value={offset} onChange={(e) => setOffset(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!title.trim()} loading={busy}
            onClick={() => act("/checklist", { section: section.trim() || null, title: title.trim(), dueOffsetDays: offset === "" ? null : Number(offset) }, "POST",
              () => { setTitle(""); setOffset(""); })}>{PJ.addTask}</Button>
        </span>
      </div>
    </Panel>
  );
}

/* ── Checklist templates on Project Maintenance (Houzs template editor) ── */

function TemplateList() {
  const q = useChecklistTemplates();
  const write = useProjectWrite();
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState("");
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [offset, setOffset] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const run = (path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, done?: () => void) => {
    setMessage(null);
    write.mutate({ path, method, body }, { onSuccess: done, onError: (e) => setMessage(refusalOf(e)) });
  };
  const templates = q.data?.templates ?? [];
  const open = templates.find((t) => t.id === openId);
  const typeOptions = [{ value: "none", label: PJ.none }, ...PROJECT_EVENT_TYPES.map((t) => ({ value: t, label: PJ.eventTypes[t] }))];
  return (
    <Panel title={PJ.templates}>
      <div className="flex flex-col gap-3" data-testid="project-checklist-templates">
        <span className="flex flex-wrap items-end gap-2">
          <Input id="template-name" label={PJ.template} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!name.trim()} loading={write.isPending}
            onClick={() => run("/checklist-templates", "POST", { name: name.trim() }, () => setName(""))}>{PJ.add}</Button>
        </span>
        {message ? <p role="alert" className="text-body">{message}</p> : null}
        {templates.length ? (
          <ul className="flex flex-col gap-2 text-body">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className={`min-w-0 flex-1 break-words text-left ${t.active ? "" : "text-c-secondary"}`} onClick={() => setOpenId(t.id === openId ? "" : t.id)}>
                  {t.name}<span className="text-c-secondary">{` · ${PJ.taskCount(t.items.length)}`}</span>
                </button>
                <Select id={`template-type-${t.id}`} toolbar label={PJ.defaultFor} value={t.eventType ?? "none"}
                  onValueChange={(v) => run(`/checklist-templates/${t.id}`, "PATCH", { eventType: v === "none" ? null : v })} options={typeOptions} />
                <Button size="sm" onClick={() => run(`/checklist-templates/${t.id}`, "PATCH", { active: !t.active })}>{t.active ? PJ.retire : PJ.reuse}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-c-secondary">{PJ.noMasters}</p>}
        {open ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-strong text-c-ink">{open.name}</span>
            <ul className="flex flex-col gap-1 text-body">
              {open.items.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words">{i.section ? <span className="text-c-secondary">{`${i.section} · `}</span> : null}{i.title}</span>
                  {i.dueOffsetDays != null ? <span className="text-c-secondary">{PJ.offsetDays(i.dueOffsetDays)}</span> : null}
                  <Button size="sm" onClick={() => run(`/checklist-template-items/${i.id}`, "DELETE")}>{PJ.remove}</Button>
                </li>
              ))}
            </ul>
            <span className="flex flex-wrap items-end gap-2">
              <Input id="template-item-section" label={PJ.section} maxLength={80} value={section} onChange={(e) => setSection(e.target.value)} />
              <Input id="template-item-title" label={PJ.task} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Input id="template-item-offset" label={PJ.dueOffset} hint={PJ.dueOffsetHint} type="number" min={-365} max={365} value={offset} onChange={(e) => setOffset(e.target.value)} />
              <Button size="sm" variant="primary" disabled={!title.trim()} loading={write.isPending}
                onClick={() => run(`/checklist-templates/${open.id}/items`, "POST", { section: section.trim() || null, title: title.trim(), dueOffsetDays: offset === "" ? null : Number(offset) },
                  () => { setTitle(""); setOffset(""); })}>{PJ.addTask}</Button>
            </span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/* ── Sales Orders at the project (Houzs project SO list: total, paid, balance) ── */

function SalesOrdersPanel({ projectId, act, busy }: { projectId: string; act: Act; busy: boolean }) {
  const q = useProjectSalesOrders(projectId);
  const [so, setSo] = useState("");
  const t = q.data?.totals;
  return (
    <Panel title={PJ.salesOrders} right={t?.count ? <span className="text-body text-c-secondary">{PJ.salesTotals(t.count, rm(t.total), rm(t.paid), rm(t.balance))}</span> : undefined}>
      <div className="flex flex-col gap-3" data-testid="project-sales-orders">
        <span className="flex flex-wrap items-end gap-2">
          <Input id="project-link-so" label={PJ.soNo} maxLength={40} value={so} onChange={(e) => setSo(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!so.trim()} loading={busy}
            onClick={() => act("/sales-orders", { so: so.trim() }, "POST", () => setSo(""))}>{PJ.linkSo}</Button>
        </span>
        {q.isError ? <p className="text-body">{PJ.failed}</p> : q.data?.orders.length ? (
          <ul className="flex flex-col gap-2 text-body">
            {q.data.orders.map((o) => (
              <li key={o.id} className={`flex flex-wrap items-center gap-2 ${o.status === "cancelled" ? "text-c-secondary" : ""}`}>
                <span className="w-28 shrink-0">{o.so}</span>
                <span className="min-w-0 flex-1 break-words">{o.customerName ?? ""}</span>
                {o.status === "cancelled" ? <StatusPill tone="neutral">{PJ.cancelledSo}</StatusPill> : null}
                <span className="tabular-nums">{o.total == null ? PJ.noValue : rm(o.total)}</span>
                <span className="tabular-nums text-c-secondary">{PJ.paidBalance(rm(o.paid), rm(o.balance))}</span>
                <Button size="sm" onClick={() => act(`/sales-orders/${o.id}`, undefined, "DELETE")}>{PJ.remove}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-c-secondary">{PJ.noSalesOrders}</p>}
      </div>
    </Panel>
  );
}

/* ── Project sheet (slice 7, Houzs projects_print Event Summary Report) ── */

function PrintSheet({ projectId, data, onFail }: {
  projectId: string;
  data: { project: ProjectRow; team: ProjectTeamMember[]; checklist: ChecklistTask[] };
  onFail: (m: string | null) => void;
}) {
  const so = useProjectSalesOrders(projectId);
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    onFail(null);
    try {
      const { renderProjectSheetPdf } = await import("@/lib/pdf/render");
      const blob = await renderProjectSheetPdf({
        ...data,
        salesOrders: so.data ?? null,
        printedAt: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.project.code}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      onFail(PJ.printFailed);
    } finally {
      setBusy(false);
    }
  };
  return <Button size="sm" loading={busy} onClick={() => void print()}>{PJ.print}</Button>;
}
