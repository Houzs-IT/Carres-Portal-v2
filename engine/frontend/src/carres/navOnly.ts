// Carres only (not part of Houzs's code). The Carres copy of this engine is Supply Chain and Service Cases,
// opened from the Carres portal's own menu (owner, 6 Nov 2026). Projects joined on 11 Nov 2026 (the engine replaces
// the Carres Projects pages); Carres keeps its own Finance.
// Everything that builds a menu reads the registry in components/Sidebar.tsx, so trimming it here keeps the
// desktop rail, the mobile menu and the hub pages in agreement.

/** Top-level menu entries kept, by their label in the registry. Sales Orders stay: the supply chain starts
 *  from them. Team and Settings stay so an administrator can set people and company details. */
const KEEP = new Set(["Sales Orders", "Service Cases", "Projects", "Supply Chain", "Team", "Settings"]);

/** Houzs modules switched off here: their menu entries are dropped and their addresses go to CARRES_HOME
 *  (App.tsx). Path prefixes, matched on whole segments. */
export const CARRES_HIDDEN_PATHS: readonly string[] = [
  "/scm/forecast", "/scm/finance-dashboard", "/scm/hr",
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

/** No AutoCount in the Carres engine: Settings drops its Sync tab and never asks for that status. */
export const CARRES_AUTOCOUNT: boolean = false;

/** Where the app opens: the old landing page is an overview of areas switched off here. */
export const CARRES_HOME = "/scm/sales-orders";

/** The floating quick-add button and the AI assistant: off (the assistant needs a key this copy does not have). */
export const CARRES_EXTRAS: boolean = false;
