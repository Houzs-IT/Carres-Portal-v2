// Carres only (not part of Houzs's code): one place to sign in (owner, 14 Nov 2026: "login portal 可以用回旧的").
//
// Staff sign in on the Carres portal (erp.carresofficial.com/login), which then opens these pages for them in its
// frame. Someone who opens this app's own address while signed out is sent there instead of Houzs's sign-in screen.
// Houzs's screen stays reachable at `#engine-login` (a driver or helper signing in with staff code and PIN), and the
// invite and forgot-password links keep their own screens.

export const CARRES_PORTAL_LOGIN = "https://erp.carresofficial.com/login";

/** True when a signed-out visit should go to the portal's sign-in instead of this app's. */
export function sendSignInToPortal(embedded: boolean, hash: string, hostname: string): boolean {
  if (embedded) return false; // inside the portal: the portal hands over a new session (carres/ready.ts)
  if (hash === "#engine-login" || hash === "#forgot" || hash.startsWith("#invite=")) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return false; // local development keeps its own screen
  return true;
}
