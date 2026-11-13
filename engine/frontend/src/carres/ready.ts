// Carres only (not part of Houzs's code): telling the portal when this app is ready, or signed out.
//
// The portal keeps its own loading skeleton over the frame while this app boots (no splash of ours on top:
// auth/AuthGate.tsx renders nothing while embedded and loading), and shows the frame when it hears
// { type: "carres:ready" } — sent once, when the first page inside <main> has drawn (the route's
// PageSkeleton, aria-label "Loading page", is gone). If the session the portal handed over is refused, this
// app says { type: "carres:signed-out" } and the portal hands over a new one
// (apps/web/src/pages/operation/SupplyChainEngine.tsx).
import { carresPortalOrigin } from "./embed";

/** The route fallback (components/RouteFallback.tsx PageSkeleton) while a page's code downloads. */
const ROUTE_LOADING = '[aria-label="Loading page"]';

/** The first page has drawn: the layout's <main> holds something, and it is not the route's loading shape. On a
 *  phone Houzs's phone app has no <main>: its shell (`.hz-m`, mobile/MobileApp.tsx) holding something counts. */
export function firstPageDrawn(root: ParentNode): boolean {
  const phone = root.querySelector(".hz-m");
  if (phone && phone.childElementCount > 0) return true;
  const main = root.querySelector("main");
  return !!main && main.childElementCount > 0 && !main.querySelector(ROUTE_LOADING);
}

function post(message: { type: string }, origin = carresPortalOrigin()): void {
  if (origin) window.parent.postMessage(message, origin);
}

/** Watches the page and sends carres:ready once the first page has drawn. Only inside the portal. */
export function reportCarresReady(root: HTMLElement | null = document.getElementById("root"), origin = carresPortalOrigin()): () => void {
  if (!origin || !root) return () => {};
  let done = false;
  let observer: MutationObserver | null = null;
  const check = () => {
    if (done || !firstPageDrawn(root)) return;
    done = true;
    observer?.disconnect();
    // A task later, so the browser paints what React just committed before the portal reveals it. Not a
    // requestAnimationFrame: the frame is see-through until then and a browser may hold back its frames.
    setTimeout(() => post({ type: "carres:ready" }, origin), 0);
  };
  observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
  check();
  return () => { done = true; observer?.disconnect(); };
}

let signedOutSent = false;

/** The session was refused (no signed-in person after the check). Told once per page load. */
export function reportCarresSignedOut(): void {
  if (signedOutSent) return;
  signedOutSent = true;
  post({ type: "carres:signed-out" });
}
