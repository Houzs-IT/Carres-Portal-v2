import { Hono } from "hono";
import {
  checklistApplyInput, checklistItemInput, checklistStatusInput, checklistTemplateInput, checklistTemplatePatch,
  deriveProjectCode, deriveProjectName, projectCreateInput, projectMasterInput, projectMasterPatch, projectNoteInput,
  projectPatchInput, projectTeamInput, PROJECT_STAGES, PROJECT_STATUSES, uniqueProjectCode,
  type ChecklistTask, type ChecklistTemplate, type ProjectActivity, type ProjectMaster, type ProjectRow, type ProjectTeamMember,
} from "@carres/shared/projects";
import { requireOperation } from "../../lib/auth-guards";
import { fail, parseJsonBody } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * /api/operation/projects — fairs, exhibitions and solo roadshows (0750).
 * Weisiang's decision (Mr Lim, 2026-10-22): clear Carres rules, implement
 * Houzs. Jess was not part of this decision. Follows Houzs
 * backend/src/routes/projects.ts (GET / :1038, GET /:id :2404, POST / :2520,
 * PATCH /:id :2577, notes :2626, archive :2713, unarchive :2728).
 *
 *   GET   /?search=&status=&stage=&brand=&from=&to=&archived=1   the list
 *   GET   /:id               one project and its activity
 *   POST  /                  create; the code is derived and never changes
 *   PATCH /:id               edit fields, stage or status
 *   POST  /:id/notes         add a note to the activity
 *   POST  /:id/archive · /:id/unarchive
 *   GET   /masters · POST /masters · PATCH /masters/:mid      Project Maintenance (0751)
 *   POST  /:id/team · DELETE /team/:teamId                    the project team (0751)
 *   GET/POST /checklist-templates · PATCH /checklist-templates/:tid · POST /checklist-templates/:tid/items
 *   DELETE /checklist-template-items/:iid · POST /:id/checklist · POST /:id/checklist/apply
 *   POST  /checklist/:taskId/status · DELETE /checklist/:taskId   checklists (0752)
 *
 * Row security (0750) admits Operation and the principal; the caller's own
 * token reaches the tables.
 */
const router = new Hono<AppEnv>();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLS =
  "id, code, name, stage, status, event_type, brand, state, venue, venue_address, organizer, contractor, booth_no, size_sqm, start_date, end_date, pic_id, notes, archived_at, created_at, pic:app_users!projects_pic_id_fkey(name)";

type Row = Record<string, unknown>;
export const toProject = (r: Row): ProjectRow => ({
  id: String(r.id),
  code: String(r.code),
  name: String(r.name),
  stage: r.stage as ProjectRow["stage"],
  status: r.status as ProjectRow["status"],
  eventType: (r.event_type ?? null) as ProjectRow["eventType"],
  brand: String(r.brand),
  state: String(r.state),
  venue: String(r.venue),
  venueAddress: (r.venue_address as string | null) ?? null,
  organizer: (r.organizer as string | null) ?? null,
  contractor: (r.contractor as string | null) ?? null,
  boothNo: (r.booth_no as string | null) ?? null,
  sizeSqm: r.size_sqm == null ? null : Number(r.size_sqm),
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  picId: (r.pic_id as string | null) ?? null,
  picName: ((r.pic as { name?: string } | null)?.name) ?? null,
  notes: (r.notes as string | null) ?? null,
  archivedAt: (r.archived_at as string | null) ?? null,
  createdAt: String(r.created_at),
});

/** PostgREST `or` filter text: drop the characters that would break the filter. */
const searchTerm = (s: string) => s.replace(/[,()*%\\]/g, " ").trim();

router.get("/", requireOperation, async (c) => {
  const q = c.req.query();
  for (const d of [q.from, q.to]) {
    if (d && !DAY.test(d)) return c.json({ error: "invalid_input", code: "invalid_param", message: "from and to are dates" }, 422);
  }
  let req = userClient(c.env, c.var.auth.jwt).from("projects").select(COLS).order("start_date", { ascending: false }).limit(500);
  req = q.archived === "1" ? req.not("archived_at", "is", null) : req.is("archived_at", null);
  const statuses = (q.status ?? "").split(",").filter((s) => (PROJECT_STATUSES as readonly string[]).includes(s));
  if (statuses.length) req = req.in("status", statuses);
  const stages = (q.stage ?? "").split(",").filter((s) => (PROJECT_STAGES as readonly string[]).includes(s));
  if (stages.length) req = req.in("stage", stages);
  if (q.brand) req = req.eq("brand", q.brand);
  // Houzs: the date range keeps every event that overlaps the window.
  if (q.from) req = req.gte("end_date", q.from);
  if (q.to) req = req.lte("start_date", q.to);
  const term = searchTerm(q.search ?? "");
  if (term) req = req.or(`name.ilike.%${term}%,code.ilike.%${term}%,venue.ilike.%${term}%,organizer.ilike.%${term}%`);
  const { data, error } = await req;
  if (error) return fail(c, error);
  return c.json({ projects: ((data ?? []) as Row[]).map(toProject) });
});

