/**
 * A finance line's project (0754, Houzs event-books): the line picker and the
 * name. Finance and the principal read the list through /api/finance/projects.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoneyRow } from "@carres/shared/project-money";
import { controlClass } from "@/components/kit/field-recipe";
import { apiFetch } from "@/lib/api";

export interface ProjectOption { id: string; code: string; name: string; archived: boolean }

export function useProjectOptions() {
  return useQuery({
    queryKey: ["finance", "projects", "options"] as const,
    queryFn: async () => (await apiFetch<{ rows: ProjectOption[] }>("/api/finance/projects/options")).rows ?? [],
    staleTime: 5 * 60_000,
  });
}

/** Finance sets Needs project and the row an account fills (Houzs event-accounts.ts). */
export function useSetAccountProject() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { code: string; needsProject: boolean; projectRow: MoneyRow | null }>({
    mutationFn: ({ code, ...input }) => apiFetch(`/api/finance/projects/accounts/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

/** Line picker: one project, or none. An archived project stays pickable only when the line already has it. */
export function ProjectPicker({ id, onChange, label, className }: {
  id: string | null | undefined; onChange: (projectId: string | null) => void; label: string; className?: string;
}) {
  const projects = useProjectOptions();
  const rows = (projects.data ?? []).filter((p) => !p.archived || p.id === id);
  return <select aria-label={label} className={className ?? controlClass(false, "single")} value={id ?? ""}
    onChange={(e) => onChange(e.target.value || null)}>
    <option value="">{projects.isError && !projects.data ? "Projects could not be loaded" : "No project"}</option>
    {rows.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
  </select>;
}

/** A stored line project as its code; nothing when the line has none. */
export function ProjectName({ id }: { id?: string | null }) {
  const { data = [] } = useProjectOptions();
  if (!id) return null;
  return <>{data.find((p) => p.id === id)?.code ?? "A project"}</>;
}
