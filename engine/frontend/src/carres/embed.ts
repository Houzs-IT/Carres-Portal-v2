// Carres only (not part of Houzs's code): running inside the Carres portal.
//
// The portal shows these screens in a frame and signs the person in on their behalf: the session arrives in the
// address fragment (never sent to a server) and is removed from the address at once. Inside the frame this app
// draws no menu or top bar of its own: the portal's sidebar picks the page (followCarresMenu) and its header is on screen.
import { tokenStore, passStore } from "../api/client";
import "./embed.css";

export const CARRES_EMBEDDED: boolean = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

// Layout.tsx skips the top bars when embedded; embed.css keys off this class.
if (CARRES_EMBEDDED) document.documentElement.classList.add("carres-embedded");

/** Takes the hand-over from the address fragment: #carres=<base64url of {t, sp?, p}>. */
export function consumeCarresSignIn(): void {
  const m = /^#carres=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!m) return;
  let path = "/";
  try {
    const { t, sp, p } = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))) as { t?: string; sp?: string; p?: string };
    // Session storage only: the portal hands over a fresh session on every visit.
    if (t) tokenStore.set(t, false);
    if (t && sp) passStore.set(sp, false);
    if (typeof p === "string" && p.startsWith("/") && !p.startsWith("//")) path = p;
  } catch { /* a broken hand-over just opens the sign-in screen */ }
  window.history.replaceState(null, "", path);
}

/** Pages allowed to steer the frame: the portal, its pr-N previews, and local dev. */
const PORTAL = /^(https:\/\/([a-z0-9-]+\.)?carres-portal\.pages\.dev|https:\/\/erp\.carresofficial\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** The portal's menu picks the page: { type: "carres:navigate", path } moves this app without reloading it. */
export function followCarresMenu(): void {
  if (!CARRES_EMBEDDED) return;
  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; path?: unknown } | null;
    if (!PORTAL.test(e.origin) || d?.type !== "carres:navigate") return;
    if (typeof d.path !== "string" || !d.path.startsWith("/") || d.path.startsWith("//")) return;
    window.history.pushState(null, "", d.path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

/** The portal shows which page the frame is on: every move inside this app (a link, a button, Back) is told
 *  to the portal as { type: "carres:location", path }, so its menu lights the right row and its address can
 *  reopen the same page after a refresh. Sent only to the portal that framed this app (the referrer, if it
 *  is an allowed portal address). */
export function reportCarresLocation(): void {
  if (!CARRES_EMBEDDED) return;
  let portal: string | null = null;
  try { portal = document.referrer ? new URL(document.referrer).origin : null; } catch { portal = null; }
  if (!portal || !PORTAL.test(portal)) return;
  const target = portal;
  let last = "";
  const send = () => {
    const path = window.location.pathname + window.location.search;
    if (path === last) return;
    last = path;
    window.parent.postMessage({ type: "carres:location", path }, target);
  };
  for (const name of ["pushState", "replaceState"] as const) {
    const original = window.history[name].bind(window.history);
    window.history[name] = ((...args: Parameters<History["pushState"]>) => {
      original(...args);
      queueMicrotask(send);
    }) as History["pushState"];
  }
  window.addEventListener("popstate", send);
  send();
}

/** The portal that framed this app (the referrer, if it is an allowed portal address); null otherwise. */
export function carresPortalOrigin(): string | null {
  if (!CARRES_EMBEDDED) return null;
  try {
    const origin = document.referrer ? new URL(document.referrer).origin : null;
    return origin && PORTAL.test(origin) ? origin : null;
  } catch { return null; }
}
