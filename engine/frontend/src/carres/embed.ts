// Carres only (not part of Houzs's code): running inside the Carres portal.
//
// The Carres portal shows these screens in a frame under its own menu. It signs the person in on their behalf
// and hands the session over in the address fragment (never sent to a server, removed at once). Inside the frame
// this app keeps its own menu (trimmed to Supply Chain and Service Cases, navOnly.ts) and drops its top bars:
// the portal's header is the one people see.
import { tokenStore, passStore } from "../api/client";
import "./embed.css";

/** Pages allowed to hold this app in a frame and steer it: the portal, its pr-N previews, and local dev. */
const PARENTS = [
  /^https:\/\/([a-z0-9-]+\.)?carres-portal\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
export const trusted = (origin: string) => PARENTS.some((p) => p.test(origin));

export const CARRES_EMBEDDED: boolean = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

// Inside the frame this app's own top bars are not drawn (Layout.tsx); embed.css keys off this class.
if (CARRES_EMBEDDED) {
  try { document.documentElement.classList.add("carres-embedded"); } catch { /* no document */ }
}

/** Takes the hand-over from the address fragment: #carres=<base64url of {t, sp?, p}>. */
export function consumeCarresSignIn(): void {
  const m = /^#carres=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!m) return;
  try {
    const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const { t, sp, p } = JSON.parse(json) as { t?: string; sp?: string; p?: string };
    // Session storage: the hand-over is repeated on every visit, so nothing needs to outlive the tab.
    if (t) tokenStore.set(t, false);
    if (t && sp) passStore.set(sp, false);
    const path = typeof p === "string" && p.startsWith("/") && !p.startsWith("//") ? p : "/";
    window.history.replaceState(null, "", path);
  } catch {
    window.history.replaceState(null, "", "/");
  }
}

/** The portal page holding the frame, once known: the only page told where the frame is, since the
 *  address can name a record. */
let parentOrigin = (() => {
  try {
    const o = document.referrer ? new URL(document.referrer).origin : "";
    return trusted(o) ? o : "";
  } catch { return ""; }
})();
const here = () => window.location.pathname + window.location.search;
const tellLocation = () => {
  if (!parentOrigin) return;
  try { window.parent.postMessage({ type: "carres:location", path: here() }, parentOrigin); } catch { /* no parent */ }
};

/** Follows the portal's menu: { type: "carres:navigate", path } moves this app without reloading it.
 *  Tells the portal where it is after every move ({ type: "carres:location", path }). */
export function listenForCarresNavigation(): void {
  if (!CARRES_EMBEDDED) return;
  window.addEventListener("message", (e: MessageEvent) => {
    if (!trusted(e.origin)) return;
    parentOrigin = e.origin;
    const d = e.data as { type?: string; path?: string } | null;
    if (d?.type !== "carres:navigate" || typeof d.path !== "string" || !d.path.startsWith("/") || d.path.startsWith("//")) return;
    if (d.path !== here()) window.history.pushState(null, "", d.path);
    // Also on the same address: the phone screens keep the open record out of the address, so this takes them
    // back to the menu item's own screen.
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // The router moves with pushState / replaceState, which raise no event of their own.
  for (const k of ["pushState", "replaceState"] as const) {
    const move = window.history[k].bind(window.history);
    window.history[k] = (...args: Parameters<History["pushState"]>) => { move(...args); tellLocation(); };
  }
  window.addEventListener("popstate", tellLocation);
  // Lets the portal know the frame is ready to be steered.
  try { window.parent.postMessage({ type: "carres:ready" }, "*"); } catch { /* no parent */ }
  // And when a screen is on view, so the portal keeps its loading message up until then.
  const shown = window.setInterval(() => {
    const main = document.querySelector("main");
    if (!main || (main.textContent ?? "").trim().length < 20) return;
    window.clearInterval(shown);
    try { window.parent.postMessage({ type: "carres:shown" }, "*"); } catch { /* no parent */ }
  }, 150);
}
