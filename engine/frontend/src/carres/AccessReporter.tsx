// Carres only (not part of Houzs's code): which menu pages this person may open, for the portal's menu.
//
// Permissions follow Houzs (owner, 16 Nov 2026: "全部都跟着Houzs ERP去弄permission"). Houzs's menu shows a page
// only when the person's Team role allows it (makeNavFilter). Inside the portal this app draws no menu, so it
// hands the portal the addresses of every page that same filter keeps ({ type: "carres:access", paths }), and
// the portal's menu shows exactly those.
import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { NAV_TABS, type NavTab } from "../components/Sidebar";
import { makeNavFilter } from "../components/navFilter";
import { useItSupportConnected, withoutUnconnectedItSupport } from "../hooks/useItSupportConnected";
import { carresPortalOrigin } from "./embed";

/** Every address in the kept menu, groups included. */
export function accessPaths(tabs: readonly NavTab[]): string[] {
  const out = new Set<string>();
  const walk = (list: readonly NavTab[]) => {
    for (const t of list) {
      if (t.to) out.add(t.to);
      if (t.children) walk(t.children);
    }
  };
  walk(tabs);
  return [...out].sort();
}

export function CarresAccessReporter() {
  const { user, can, pageAccess } = useAuth();
  const itSupportConnected = useItSupportConnected();
  const filterTab = makeNavFilter({ user, can, pageAccess });
  const visible = withoutUnconnectedItSupport(
    NAV_TABS.map(filterTab).filter((t): t is NavTab => t !== null),
    itSupportConnected,
  );
  /* `all` is every address the menu can hold, so the portal can tell "not allowed" from "a page Houzs's menu
     does not list" (a portal row the engine menu does not know is left to the page itself). */
  const key = user ? JSON.stringify({ paths: accessPaths(visible), all: accessPaths(NAV_TABS) }) : "";
  useEffect(() => {
    const portal = carresPortalOrigin();
    if (portal && key) window.parent.postMessage({ type: "carres:access", ...JSON.parse(key) }, portal);
  }, [key]);
  return null;
}
