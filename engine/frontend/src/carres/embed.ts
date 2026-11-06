// Carres only (not part of Houzs's code): running inside the Carres portal.
//
// The portal shows these screens in a frame and signs the person in on their behalf: the session arrives in the
// address fragment (never sent to a server) and is removed from the address at once. Inside the frame this app
// keeps its own menu (navOnly.ts) and drops its top bars, since the portal's header is already on screen.
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
