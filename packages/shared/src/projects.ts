import { z } from "zod";

/**
 * Projects: fairs, exhibitions and solo roadshows (migration 0750).
 * Weisiang's decision (Mr Lim, 2026-10-22): clear Carres rules, implement
 * Houzs. Jess was not part of this decision. Ported from Houzs
 * backend/src/services/project-naming.ts and
 * frontend/src/vendor/scm/lib/pms-project-status.ts.
 */

/** Houzs 053_simplify_project_stages.sql: the internal workflow. */
export const PROJECT_STAGES = ["draft", "setup", "live", "dismantle", "completed"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** Houzs 088_project_status.sql: the boss-facing state and calendar colour. */
export const PROJECT_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Houzs 021_projects.sql seeds these two event types. */
export const PROJECT_EVENT_TYPES = ["exhibition", "solo"] as const;
export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number];

const slugSegment = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * `YYYY-MM-{ORGANIZER}-{STATE}-{VENUE}-{BRAND}`; a solo event, or one with no
 * organizer, takes `SOLO` (Houzs project-naming.ts:25-60). The caller adds
 * `-2`, `-3` on a clash.
 */
export function deriveProjectCode(input: {
  startDate: string;
  organizer?: string | null;
  state: string;
  venue: string;
  brand: string;
  eventType?: ProjectEventType | null;
}): string {
  const organizer = input.eventType === "solo" ? "SOLO" : slugSegment(input.organizer) || "SOLO";
  return [input.startDate.slice(0, 7), organizer, slugSegment(input.state), slugSegment(input.venue), slugSegment(input.brand)].join("-");
}

