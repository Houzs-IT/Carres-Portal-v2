// Carres only (not part of Houzs's code): single sign-on from the Carres portal.
//
// The portal already knows who is signed in. Its API asks this endpoint for an engine session on that person's
// behalf, proving the request is its own with an HMAC over a short-lived assertion. The browser never sees the
// shared secret, and nobody types a second password. The engine account is found by email and created on first
// use, so staff are managed in one place: the Carres portal.
import { Hono } from "hono";
import type { Env } from "../types";
import { createSession, mintSessionPass } from "../services/auth";

type CarresEnv = Env & { CARRES_SSO_SECRET?: string };
interface Assertion { email: string; role: string; exp: number }

const MAX_AGE_MS = 60_000;
/** Carres portal roles that open Supply Chain and Service Cases. Kept in step with the portal's own gate
 *  (apps/api/src/routes/operation/scm-engine.ts). */
export const ENGINE_ROLES = new Set(["operation", "principal"]);

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function verifyAssertion(secret: string, token: string, now = Date.now()): Promise<Assertion | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", key, fromB64url(sig), new TextEncoder().encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const a = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Assertion;
    if (!a.email || typeof a.role !== "string" || typeof a.exp !== "number" || a.exp < now || a.exp > now + MAX_AGE_MS) return null;
    return a;
  } catch { return null; }
}

/** The full-access role, made the first time on a new instance (it starts with no roles).
 *  shortcut: every admitted Carres role gets full access in the engine; split by role once Carres staff need
 *  narrower supply chain access. */
async function fullRoleId(env: Env): Promise<number | null> {
  const find = () => env.DB.prepare(`SELECT id FROM roles WHERE permissions LIKE '%"*"%' ORDER BY id LIMIT 1`).first<{ id: number }>();
  let r = await find();
  if (!r) {
    await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 1, 0)`)
      .bind("Owner", "Full access, for Carres operation and principal accounts", JSON.stringify(["*"])).run();
    r = await find();
  }
  return r?.id ?? null;
}

const app = new Hono<{ Bindings: CarresEnv }>();

/** POST /api/carres-sso { assertion } -> { token, session_pass? }. Server to server only. */
app.post("/", async (c) => {
  const secret = c.env.CARRES_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: "Single sign-on is not set up." }, 503);
  const body = await c.req.json<{ assertion?: string }>().catch(() => null);
  const a = body?.assertion ? await verifyAssertion(secret, body.assertion) : null;
  if (!a) return c.json({ error: "Sign-in could not be verified." }, 401);
  if (!ENGINE_ROLES.has(a.role)) return c.json({ error: "This account does not have access to supply chain." }, 403);

  const roleId = await fullRoleId(c.env);
  if (!roleId) return c.json({ error: "The account could not be prepared." }, 500);
  const email = a.email.toLowerCase().trim();
  let user = await c.env.DB.prepare(`SELECT id, status, role_id FROM users WHERE email = ?`).bind(email).first<{ id: number; status: string; role_id: number }>();
  if (!user) {
    await c.env.DB.prepare(`INSERT INTO users (email, name, role_id, status) VALUES (?, ?, ?, 'active')`).bind(email, email, roleId).run();
    user = await c.env.DB.prepare(`SELECT id, status, role_id FROM users WHERE email = ?`).bind(email).first<{ id: number; status: string; role_id: number }>();
  }
  if (!user) return c.json({ error: "The account could not be prepared." }, 500);
  if (user.status !== "active") return c.json({ error: "Account is disabled" }, 403);

  await c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  const token = await createSession(c.env, user.id);
  const sessionPass = await mintSessionPass(c.env, token, Date.now());
  return c.json({ token, ...(sessionPass ? { session_pass: sessionPass } : {}) });
});

export default app;
