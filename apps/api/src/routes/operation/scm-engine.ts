import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SupplierAsk, SupplierAsksResponse } from "@carres/shared";
import type { AppEnv } from "../../types";

/**
 * Supply Chain and Service Cases screens come from the engine: the supply chain code run as its own Worker and
 * site on Carres's Cloudflare, with its own database (engine/, docs/engine.md). POST /session signs the person
 * in there on their behalf, so the screens open inside the portal with no second sign-in. The shared secret
 * stays between the two Workers; the browser only gets the engine's session.
 */
const router = new Hono<AppEnv>();

const NOT_SET_UP = "Supply Chain is not set up on this environment yet.";
const UNREACHABLE = "Supply Chain could not be reached. Try again in a moment.";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A 45-second statement of who is signed in, signed with the secret only the two Workers hold
 *  (checked by engine/backend/src/carres/sso.ts). */
export async function engineAssertion(secret: string, who: { email: string; role: string }, now = Date.now()): Promise<string> {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify({ email: who.email, role: who.role, exp: now + 45_000 })));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`;
}

/** Operations staff and the principal; `hr`, whose portal menu now holds Houzs's Team, Mail Center and IT
 *  Support; and `finance`, whose portal menu now holds Houzs's Finance (owner, 11 Nov 2026). The engine decides again (engine/backend/src/carres/sso.ts ENGINE_ROLES)
 *  and gives a new person no pages until the owner picks their role there. */
const ENGINE_ROLES = new Set(["operation", "principal", "hr", "finance"]);
const requireEngineRole: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!ENGINE_ROLES.has(c.var.auth?.role ?? "")) throw new HTTPException(403, { message: "operation, Principal, HR or Finance only" });
  await next();
};

router.post("/session", requireEngineRole, async (c) => {
  const api = c.env.SCM_ENGINE_API, site = c.env.SCM_ENGINE_SITE, secret = c.env.SCM_ENGINE_SSO_SECRET;
  if (!api || !site || !secret) return c.json({ error: "not_set_up", message: NOT_SET_UP }, 501);
  const auth = c.var.auth;
  let res: Response;
  try {
    // Through the service binding when there is one: a public workers.dev call between two Workers of one
    // account is refused by Cloudflare.
    const call = c.env.SCM_ENGINE ? c.env.SCM_ENGINE.fetch.bind(c.env.SCM_ENGINE) : fetch;
    res = await call(`${api.replace(/\/+$/, "")}/api/carres-sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assertion: await engineAssertion(secret, { email: auth.email, role: auth.role }) }),
    });
  } catch {
    return c.json({ error: "engine_unreachable", message: UNREACHABLE }, 502);
  }
  const body = (await res.json().catch(() => null)) as { token?: string; session_pass?: string; error?: string } | null;
  if (res.status === 403) return c.json({ error: "forbidden", message: body?.error ?? "Your account does not have access to Supply Chain." }, 403);
  if (!res.ok || !body?.token) return c.json({ error: "engine_refused", message: UNREACHABLE }, 502);
  return c.json({ site: site.replace(/\/+$/, ""), token: body.token, sessionPass: body.session_pass ?? null });
});

/**
 * A call from this server to the engine that no person makes: `<purpose>.<ts>.<body>` signed under the same shared
 * secret. The purpose word keeps it from passing as a sign-on assertion, and the engine takes it for one minute
 * (engine/backend/src/carres/supplier/portal-asks.ts verifyPortalRequest).
 */
export async function signEngineCall(secret: string, purpose: string, body: string, now = Date.now()): Promise<{ ts: string; signature: string }> {
  const ts = String(now);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ts, signature: b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`${purpose}.${ts}.${body}`))) };
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The engine's answer kept to what the bell shows: anything else in it is dropped, and a malformed one reads as none. */
export function pickSupplierAsks(raw: unknown): SupplierAsksResponse {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const asks = (Array.isArray(r.asks) ? r.asks : []).flatMap((a): SupplierAsk[] => {
    const x = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const kind = x.kind === "cancel" ? "cancel" : x.kind === "date" ? "date" : null;
    if (!kind || !text(x.id) || !text(x.requestNo)) return [];
    return [{
      id: text(x.id), requestNo: text(x.requestNo), supplierName: text(x.supplierName), kind,
      askDate: text(x.askDate) || null, expectedDate: text(x.expectedDate), askedAt: text(x.askedAt),
    }];
  });
  const count = typeof r.count === "number" && Number.isFinite(r.count) ? Math.max(Math.trunc(r.count), asks.length) : asks.length;
  return { count, asks };
}

/** A supplier's ask waits for Carres (engine Supplier Pickups); the people who answer it see it on their Alerts bell
 *  (owner, 17 Nov 2026). */
const ASK_READERS = new Set(["operation", "principal"]);

router.get("/supplier-asks", async (c) => {
  if (!ASK_READERS.has(c.var.auth?.role ?? "")) throw new HTTPException(403, { message: "operation or Principal only" });
  const api = c.env.SCM_ENGINE_API, secret = c.env.SCM_ENGINE_SSO_SECRET;
  if (!api || !secret) return c.json({ error: "not_set_up", message: NOT_SET_UP }, 501);
  const body = "{}";
  const { ts, signature } = await signEngineCall(secret, "supplier-asks", body);
  let res: Response;
  try {
    const call = c.env.SCM_ENGINE ? c.env.SCM_ENGINE.fetch.bind(c.env.SCM_ENGINE) : fetch;
    res = await call(`${api.replace(/\/+$/, "")}/api/carres-portal/supplier-asks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-carres-portal-ts": ts, "x-carres-portal-signature": signature },
      body,
    });
  } catch {
    return c.json({ error: "engine_unreachable", message: UNREACHABLE }, 502);
  }
  if (!res.ok) return c.json({ error: "engine_refused", message: UNREACHABLE }, 502);
  return c.json(pickSupplierAsks(await res.json().catch(() => null)));
});

export default router;