/** The first free code: `base`, else `base-2`, `base-3`, ... (Houzs uniqueProjectCode). */
export function uniqueProjectCode(base: string, taken: ReadonlyArray<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** `STATE [BRAND] ORGANIZER @ VENUE`; an empty organizer reads SOLO (Houzs deriveProjectName). */
export function deriveProjectName(input: { state: string; brand: string; organizer?: string | null; venue: string }): string {
  const organizer = (input.organizer ?? "").trim() || "SOLO";
  return `${input.state.trim().toUpperCase()} [${input.brand.trim()}] ${organizer} @ ${input.venue.trim()}`;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const uuid = z.string().uuid();

export const projectCreateInput = z
  .object({
    name: optText(200),
    eventType: z.enum(PROJECT_EVENT_TYPES).nullish(),
    brand: text(60),
    state: text(60),
    venue: text(120),
    venueAddress: optText(300),
    organizer: optText(120),
    contractor: optText(120),
    boothNo: optText(40),
    sizeSqm: z.number().min(0).max(100_000).nullish(),
    startDate: day,
    endDate: day,
    picId: uuid.nullish(),
    notes: optText(2000),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "End date is before start date.", path: ["endDate"] });
export type ProjectCreateInput = z.infer<typeof projectCreateInput>;

/** Every field optional; the code never changes once minted (Houzs: the code is the identity). */
export const projectPatchInput = z.object({
  name: text(200).optional(),
  eventType: z.enum(PROJECT_EVENT_TYPES).nullable().optional(),
  brand: text(60).optional(),
  state: text(60).optional(),
  venue: text(120).optional(),
  venueAddress: optText(300).optional(),
  organizer: optText(120).optional(),
  contractor: optText(120).optional(),
  boothNo: optText(40).optional(),
  sizeSqm: z.number().min(0).max(100_000).nullable().optional(),
  startDate: day.optional(),
  endDate: day.optional(),
  picId: uuid.nullable().optional(),
  notes: optText(2000).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ProjectPatchInput = z.infer<typeof projectPatchInput>;

export const projectNoteInput = z.object({ note: text(2000) });

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  stage: ProjectStage;
  status: ProjectStatus;
  eventType: ProjectEventType | null;
  brand: string;
  state: string;
  venue: string;
  venueAddress: string | null;
  organizer: string | null;
  contractor: string | null;
  boothNo: string | null;
  sizeSqm: number | null;
  startDate: string;
  endDate: string;
  picId: string | null;
  picName: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ProjectActivity {
  id: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  byName: string | null;
  createdAt: string;
}

/** Days the event runs, both ends counted (Houzs duration_days). */
export function projectDurationDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

/* ── Slice 2 (0751): Project Maintenance masters and the project team ──── */

/** Houzs project_brands, project_venues, project_organizers, project_contractors,
 *  kept as one Carres table with a kind. Event types stay the two fixed ones. */
export const PROJECT_MASTER_KINDS = ["brand", "venue", "organizer", "contractor"] as const;
export type ProjectMasterKind = (typeof PROJECT_MASTER_KINDS)[number];

export const projectMasterInput = z.object({
  kind: z.enum(PROJECT_MASTER_KINDS),
  name: text(120),
  state: optText(60),
  address: optText(300),
  notes: optText(500),
});
export const projectMasterPatch = z.object({
  name: text(120).optional(),
  state: optText(60).optional(),
  address: optText(300).optional(),
  notes: optText(500).optional(),
  active: z.boolean().optional(),
});

export interface ProjectMaster {
  id: string;
  kind: ProjectMasterKind;
  name: string;
  state: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

/** Houzs project_team.role is free text ('designer' | 'manager' | 'sales' | 'onsite' | ...). */
export const projectTeamInput = z.object({ userId: z.string().uuid(), role: optText(40) });

export interface ProjectTeamMember {
  id: string;
  userId: string;
  name: string | null;
  role: string | null;
}

/* ── Slice 3 (0752): checklist templates and the project checklist ──────── */

/** Houzs checklist statuses; `na` is "not needed". */
export const CHECKLIST_STATUSES = ["pending", "done", "na", "blocked"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

const offset = z.number().int().min(-365).max(365).nullish().transform((v) => v ?? null);

export const checklistTemplateInput = z.object({ name: text(120), eventType: z.enum(PROJECT_EVENT_TYPES).nullish().transform((v) => v ?? null) });
export const checklistTemplatePatch = z.object({
  name: text(120).optional(),
  eventType: z.enum(PROJECT_EVENT_TYPES).nullable().optional(),
  active: z.boolean().optional(),
});
/** One task: on a template, or added straight to a project. */
export const checklistItemInput = z.object({ section: optText(80), title: text(200), dueOffsetDays: offset });
export const checklistStatusInput = z.object({ status: z.enum(CHECKLIST_STATUSES), notes: optText(1000).optional() });
export const checklistApplyInput = z.object({ templateId: z.string().uuid() });

export interface ChecklistTemplateItem { id: string; section: string | null; seq: number; title: string; dueOffsetDays: number | null }
export interface ChecklistTemplate { id: string; name: string; eventType: ProjectEventType | null; active: boolean; items: ChecklistTemplateItem[] }
export interface ChecklistTask {
  id: string;
  section: string | null;
  seq: number;
  title: string;
  dueOffsetDays: number | null;
  status: ChecklistStatus;
  notes: string | null;
  completedByName: string | null;
  completedAt: string | null;
}

/** Houzs 054: due day = project start + offset; null when the task has no offset. */
export function checklistDueDate(startDate: string, offsetDays: number | null): string | null {
  if (offsetDays == null) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Done or not needed counts as finished (Houzs: status NOT IN ('done','na')). */
export function checklistProgress(tasks: ReadonlyArray<{ status: ChecklistStatus }>): number {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === "done" || t.status === "na").length / tasks.length) * 100);
}

/* ── Slice 4 (0753): Sales Orders at the project ─────────────────────── */

export const projectOrderLinkInput = z.object({ so: text(40) });

export interface ProjectSalesOrder {
  id: string;
  so: string;
  status: string;
  customerName: string | null;
  placedAt: string | null;
  /** From the shared orderMoney; null when the order has no value on record. */
  total: number | null;
  paid: number;
  balance: number;
}

/** Houzs: a cancelled order is left out of the project's sales. Sums in sen. */
export function projectSalesTotals(orders: ReadonlyArray<ProjectSalesOrder>) {
  const live = orders.filter((o) => o.status !== "cancelled");
  const sen = (f: (o: ProjectSalesOrder) => number) => live.reduce((s, o) => s + Math.round(f(o) * 100), 0) / 100;
  return { count: live.length, total: sen((o) => o.total ?? 0), paid: sen((o) => o.paid), balance: sen((o) => o.balance) };
}

/* ── Slice 7: the printed project sheet ──────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Houzs projects_print fmtRange, with "to" for its dash: `4 to 6 Dec 2026`,
 *  `30 Nov to 2 Dec 2026`, `30 Dec 2026 to 2 Jan 2027`, `4 Dec 2026`. */
export function projectDateRange(startDate: string, endDate: string): string {
  const p = (s: string) => s.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [sy, sm, sd] = p(startDate);
  const [ey, em, ed] = p(endDate);
  const one = (y: number, m: number, d: number) => `${d} ${MONTHS[m - 1]} ${y}`;
  if (sy === ey && sm === em && sd === ed) return one(sy, sm, sd);
  if (sy !== ey) return `${one(sy, sm, sd)} to ${one(ey, em, ed)}`;
  if (sm !== em) return `${sd} ${MONTHS[sm - 1]} to ${one(ey, em, ed)}`;
  return `${sd} to ${one(ey, em, ed)}`;
}

/* ── Slice 8: the month calendar beside the Project List ─────────────── */

/** True when the project runs on that day, both ends counted (Houzs calendar bars). */
export function projectRunsOn(p: { startDate: string; endDate: string }, day: string): boolean {
  return p.startDate <= day && day <= p.endDate;
}

/** `YYYY-MM-DD` → how many projects run that day, for every day of `month` (`YYYY-MM`). */
export function projectDayCounts(projects: ReadonlyArray<{ startDate: string; endDate: string }>, month: string): Record<string, number> {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: Record<string, number> = {};
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    const n = projects.filter((p) => projectRunsOn(p, day)).length;
    if (n) out[day] = n;
  }
  return out;
}
