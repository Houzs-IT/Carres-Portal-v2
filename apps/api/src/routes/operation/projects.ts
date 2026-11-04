import { Hono } from "hono";
import {
  deriveProjectCode, deriveProjectName, projectCreateInput, projectNoteInput, projectPatchInput,
  PROJECT_STAGES, PROJECT_STATUSES, uniqueProjectCode,
  type ProjectActivity, type ProjectRow,
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

router.get("/:id", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const id = c.req.param("id");
  const [pR, aR] = await Promise.all([
    sb.from("projects").select(COLS).eq("id", id).maybeSingle(),
    sb.from("project_activity").select("id, action, from_value, to_value, note, created_at, by:app_users(name)").eq("project_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (pR.error) return fail(c, pR.error);
  if (aR.error) return fail(c, aR.error);
  if (!pR.data) return c.json({ error: "not_found", code: "not_found", message: "Project not found." }, 404);
  const activity: ProjectActivity[] = ((aR.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), action: String(r.action), fromValue: (r.from_value as string | null) ?? null, toValue: (r.to_value as string | null) ?? null,
    note: (r.note as string | null) ?? null, byName: ((r.by as { name?: string } | null)?.name) ?? null, createdAt: String(r.created_at),
  }));
  return c.json({ project: toProject(pR.data as Row), activity });
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
