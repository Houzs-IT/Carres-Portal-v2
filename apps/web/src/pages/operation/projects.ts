import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectActivity, ProjectRow, ProjectStage, ProjectStatus } from "@carres/shared/projects";
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
  } as Record<string, string>,
  refusals: {
    archived: "Unarchive the project to change its status.",
    already_exists: "That code is already used. Change the venue or date and save again.",
  } as Record<string, string>,
};

/** Houzs status palette meaning: confirmed green, pending amber, cancelled red (projectStatus.tsx STATUS_TINT). */
export const STATUS_TONE: Record<ProjectStatus, OrderActionTone> = { confirmed: "success", pending: "warning", cancelled: "danger" };

export interface ProjectFilters { status: string; archived: boolean }

export function useProjects(f: ProjectFilters) {
  const qs = new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.archived ? { archived: "1" } : {}) }).toString();
  return useQuery({
    queryKey: ["projects", "list", f],
    queryFn: () => apiFetch<{ projects: ProjectRow[] }>(`/api/operation/projects${qs ? `?${qs}` : ""}`),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["projects", "one", id],
    enabled: !!id,
    queryFn: () => apiFetch<{ project: ProjectRow; activity: ProjectActivity[] }>(`/api/operation/projects/${id}`),
  });
}

/** One write helper for every project door, then re-read every project view. */
export function useProjectWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = "POST", body }: { path: string; method?: "POST" | "PATCH"; body?: unknown }) =>
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
