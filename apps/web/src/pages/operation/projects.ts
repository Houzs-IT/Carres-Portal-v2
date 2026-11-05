import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChecklistStatus, ChecklistTask, ChecklistTemplate, ProjectActivity, ProjectSalesOrder, ProjectMaster, ProjectMasterKind, ProjectRow, ProjectStage, ProjectStatus, ProjectStockTransfer, ProjectTeamMember, StockTransferDirection,
} from "@carres/shared/projects";
import type { OrderActionTone } from "@carres/shared/order-actions";
import { apiFetch } from "@/lib/api";

/**
 * Projects: fairs, exhibitions and solo roadshows (migration 0750).
 * Weisiang's decision (Mr Lim, 2026-10-22): clear Carres rules, implement
 * Houzs. Jess was not part of this decision. Words are in COPY-STANDARD
 * "Projects words".
 */
export const PJ = {
  projectList: "Project List",
  project: "Project",
  newProject: "New project",
  editProject: "Edit project",
  code: "Code",
  name: "Name",
  status: "Status",
  stage: "Stage",
  eventType: "Event type",
  brand: "Brand",
  state: "State",
  venue: "Venue",
  venueAddress: "Venue address",
  organizer: "Organizer",
  contractor: "Contractor",
  boothNo: "Booth no",
  size: "Size (sqm)",
  start: "Start",
  end: "End",
  days: "Days",
  pic: "PIC",
  notes: "Notes",
  nameHint: "Leave empty to use STATE [BRAND] ORGANIZER @ VENUE.",
  organizerHint: "Leave empty for a solo event.",
  live: "Live projects",
  archivedList: "Archived",
  allStatuses: "All statuses",
  archive: "Archive",
  unarchive: "Unarchive",
  archivedNote: "This project is archived. Unarchive it to change its status.",
  back: "Project List",
  details: "Details",
  activity: "Activity",
  addNote: "Add note",
  notePlaceholder: "Write a note",
  noActivity: "No activity yet.",
  noProjects: "No projects yet. Use New project to add the first fair or exhibition.",
  save: "Save",
  cancel: "Cancel",
  none: "None",
  failed: "This page could not be loaded. Try again.",
  saveFailed: "Not saved. Try again.",
  notFound: "This project could not be found.",
  stages: { draft: "Draft", setup: "Setup", live: "Live", dismantle: "Dismantle", completed: "Completed" } satisfies Record<ProjectStage, string>,
  statuses: { pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled" } satisfies Record<ProjectStatus, string>,
  eventTypes: { exhibition: "Exhibition", solo: "Solo" },
  actions: {
    created: "Created", stage_change: "Stage", status_change: "Status", archived: "Archived", unarchived: "Unarchived", note: "Note",
    stock_transfer_add: "Stock transfer added", stock_transfer_confirm: "Stock transfer confirmed", stock_transfer_unconfirm: "Stock transfer unconfirmed",
  } as Record<string, string>,
  /* Slice 2 (0751): Project Maintenance and the team. */
  maintenance: "Project Maintenance",
  kinds: { brand: "Brands", venue: "Venues", organizer: "Organizers", contractor: "Contractors" } satisfies Record<ProjectMasterKind, string>,
  kindOne: { brand: "Brand", venue: "Venue", organizer: "Organizer", contractor: "Contractor" } satisfies Record<ProjectMasterKind, string>,
  add: "Add",
  inUse: "In use",
  retire: "Stop using",
  reuse: "Use again",
  address: "Address",
  noMasters: "Nothing here yet. Add the first one above.",
  team: "Team",
  role: "Role",
  rolePlaceholder: "For example onsite or sales",
  addMember: "Add to team",
  remove: "Remove",
  noTeam: "No one on the team yet.",
  /* Slice 3 (0752): checklist. */
  checklist: "Checklist",
  progress: (pct: number) => `${pct}% done`,
  checklistStatuses: { pending: "To do", done: "Done", na: "Not needed", blocked: "Blocked" } satisfies Record<ChecklistStatus, string>,
  template: "Checklist template",
  templates: "Checklist templates",
  applyTemplate: "Add template tasks",
  defaultFor: "New projects of this type",
  section: "Section",
  task: "Task",
  dueOffset: "Due (days from start)",
  dueOffsetHint: "Use a minus number for days before the start.",
  offsetDays: (n: number) => (n === 0 ? "Start day" : n < 0 ? `${-n} days before start` : `${n} days after start`),
  taskCount: (n: number) => `${n} tasks`,
  addTask: "Add task",
  noChecklist: "No tasks yet.",
  /* Slice 4 (0753): Sales Orders at the project. */
  salesOrders: "Sales Orders",
  soNo: "SO No",
  linkSo: "Add Sales Order",
  noSalesOrders: "No Sales Orders on this project yet.",
  noValue: "No value",
  cancelledSo: "Cancelled",
  paidBalance: (paid: string, balance: string) => `Paid ${paid} · Balance ${balance}`,
  salesTotals: (n: number, total: string, paid: string, balance: string) => `${n} orders · ${total} · Paid ${paid} · Balance ${balance}`,
  /* Slice 7: the printed project sheet. */
  print: "Print",
  printFailed: "The project sheet could not be made. Try again.",
  /* Slice 6 (0757): stock out to the fair and back. */
  stockTransfers: "Stock transfers",
  direction: "Direction",
  directions: { out: "Stock out", return: "Stock return" } satisfies Record<StockTransferDirection, string>,
  transferDate: "Transfer date",
  transferDateHint: "Leave empty for today.",
  transferSheet: "Transfer sheet",
  addTransfer: "Add transfer",
  recordOnly: "A record of the move. It does not change stock.",
  openFile: "Open file",
  fileFailed: "The file could not be opened. Try again.",
  confirm: "Confirm",
  unconfirm: "Undo confirm",
  confirmedBy: (name: string | null) => (name ? `Confirmed · ${name}` : "Confirmed"),
  notConfirmed: "Not confirmed",
  noTransfers: "No stock transfers yet.",
  /* Slice 8: the Project List and Calendar views (Houzs). */
  projectViews: "Project views",
  calendarView: "Calendar",
  /* Houzs layout (Project List cards, tiles and rail; detail header and columns). */
  cardsView: "Cards",
  tableView: "Table",
  allBrands: "All brands",
  liveNow: "Live now",
  liveNowHint: "Events running today",
  upcoming30: "Upcoming (30 days)",
  upcomingHint: "Starting in the next 30 days",
  total: "Total",
  shown: (n: number) => `${n} projects shown`,
  upcoming: "Upcoming",
  noUpcoming: "Nothing starts in the next 30 days.",
  sectionDone: (done: number, total: number) => `${done}/${total}`,
  otherTasks: "Other tasks",
  refusals: {
    archived: "Unarchive the project to change its status.",
    already_exists: "That is already on the list.",
    order_not_found: "No Sales Order has that number.",
    other_project: "This Sales Order is on another project. Remove it there first.",
  } as Record<string, string>,
};

/** Houzs status palette meaning: confirmed green, pending amber, cancelled red (projectStatus.tsx STATUS_TINT). */
export const STATUS_TONE: Record<ProjectStatus, OrderActionTone> = { confirmed: "success", pending: "warning", cancelled: "danger" };

export interface ProjectFilters { status: string; archived: boolean; brand?: string }

export function useProjects(f: ProjectFilters) {
  const qs = new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.archived ? { archived: "1" } : {}), ...(f.brand ? { brand: f.brand } : {}) }).toString();
  return useQuery({
    queryKey: ["projects", "list", f],
    queryFn: () => apiFetch<{ projects: ProjectRow[] }>(`/api/operation/projects${qs ? `?${qs}` : ""}`),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["projects", "one", id],
    enabled: !!id,
    queryFn: () => apiFetch<{ project: ProjectRow; activity: ProjectActivity[]; team: ProjectTeamMember[]; checklist: ChecklistTask[]; stockTransfers?: ProjectStockTransfer[] }>(`/api/operation/projects/${id}`),
  });
}

