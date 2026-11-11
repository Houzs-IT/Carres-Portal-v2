// Carres only (not part of Houzs's code). The Carres copy of this engine is Supply Chain and Service Cases,
// opened from the Carres portal's own menu (owner, 6 Nov 2026). Projects joined on 11 Nov 2026 (the engine replaces
// the Carres Projects pages). Finance joined on 11 Nov 2026 (owner: bring Houzs's whole Finance in; the Carres
// Finance moves to the bottom of the portal menu).
// Everything that builds a menu reads the registry in components/Sidebar.tsx, so trimming it here keeps the
// desktop rail, the mobile menu and the hub pages in agreement.

/** Top-level menu entries kept, by their label in the registry. Sales Orders stay: the supply chain starts
 *  from them. Team and Settings stay so an administrator can set people and company details. */
const KEEP = new Set(["Overview", "Sales Orders", "Service Cases", "Projects", "Supply Chain", "Finance", "Team", "Settings"]);

/** Houzs modules switched off here: their menu entries are dropped and their addresses go to CARRES_HOME
 *  (App.tsx). Path prefixes, matched on whole segments. HR stays off (Carres keeps people in Team); the
 *  Forecast P&L and the finance Dashboard are Finance reports and are on with Finance (11 Nov 2026). */
export const CARRES_HIDDEN_PATHS: readonly string[] = [
  "/scm/hr",
  "/autocount-sync", "/pos-admin",
];

/** True when this address (a path, or a menu `to` with a query) belongs to a switched-off module. */
export function isCarresHiddenPath(to: string | undefined | null): boolean {
  if (!to) return false;
  const path = to.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return CARRES_HIDDEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

type NavNode = { label: string; to?: string; children?: NavNode[] };

/** Drop switched-off entries at every depth; a group left with no entries goes too. */
function pruneHidden<T extends NavNode>(tabs: T[]): T[] {
  const out: T[] = [];
  for (const t of tabs) {
    if (isCarresHiddenPath(t.to)) continue;
    if (t.children) {
      const children = pruneHidden(t.children);
      if (children.length === 0) continue;
      out.push({ ...t, children });
    } else {
      out.push(t);
    }
  }
  return out;
}

export function carresNavOnly<T extends NavNode>(tabs: T[]): T[] {
  return pruneHidden(tabs.filter((t) => KEEP.has(t.label)));
}

/** No AutoCount in the Carres engine: the Worker does not serve /api/sync/*, so Settings drops its Sync tab
 *  and never asks for that status (showing it only produced an error). Everything else in Settings is Houzs's. */
export const CARRES_AUTOCOUNT: boolean = false;

/** Where a switched-off module's address goes. The landing page itself is Houzs's Overview, as in Houzs. */
export const CARRES_HOME = "/scm/sales-orders";

/** The floating quick-add button and the AI assistant: off (the assistant needs a key this copy does not have). */
export const CARRES_EXTRAS: boolean = false;