/* ── Project Maintenance (0751, Houzs project masters) ── registered before /:id. */
const MASTER_COLS = "id, kind, name, state, address, notes, active";
const toMaster = (r: Row): ProjectMaster => ({
  id: String(r.id), kind: r.kind as ProjectMaster["kind"], name: String(r.name), state: (r.state as string | null) ?? null,
  address: (r.address as string | null) ?? null, notes: (r.notes as string | null) ?? null, active: r.active === true,
});

router.get("/masters", requireOperation, async (c) => {
  const { data, error } = await userClient(c.env, c.var.auth.jwt).from("project_masters").select(MASTER_COLS).order("name");
  if (error) return fail(c, error);
  return c.json({ masters: ((data ?? []) as Row[]).map(toMaster) });
});

router.post("/masters", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectMasterInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { data, error } = await userClient(c.env, c.var.auth.jwt).from("project_masters").insert(body.data).select(MASTER_COLS).single();
  if (error) return fail(c, error);
  return c.json({ master: toMaster(data as Row) }, 201);
});

router.patch("/masters/:mid", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectMasterPatch);
  if (!body.ok) return c.json(body.body, body.status);
  const patch = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return c.json({ error: "invalid_input", code: "invalid_param", message: "Nothing to save." }, 422);
  const { data, error } = await userClient(c.env, c.var.auth.jwt).from("project_masters").update(patch).eq("id", c.req.param("mid")).select(MASTER_COLS).maybeSingle();
  if (error) return fail(c, error);
  if (!data) return c.json({ error: "not_found", code: "not_found", message: "Not found." }, 404);
  return c.json({ master: toMaster(data as Row) });
});

router.delete("/team/:teamId", requireOperation, async (c) => {
  const { error } = await userClient(c.env, c.var.auth.jwt).from("project_team").delete().eq("id", c.req.param("teamId"));
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

/* ── Checklist templates and tasks (0752, Houzs checklist) ── registered before /:id. */
const TEMPLATE_COLS = "id, name, event_type, active, items:project_checklist_template_items(id, section, seq, title, due_offset_days)";
const toTemplate = (r: Row): ChecklistTemplate => ({
  id: String(r.id), name: String(r.name), eventType: (r.event_type ?? null) as ChecklistTemplate["eventType"], active: r.active === true,
  items: ((r.items ?? []) as Row[])
    .map((i) => ({ id: String(i.id), section: (i.section as string | null) ?? null, seq: Number(i.seq), title: String(i.title), dueOffsetDays: (i.due_offset_days as number | null) ?? null }))
    .sort((a, b) => a.seq - b.seq),
});

/** Copy a template's tasks onto a project (Houzs clones at create; 054 keeps the offset). */
async function applyTemplate(sb: ReturnType<typeof userClient>, projectId: string, templateId: string) {
  const items = await sb.from("project_checklist_template_items").select("section, seq, title, due_offset_days").eq("template_id", templateId);
  if (items.error || !items.data?.length) return items.error;
  const { error } = await sb.from("project_checklist").insert(((items.data ?? []) as Row[]).map((i) => ({
    project_id: projectId, section: i.section, seq: i.seq, title: i.title, due_offset_days: i.due_offset_days,
  })));
  return error;
}

router.get("/checklist-templates", requireOperation, async (c) => {
  const { data, error } = await userClient(c.env, c.var.auth.jwt).from("project_checklist_templates").select(TEMPLATE_COLS).order("name");
  if (error) return fail(c, error);
  return c.json({ templates: ((data ?? []) as Row[]).map(toTemplate) });
});

router.post("/checklist-templates", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistTemplateInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { data, error } = await userClient(c.env, c.var.auth.jwt)
    .from("project_checklist_templates").insert({ name: body.data.name, event_type: body.data.eventType }).select(TEMPLATE_COLS).single();
  if (error) return fail(c, error);
  return c.json({ template: toTemplate(data as Row) }, 201);
});

router.patch("/checklist-templates/:tid", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistTemplatePatch);
  if (!body.ok) return c.json(body.body, body.status);
  const { name, eventType, active } = body.data;
  const patch = Object.fromEntries(Object.entries({ name, event_type: eventType, active }).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return c.json({ error: "invalid_input", code: "invalid_param", message: "Nothing to save." }, 422);
  const { data, error } = await userClient(c.env, c.var.auth.jwt)
    .from("project_checklist_templates").update(patch).eq("id", c.req.param("tid")).select(TEMPLATE_COLS).maybeSingle();
  if (error) return fail(c, error);
  if (!data) return c.json({ error: "not_found", code: "not_found", message: "Not found." }, 404);
  return c.json({ template: toTemplate(data as Row) });
});