/** One write helper for every project door, then re-read every project view. */
export function useProjectWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = "POST", body }: { path: string; method?: "POST" | "PATCH" | "DELETE"; body?: unknown }) =>
      apiFetch<{ project?: ProjectRow }>(`/api/operation/projects${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/** PIC choices: the Operation staff list the Service Cases page already reads. */
export function useStaffOptions() {
  return useQuery<{ staff?: Array<{ user_id: string; name: string | null }> }>({
    queryKey: ["operation", "staff"],
    queryFn: () => apiFetch("/api/operation/staff"),
    staleTime: 60_000,
  });
}

/** The refusal's own sentence when the door named it, else its message, else the plain retry line. */
export function refusalOf(error: unknown): string {
  const e = error as { code?: string; message?: string; body?: { code?: string; message?: string } } | null;
  const code = e?.body?.code ?? e?.code;
  return (code && PJ.refusals[code]) || e?.body?.message || PJ.saveFailed;
}

/** Project Maintenance lists (0751); the form picks from the ones in use. */
export function useProjectMasters() {
  return useQuery({
    queryKey: ["projects", "masters"],
    queryFn: () => apiFetch<{ masters: ProjectMaster[] }>("/api/operation/projects/masters"),
    staleTime: 60_000,
  });
}

/** Checklist templates (0752) for Project Maintenance and the detail page. */
export function useChecklistTemplates() {
  return useQuery({
    queryKey: ["projects", "checklist-templates"],
    queryFn: () => apiFetch<{ templates: ChecklistTemplate[] }>("/api/operation/projects/checklist-templates"),
    staleTime: 60_000,
  });
}

/** Sales Orders on one project (0753), cancelled ones included but left out of the totals. */
export function useProjectSalesOrders(id: string) {
  return useQuery({
    queryKey: ["projects", "sales-orders", id],
    queryFn: () => apiFetch<{ orders: ProjectSalesOrder[]; totals: { count: number; total: number; paid: number; balance: number } }>(`/api/operation/projects/${id}/sales-orders`),
  });
}

/** A one-time upload slot in the project's folder of the private stock record bucket (0757). */
export function signStockRecord(projectId: string, file: File) {
  return apiFetch<{ token: string; path: string }>(`/api/operation/projects/${projectId}/stock-transfers/sign`, {
    method: "POST",
    body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
  });
}

/** Opens a transfer sheet through a short-lived signed link. */
export async function openStockRecord(path: string) {
  const { url } = await apiFetch<{ url: string }>(`/api/operation/projects/stock-transfers/file?path=${encodeURIComponent(path)}`);
  window.open(url, "_blank", "noopener");
}
