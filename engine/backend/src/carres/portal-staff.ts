// Carres only (not part of Houzs's code): Team keeps the person's Carres PORTAL login in step.
//
// Staff sign in to the Carres portal (erp.carresofficial.com); this engine's identity is linked by email on their
// first visit (./sso.ts). So when Team > Invite Member adds someone, the login that matters is the portal's, and
// "Set a new password" / "Disable account" must reach it too (owner, 14 Nov 2026: one place to add people = Team).
//
// The portal side is apps/api/src/routes/engine-staff-accounts.ts. Trust is the secret the two Workers already share
// for single sign-on (CARRES_SSO_SECRET here, SCM_ENGINE_SSO_SECRET there): every call carries an HMAC-SHA256 over
// `staff-accounts.<ts>.<raw body>`. The portal derives the role itself and refuses principal, store, supplier and
// partner accounts. A password travels only inside the signed body to the portal: never logged, never returned.
import type { Env } from "../types";

export type PortalStaffEnv = Env & {
  CARRES_SSO_SECRET?: string;
  /** The Carres portal API origin (wrangler.toml [vars]). */
  CARRES_PORTAL_API?: string;
  /** The Carres portal API Worker (service binding): a public call between two Workers of one account can be refused. */
  CARRES_PORTAL?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
};

/** On when the shared secret and a way to reach the portal both exist. Off (Houzs's own behaviour) otherwise. */
export function portalStaffEnabled(env: Env): boolean {
  const e = env as PortalStaffEnv;
  return !!e.CARRES_SSO_SECRET && e.CARRES_SSO_SECRET.length >= 32 && !!(e.CARRES_PORTAL || e.CARRES_PORTAL_API);
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signPortalStaffBody(secret: string, body: string, now = Date.now()): Promise<{ ts: string; signature: string }> {
  const ts = String(now);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ts, signature: b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`staff-accounts.${ts}.${body}`))) };
}

export type PortalResult<T = Record<string, unknown>> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string };

const UNREACHABLE = "The Carres portal could not be reached, so nothing was changed. Try again in a moment.";

async function callPortal<T>(env: Env, path: "" | "/password" | "/status", payload: object): Promise<PortalResult<T>> {
  const e = env as PortalStaffEnv;
  const base = (e.CARRES_PORTAL_API || "https://api.carresofficial.com").replace(/\/+$/, "");
  const body = JSON.stringify(payload);
  const { ts, signature } = await signPortalStaffBody(e.CARRES_SSO_SECRET as string, body);
  let res: Response;
  try {
    const call = e.CARRES_PORTAL ? e.CARRES_PORTAL.fetch.bind(e.CARRES_PORTAL) : fetch;
    res = await call(`${base}/engine/staff-accounts${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-carres-engine-ts": ts, "x-carres-engine-signature": signature },
      body,
    });
  } catch {
    return { ok: false, status: 502, error: UNREACHABLE };
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (res.ok && json) return { ok: true, status: res.status, body: json };
  const message = json?.message ? `Carres portal: ${json.message}` : UNREACHABLE;
  // The portal's own refusals pass through as the operator's answer; anything else is "could not reach".
  const status = res.status === 422 ? 400 : res.status === 403 || res.status === 404 || res.status === 409 ? res.status : 502;
  return { ok: false, status, error: message };
}

export interface PortalCreated { status: "created" | "existing"; userId: string; role: string; delivery?: "invite" | "password"; emailSent?: boolean }

/** Create the person's portal login, or link the one that already has this email. */
export function createPortalStaffAccount(env: Env, input: {
  email: string; name: string | null; department: string | null; title: string | null;
  delivery: "invite" | "password"; password?: string; actor?: string | null;
}): Promise<PortalResult<PortalCreated>> {
  return callPortal<PortalCreated>(env, "", input);
}

export function setPortalStaffPassword(env: Env, input: { email: string; password: string; actor?: string | null }): Promise<PortalResult> {
  return callPortal(env, "/password", input);
}

export function setPortalStaffStatus(env: Env, input: {
  email: string; status: "active" | "disabled"; reason?: string | null; actor?: string | null;
}): Promise<PortalResult> {
  return callPortal(env, "/status", input);
}