router.post("/checklist-templates/:tid/items", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistItemInput);
  if (!body.ok) return c.json(body.body, body.status);
  const sb = userClient(c.env, c.var.auth.jwt);
  const last = await sb.from("project_checklist_template_items").select("seq").eq("template_id", c.req.param("tid")).order("seq", { ascending: false }).limit(1);
  if (last.error) return fail(c, last.error);
  const seq = Number(((last.data ?? []) as Row[])[0]?.seq ?? 0) + 10;
  const { error } = await sb.from("project_checklist_template_items").insert({
    template_id: c.req.param("tid"), seq, section: body.data.section, title: body.data.title, due_offset_days: body.data.dueOffsetDays,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true }, 201);
});

router.delete("/checklist-template-items/:iid", requireOperation, async (c) => {
  const { error } = await userClient(c.env, c.var.auth.jwt).from("project_checklist_template_items").delete().eq("id", c.req.param("iid"));
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

router.post("/checklist/:taskId/status", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistStatusInput);
  if (!body.ok) return c.json(body.body, body.status);
  const done = body.data.status === "done" || body.data.status === "na";
  const { data, error } = await userClient(c.env, c.var.auth.jwt)
    .from("project_checklist")
    .update({
      status: body.data.status,
      ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
      completed_by: done ? c.var.auth.id : null,
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", c.req.param("taskId"))
    .select("id")
    .maybeSingle();
  if (error) return fail(c, error);
  if (!data) return c.json({ error: "not_found", code: "not_found", message: "Not found." }, 404);
  return c.json({ ok: true });
});

router.delete("/checklist/:taskId", requireOperation, async (c) => {
  const { error } = await userClient(c.env, c.var.auth.jwt).from("project_checklist").delete().eq("id", c.req.param("taskId"));
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

router.get("/:id", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const id = c.req.param("id");
  const [pR, aR, tR, kR] = await Promise.all([
    sb.from("projects").select(COLS).eq("id", id).maybeSingle(),
    sb.from("project_activity").select("id, action, from_value, to_value, note, created_at, by:app_users(name)").eq("project_id", id).order("created_at", { ascending: false }).limit(200),
    sb.from("project_team").select("id, user_id, role, who:app_users(name)").eq("project_id", id).order("created_at"),
    sb.from("project_checklist").select("id, section, seq, title, due_offset_days, status, notes, completed_at, by:app_users(name)").eq("project_id", id).order("seq"),
  ]);
  if (pR.error) return fail(c, pR.error);
  if (aR.error) return fail(c, aR.error);
  if (tR.error) return fail(c, tR.error);
  if (kR.error) return fail(c, kR.error);
  if (!pR.data) return c.json({ error: "not_found", code: "not_found", message: "Project not found." }, 404);
  const activity: ProjectActivity[] = ((aR.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), action: String(r.action), fromValue: (r.from_value as string | null) ?? null, toValue: (r.to_value as string | null) ?? null,
    note: (r.note as string | null) ?? null, byName: ((r.by as { name?: string } | null)?.name) ?? null, createdAt: String(r.created_at),
  }));
  const team: ProjectTeamMember[] = ((tR.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), userId: String(r.user_id), role: (r.role as string | null) ?? null, name: ((r.who as { name?: string } | null)?.name) ?? null,
  }));
  const checklist: ChecklistTask[] = ((kR.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), section: (r.section as string | null) ?? null, seq: Number(r.seq), title: String(r.title),
    dueOffsetDays: (r.due_offset_days as number | null) ?? null, status: r.status as ChecklistTask["status"], notes: (r.notes as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null, completedByName: ((r.by as { name?: string } | null)?.name) ?? null,
  }));
  return c.json({ project: toProject(pR.data as Row), activity, team, checklist });
});

router.post("/", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectCreateInput);
  if (!body.ok) return c.json(body.body, body.status);
  const d = body.data;
  const sb = userClient(c.env, c.var.auth.jwt);
  const base = deriveProjectCode(d);
  const taken = await sb.from("projects").select("code").like("code", `${base}%`);
  if (taken.error) return fail(c, taken.error);
  const code = uniqueProjectCode(base, ((taken.data ?? []) as Row[]).map((r) => String(r.code)));
  const { data, error } = await sb
    .from("projects")
    .insert({
      code, name: d.name ?? deriveProjectName(d), event_type: d.eventType ?? null, brand: d.brand, state: d.state, venue: d.venue,
      venue_address: d.venueAddress, organizer: d.organizer, contractor: d.contractor, booth_no: d.boothNo, size_sqm: d.sizeSqm ?? null,
      start_date: d.startDate, end_date: d.endDate, pic_id: d.picId ?? null, notes: d.notes,
    })
    .select(COLS)
    .single();
  if (error) return fail(c, error);
  // Houzs: a new project starts with its event type's default checklist. The project is
  // already saved, so a failed copy still answers 201; a retry would make a second project.
  // Staff add the tasks with Add template tasks.
  if (d.eventType) {
    const tpl = await sb.from("project_checklist_templates").select("id").eq("event_type", d.eventType).eq("active", true).maybeSingle();
    if (!tpl.error && tpl.data) await applyTemplate(sb, String((data as Row).id), String((tpl.data as Row).id));
  }
  return c.json({ project: toProject(data as Row) }, 201);
});

