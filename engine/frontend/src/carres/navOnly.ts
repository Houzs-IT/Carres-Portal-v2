// Carres only (not part of Houzs's code). The Carres copy of this engine is Supply Chain and Service Cases,
// opened from the Carres portal's own menu (owner, 6 Nov 2026). Projects joined on 11 Nov 2026 (the engine replaces
// the Carres Projects pages). Finance joined on 11 Nov 2026 (owner: bring Houzs's whole Finance in; the Carres
// Finance moves to the bottom of the portal menu).
// Everything that builds a menu reads the registry in components/Sidebar.tsx, so trimming it here keeps the
// desktop rail, the mobile menu and the hub pages in agreement.

/** Top-level menu entries kept, by their label in the registry: all of Houzs's except the modules the owner removed
 *  (HR, AutoCount Sync, POS Admin) and Venture Portal Feed (Houzs's feed to an outside partner, which Carres does not
 *  have). Same as Houzs (owner, 11 Nov 2026: "same as Houzs except colour"); each entry keeps Houzs's own permission
 *  gate, so a person still sees only what their role opens. The workspace tabs, search, hub pages and the Finance
 *  report list read this, so a page left out here was missing from them even when the portal opened it. */
const KEEP = new Set([
  "Overview", "Sales Orders", "Payment Requests", "Service Cases", "Projects", "Supply Chain", "Finance",
  "Mail Center", "Announcements", "Team", "IT", "Change Log", "Assistant", "Agent Console", "IT Support", "OCR",
  "Settings",
]);

/** Houzs modules switched off here: their menu entries are dropped and their addresses go to CARRES_HOME
 *  (App.tsx). Path prefixes, matched on whole segments. HR stays off (Carres keeps people in Team); the
 *  Forecast P&L and the finance Dashboard are Finance reports and are on with Finance (11 Nov 2026). */
export const CARRES_HIDDEN_PATHS: readonly string[] = [
  "/scm/hr",
  "/autocount-sync", "/pos-admin",
  // No fairs at Carres: every order is a Showroom or a Project (owner, 13 Nov 2026), so nothing waits on a fair link.
  "/scm/fair-pending",
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

/** The AI assistant button, as in Houzs. Without ANTHROPIC_API_KEY it still opens and answers that it needs an AI key
 *  (services/assistant.ts), the same as Houzs's staging. */
export const CARRES_EXTRAS: boolean = true;
