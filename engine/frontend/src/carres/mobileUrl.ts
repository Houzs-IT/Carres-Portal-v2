// Carres only (not part of Houzs's code): Houzs's phone app inside the portal keeps the address in step.
//
// Houzs's phone app (mobile/MobileApp.tsx) is a screen machine that reads the address once, when it opens. In the
// portal the address is how the portal knows the page: every move is told to it (carres:location, embed.ts
// reportCarresLocation) so a refresh reopens the same page, Back works, and its menu lights the right row; and the
// portal's menu moves this app by address (carres:navigate, embed.ts followCarresMenu). So inside the portal the
// screen writes its address as the person moves, and an address change (Back, the portal's menu) opens its screen.
// Outside the portal nothing here runs: Houzs's phone app is unchanged.
import { useEffect, useRef } from "react";
import { CARRES_EMBEDDED } from "./embed";

export type CarresTab = "orders" | "service" | "calendar" | "profile";
type ScreenLike = { t: string; key?: string; docNo?: string };
type Destination = { to: string; label: string };

/** The address of each bottom tab. Calendar is Houzs's Projects calendar, Service its Service Cases. */
const TAB_PATHS: Record<CarresTab, string> = {
  orders: "/scm/sales-orders",
  service: "/assr",
  calendar: "/projects?view=calendar",
  profile: "/profile",
};

/** The bottom tab an address names that the phone app's own address reading does not (mobile/mobileRoute.ts opens
 *  /projects as Projects and /assr as an overlay); null for every other address. */
export function carresTabFor(location: string): CarresTab | null {
  const [path, query = ""] = location.split("#")[0].split("?");
  if (path === "/assr" || path === "/assr/") return "service";
  if ((path === "/projects" || path === "/projects/") && new URLSearchParams(query).get("view") === "calendar") return "calendar";
  return null;
}

/**
 * The address of the screen on show, or null to leave the address as it is (a screen with no address of its own:
 * Scan, Search, a form opened from a list keeps its list's address via `key`).
 * @param destinations every destination the phone app implements (its Menu and Profile rows)
 * @param toScreen     the phone app's own address → screen mapping (MobileApp destinationScreen)
 */
export function carresScreenPath(
  tab: CarresTab,
  screen: ScreenLike,
  destinations: readonly Destination[],
  toScreen: (to: string, label: string) => ScreenLike,
): string | null {
  if (screen.t === "tab") return TAB_PATHS[tab];
  if (screen.t === "so-detail" && screen.docNo) return `/scm/sales-orders/${encodeURIComponent(screen.docNo)}`;
  if (screen.t === "stub") return null;
  // A module's list, record, form or create screen: the module's own address.
  if (screen.key) return destinations.find((d) => toScreen(d.to, d.label).key === screen.key)?.to ?? null;
  return destinations.find((d) => {
    const s = toScreen(d.to, d.label);
    return s.t === screen.t && !s.key;
  })?.to ?? null;
}

/**
 * Inside the portal: writes `path` to the address when the screen changes (so embed.ts tells the portal), and
 * calls `open` with the address when it changes from outside (Back, the portal's menu). Also calls `open` once at
 * the start for an address only `carresTabFor` reads, so a refresh on the Calendar tab reopens it.
 */
export function useCarresMobileUrl(path: string | null, open: (location: string) => void): void {
  const started = useRef(false);
  // A screen opened FROM the address (Back, the portal's menu) corrects the address in place, never adds a step:
  // a new step there would make Back land on it again.
  const fromAddress = useRef(false);
  const opener = useRef<(location: string) => void>(open);
  opener.current = (location: string) => { fromAddress.current = true; open(location); };

  useEffect(() => {
    if (!CARRES_EMBEDDED) return;
    const here = () => window.location.pathname + window.location.search;
    const onPop = () => opener.current(here());
    window.addEventListener("popstate", onPop);
    if (carresTabFor(here())) opener.current(here());
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!CARRES_EMBEDDED) return;
    // The first screen came from the address: nothing to write.
    if (!started.current) { started.current = true; return; }
    if (path == null || path === window.location.pathname + window.location.search) return;
    if (fromAddress.current) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
  }, [path]);

  // After the render that follows an address change, moves are the person's own again.
  useEffect(() => { fromAddress.current = false; });
}