const PATCH_COLS: Record<string, string> = {
  name: "name", eventType: "event_type", brand: "brand", state: "state", venue: "venue", venueAddress: "venue_address",
  organizer: "organizer", contractor: "contractor", boothNo: "booth_no", sizeSqm: "size_sqm", startDate: "start_date",
  endDate: "end_date", picId: "pic_id", notes: "notes", stage: "stage", status: "status",
};

router.patch("/:id", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectPatchInput);
  if (!body.ok) return c.json(body.body, body.status);
  const patch: Row = {};
  for (const [k, v] of Object.entries(body.data)) if (v !== undefined) patch[PATCH_COLS[k]] = v;
  if (!Object.keys(patch).length) return c.json({ error: "invalid_input", code: "invalid_param", message: "Nothing to save." }, 422);
  const sb = userClient(c.env, c.var.auth.jwt);
  // Houzs: an archived project withholds only its status control (docs/modules/projects-pms.md:12-14).
  if (patch.status !== undefined) {
    const cur = await sb.from("projects").select("archived_at").eq("id", c.req.param("id")).maybeSingle();
    if (cur.error) return fail(c, cur.error);
    if ((cur.data as Row | null)?.archived_at) {
      return c.json({ error: "rule_violation", code: "archived", message: "Unarchive the project to change its status." }, 422);
    }
  }
  const { data, error } = await sb.from("projects").update(patch).eq("id", c.req.param("id")).select(COLS).maybeSingle();
  if (error) return fail(c, error);
  if (!data) return c.json({ error: "not_found", code: "not_found", message: "Project not found." }, 404);
  return c.json({ project: toProject(data as Row) });
});

router.post("/:id/notes", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectNoteInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { error } = await userClient(c.env, c.var.auth.jwt)
    .from("project_activity")
    .insert({ project_id: c.req.param("id"), action: "note", note: body.data.note, user_id: c.var.auth.id });
  if (error) return fail(c, error);
  return c.json({ ok: true }, 201);
});

router.post("/:id/checklist", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistItemInput);
  if (!body.ok) return c.json(body.body, body.status);
  const sb = userClient(c.env, c.var.auth.jwt);
  const last = await sb.from("project_checklist").select("seq").eq("project_id", c.req.param("id")).order("seq", { ascending: false }).limit(1);
  if (last.error) return fail(c, last.error);
  const { error } = await sb.from("project_checklist").insert({
    project_id: c.req.param("id"), seq: Number(((last.data ?? []) as Row[])[0]?.seq ?? 0) + 10,
    section: body.data.section, title: body.data.title, due_offset_days: body.data.dueOffsetDays,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true }, 201);
});

router.post("/:id/checklist/apply", requireOperation, async (c) => {
  const body = await parseJsonBody(c, checklistApplyInput);
  if (!body.ok) return c.json(body.body, body.status);
  const error = await applyTemplate(userClient(c.env, c.var.auth.jwt), c.req.param("id"), body.data.templateId);
  if (error) return fail(c, error);
  return c.json({ ok: true }, 201);
});

router.post("/:id/team", requireOperation, async (c) => {
  const body = await parseJsonBody(c, projectTeamInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { error } = await userClient(c.env, c.var.auth.jwt)
    .from("project_team")
    .insert({ project_id: c.req.param("id"), user_id: body.data.userId, role: body.data.role });
  if (error) return fail(c, error);
  return c.json({ ok: true }, 201);
});

for (const [path, archived] of [["archive", true], ["unarchive", false]] as const) {
  router.post(`/:id/${path}`, requireOperation, async (c) => {
    const { data, error } = await userClient(c.env, c.var.auth.jwt)
      .from("projects")
      .update(archived ? { archived_at: new Date().toISOString(), archived_by: c.var.auth.id } : { archived_at: null, archived_by: null })
      .eq("id", c.req.param("id"))
      .select("id")
      .maybeSingle();
    if (error) return fail(c, error);
    if (!data) return c.json({ error: "not_found", code: "not_found", message: "Project not found." }, 404);
    return c.json({ ok: true });
  });
}

export default router;
