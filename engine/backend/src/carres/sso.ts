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
interface Assertion { email: string; role: string; exp: number; settingsEditor?: boolean }

const MAX_AGE_MS = 60_000;
/** Carres portal roles that open the engine: operation and principal (Supply Chain, Service Cases), hr, whose
 *  portal menu holds Houzs's Team, Mail Center and IT Support, and finance (Finance; owner, 11 Nov 2026). Kept in
 *  step with the portal's own gate (apps/api/src/routes/operation/scm-engine.ts). */
export const ENGINE_ROLES = new Set(["operation", "principal", "hr", "finance"]);

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

/** The full-access role, made the first time on a new instance (it starts with no roles). */
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

export const NEW_MEMBER_ROLE = "New member";

/** Find a role by name, making it the first time with these permissions. */
async function namedRoleId(env: Env, name: string, description: string, permissions: string[]): Promise<number | null> {
  const find = () => env.DB.prepare(`SELECT id FROM roles WHERE name = ? ORDER BY id LIMIT 1`).bind(name).first<{ id: number }>();
  let r = await find();
  if (!r) {
    await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 0, 0)`)
      .bind(name, description, JSON.stringify(permissions)).run();
    r = await find();
  }
  return r?.id ?? null;
}

/** The role a new person starts on: no pages and no actions until the owner picks their role on Access & Roles. */
const newMemberRoleId = (env: Env) =>
  namedRoleId(env, NEW_MEMBER_ROLE, "Starting role for a new Carres account: no access until the owner picks a role", []);

export const HR_ROLE = "HR";
/** The HR starting role: Team viewed the way Houzs's managers see it (users.read + roles.read -> Team, Members,
 *  Roles and Org chart at "partial" = view only, by the permission backfill in services/pageAccess.ts, since the
 *  role has no role_page_access rows). The owner can widen or narrow it on Access & Roles like any role. */
export const HR_ROLE_PERMISSIONS = ["users.read", "roles.read"];
const hrRoleId = (env: Env) =>
  namedRoleId(env, HR_ROLE, "Starting role for a Carres HR account: Team, view only", HR_ROLE_PERMISSIONS);

/** The role a NEW account starts on, by Carres portal role. */
function startingRoleId(env: Env, role: string): Promise<number | null> {
  if (startsWithFullAccess(role)) return fullRoleId(env);
  if (role === "hr") return hrRoleId(env);
  return newMemberRoleId(env);
}

/** The owner starts with full access; everyone else starts with none, and the owner gives them a role. */
export function startsWithFullAccess(role: string): boolean {
  return role === "principal";
}

interface SsoUser { id: number; status: string; role_id: number; last_login_at: string | null; settings_editor: unknown }

/** The account by email, with its Settings-editor membership and last sign-in, in one statement. */
function findUser(env: Env, email: string): Promise<SsoUser | null> {
  return env.DB.prepare(
    `SELECT u.id, u.status, u.role_id, u.last_login_at,
            EXISTS (SELECT 1 FROM carres_settings_editors e WHERE e.user_id = u.id) AS settings_editor
       FROM users u WHERE u.email = ?`,
  ).bind(email).first<SsoUser>();
}

/** Postgres answers EXISTS with a boolean; a driver may hand back 1/0 or "t"/"f". */
const isTrue = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "t" || v === "true";

/** last_login_at is written to the second (datetime('now'), UTC "YYYY-MM-DD HH:MM:SS"). A sign-in within the
 *  same minute as the recorded one changes nothing anyone reads, so it is not rewritten. */
export const LAST_LOGIN_RESOLUTION_MS = 60_000;

export function lastLoginStale(lastLoginAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastLoginAt) return true;
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(lastLoginAt) ? lastLoginAt.replace(" ", "T") : `${lastLoginAt.replace(" ", "T")}Z`);
  if (!Number.isFinite(at)) return true;
  return now - at >= LAST_LOGIN_RESOLUTION_MS || at > now + LAST_LOGIN_RESOLUTION_MS;
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

  const email = a.email.toLowerCase().trim();
  // One read: the account, whether it is on the Settings-editor list, and when it last signed in, so the
  // writes below are made only when they change something.
  let user = await findUser(c.env, email);
  if (!user) {
    // An existing account keeps the role the owner gave it; only a new one gets a starting role.
    const roleId = await startingRoleId(c.env, a.role);
    if (!roleId) return c.json({ error: "The account could not be prepared." }, 500);
    await c.env.DB.prepare(`INSERT INTO users (email, name, role_id, status) VALUES (?, ?, ?, 'active')`).bind(email, email, roleId).run();
    user = await findUser(c.env, email);
  }
  if (!user) return c.json({ error: "The account could not be prepared." }, 500);
  if (user.status !== "active") return c.json({ error: "Account is disabled" }, 403);
  const userId = user.id;

  // The three writes are independent of each other, so they go out together rather than one after another.
  const writes: Array<Promise<unknown>> = [];
  // Settings editors -> Supply Chain on the portal: kept in step on every sign-in (written only when it differs).
  const wantEditor = a.settingsEditor === true;
  if (isTrue(user.settings_editor) !== wantEditor) {
    writes.push(c.env.DB.prepare(wantEditor
      ? `INSERT INTO carres_settings_editors (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING`
      : `DELETE FROM carres_settings_editors WHERE user_id = ?`).bind(userId).run());
  }
  if (lastLoginStale(user.last_login_at)) {
    writes.push(c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(userId).run());
  }
  const [token] = await Promise.all([createSession(c.env, userId), ...writes]) as [string, ...unknown[]];
  const sessionPass = await mintSessionPass(c.env, token, Date.now());
  return c.json({ token, ...(sessionPass ? { session_pass: sessionPass } : {}) });
});

export default app;
