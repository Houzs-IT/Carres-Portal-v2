/**
 * /api/mcp-admin — the AI Connector page (web pages/operation/AiConnector.tsx) and the "Allow?" screen
 * (web pages/AiConnect.tsx). Mounted INSIDE the signed-in /api group: c.var.auth is the caller.
 *
 *   everyone:  GET /me, POST /me/request, POST /me/revoke
 *              GET /consent/:id, POST /consent/:id          (the OAuth "Allow?" step)
 *   admin:     GET /admin/overview, POST /admin/requests/:id/:decision,
 *              POST /admin/access, DELETE /admin/access/:userId, POST /admin/revoke,
 *              POST /admin/leak-check
 * Admin = the principal (lib/mcp-access.ts isMcpAdminRole).
 *
 * The mcp_* tables are read with the service key (RLS on, no policy, migration 0782); every handler checks the
 * caller first. The leak check reads ERP data AS the chosen account (routes/mcp.ts readEndpoint), never as admin.
 */
import { Hono, type Context } from "hono";
import { adminClient } from "../lib/supabase";
import { isMcpAdminRole, leakCheckPaths, MCP_ELIGIBLE_ROLES, sensitiveKeys, appLabel, randomToken } from "../lib/mcp-access";
import {
  createCode,
  getAuthRequest,
  getClient,
  grantAccess,
  hasMcpAccess,
  LEAK_CLIENT_ID,
  MCP_ACCESS,
  MCP_ACCESS_REQUESTS,
  MCP_CALLS,
  MCP_OAUTH_CLIENTS,
  MCP_TOKENS,
  removeAccess,
  revokeToken,
  revokeUserTokens,
  takeAuthRequest,
} from "../lib/mcp-store";
import { releaseSession } from "../lib/mcp-session";
import { connectorUrl, loadPerson, mayConnect, mcpAppRoutes, readEndpoint } from "./mcp";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

type Person = { userId: string; name: string; role: string; title: string };

const isAdmin = (c: Context<AppEnv>) => isMcpAdminRole(c.var.auth.role);
const deny = (c: Context<AppEnv>) => c.json({ error: "forbidden", message: "Only the principal can manage the AI Connector." }, 403);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names for a set of account ids, one query. */
async function people(c: Context<AppEnv>, ids: string[]): Promise<Map<string, Person>> {
  const uniq = [...new Set(ids.filter((x) => UUID.test(x)))];
  const out = new Map<string, Person>();
  if (uniq.length === 0) return out;
  const { data } = await adminClient(c.env).from("app_users").select("id, name, role, title").in("id", uniq);
  for (const r of data ?? []) out.set(String(r.id), { userId: String(r.id), name: String(r.name ?? ""), role: String(r.role ?? ""), title: String(r.title ?? "") });
  return out;
}

async function audit(c: Context<AppEnv>, action: string, ref: string): Promise<void> {
  try {
    await adminClient(c.env).from("audit_log").insert({ role: c.var.auth.role, actor_text: c.var.auth.email, action: `AI Connector · ${action}`, ref });
  } catch {
    /* the audit line never fails the action */
  }
}

// ── everyone ────────────────────────────────────────────────────────────────

router.get("/me", async (c) => {
  const auth = c.var.auth;
  const db = adminClient(c.env);
  const admin = isAdmin(c);
  const eligible = MCP_ELIGIBLE_ROLES.includes(auth.role);
  const allowed = eligible && (await hasMcpAccess(db, auth.id, admin));
  const [{ data: pending }, { data: apps }] = await Promise.all([
    db.from(MCP_ACCESS_REQUESTS).select("id, created_at").eq("user_id", auth.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1),
    db
      .from(MCP_TOKENS)
      .select("id, client_id, created_at, last_used_at")
      .eq("user_id", auth.id)
      .is("revoked_at", null)
      .gt("refresh_expires_at", new Date().toISOString())
      .neq("client_id", LEAK_CLIENT_ID)
      .order("created_at", { ascending: false }),
  ]);
  const clientIds = [...new Set((apps ?? []).map((a) => String(a.client_id)))];
  const { data: clients } = clientIds.length ? await db.from(MCP_OAUTH_CLIENTS).select("client_id, client_name").in("client_id", clientIds) : { data: [] };
  const nameOf = new Map((clients ?? []).map((k) => [String(k.client_id), String(k.client_name ?? "")]));
  const p = pending?.[0];
  return c.json({
    allowed,
    eligible,
    isAdmin: admin,
    pendingRequest: p ? { id: String(p.id), createdAt: p.created_at } : null,
    connectorUrl: connectorUrl(c),
    apps: (apps ?? []).map((a) => ({ tokenId: String(a.id), app: appLabel(nameOf.get(String(a.client_id)) ?? ""), connectedAt: a.created_at, lastUsedAt: a.last_used_at })),
  });
});

router.post("/me/request", async (c) => {
  const auth = c.var.auth;
  if (!MCP_ELIGIBLE_ROLES.includes(auth.role)) return c.json({ error: "not_eligible", message: "The AI Connector is for Carres staff accounts." }, 403);
  const db = adminClient(c.env);
  if (await hasMcpAccess(db, auth.id, isAdmin(c))) return c.json({ ok: true, alreadyAllowed: true });
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const { data: existing } = await db.from(MCP_ACCESS_REQUESTS).select("id").eq("user_id", auth.id).eq("status", "pending").limit(1);
  if (existing && existing.length) return c.json({ ok: true, alreadyRequested: true });
  const id = `mcpr_${randomToken(12)}`;
  const { error } = await db
    .from(MCP_ACCESS_REQUESTS)
    .insert({ id, user_id: auth.id, reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : null, status: "pending" });
  if (error) return c.json({ error: "server_error", message: "Could not save the request. Try again." }, 500);
  await audit(c, "access requested", auth.id);
  return c.json({ ok: true, id });
});

router.post("/me/revoke", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown };
  if (typeof body.tokenId !== "string" || body.tokenId.length > 100) return c.json({ error: "invalid_param", message: "tokenId required" }, 400);
  const n = await revokeToken(adminClient(c.env), body.tokenId, c.var.auth.id);
  return c.json({ ok: true, revoked: n });
});

// ── the OAuth "Allow?" step ─────────────────────────────────────────────────

router.get("/consent/:id", async (c) => {
  const db = adminClient(c.env);
  const req = await getAuthRequest(db, c.req.param("id"));
  if (!req) return c.json({ error: "expired", message: "This connect request has expired. Start again from the AI app." }, 404);
  const cl = await getClient(db, req.clientId);
  const me = await loadPerson(c.env, c.var.auth.id);
  let redirectHost = "";
  try {
    redirectHost = new URL(req.redirectUri).host;
  } catch {
    redirectHost = "";
  }
  return c.json({
    app: appLabel(cl?.clientName ?? ""),
    clientName: cl?.clientName ?? "AI app",
    redirectHost,
    user: { name: me?.name ?? c.var.auth.email, email: c.var.auth.email },
    eligible: MCP_ELIGIBLE_ROLES.includes(c.var.auth.role),
    allowed: await mayConnect(c.env, me),
  });
});

router.post("/consent/:id", async (c) => {
  const db = adminClient(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
  const allow = body.decision === "allow";
  const me = await loadPerson(c.env, c.var.auth.id);
  if (allow && !(await mayConnect(c.env, me))) {
    return c.json({ error: "not_allowed", message: "The AI Connector is not turned on for your account yet." }, 403);
  }
  const req = await takeAuthRequest(db, c.req.param("id"));
  if (!req) return c.json({ error: "expired", message: "This connect request has expired. Start again from the AI app." }, 404);
  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set("state", req.state);
  if (!allow) {
    back.searchParams.set("error", "access_denied");
    return c.json({ redirect: back.toString() });
  }
  const code = await createCode(db, { clientId: req.clientId, userId: c.var.auth.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge });
  back.searchParams.set("code", code);
  const cl = await getClient(db, req.clientId);
  await audit(c, `connected ${appLabel(cl?.clientName ?? "")}`, c.var.auth.id);
  return c.json({ redirect: back.toString() });
});

// ── admin ───────────────────────────────────────────────────────────────────

router.get("/admin/overview", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const db = adminClient(c.env);
  const nowIso = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [requests, connected, allowed, calls, staff, calls24, refused24, clients] = await Promise.all([
    db.from(MCP_ACCESS_REQUESTS).select("id, user_id, reason, created_at").eq("status", "pending").order("created_at"),
    db
      .from(MCP_TOKENS)
      .select("id, user_id, client_id, created_at, last_used_at")
      .is("revoked_at", null)
      .gt("refresh_expires_at", nowIso)
      .neq("client_id", LEAK_CLIENT_ID)
      .order("last_used_at", { ascending: false, nullsFirst: false }),
    db.from(MCP_ACCESS).select("user_id, approved_at"),
    db.from(MCP_CALLS).select("id, user_id, client_id, tool, target, status, ok, note, ms, created_at").order("created_at", { ascending: false }).limit(100),
    db.from("app_users").select("id, name, role, title").eq("status", "active").in("role", [...MCP_ELIGIBLE_ROLES]).order("name"),
    db.from(MCP_CALLS).select("id", { count: "exact", head: true }).gt("created_at", dayAgo),
    db.from(MCP_CALLS).select("id", { count: "exact", head: true }).gt("created_at", dayAgo).eq("ok", false),
    db.from(MCP_OAUTH_CLIENTS).select("client_id, client_name"),
  ]);
  const firstError = [requests, connected, allowed, calls, staff].find((r) => r.error)?.error;
  if (firstError) return c.json({ error: "server_error", message: "The AI Connector tables could not be read. Has migration 0782 been applied?" }, 503);

  const ids = [
    ...(requests.data ?? []).map((r) => String(r.user_id)),
    ...(connected.data ?? []).map((r) => String(r.user_id)),
    ...(allowed.data ?? []).map((r) => String(r.user_id)),
    ...(calls.data ?? []).map((r) => String(r.user_id)),
  ];
  const who = await people(c, ids);
  const appName = new Map((clients.data ?? []).map((k) => [String(k.client_id), appLabel(String(k.client_name ?? ""))]));
  const named = (id: unknown) => who.get(String(id)) ?? { userId: String(id), name: "(removed account)", role: "", title: "" };
  const allowedIds = new Set((allowed.data ?? []).map((r) => String(r.user_id)));
  const connectedPeople = new Set((connected.data ?? []).map((r) => String(r.user_id)));

  return c.json({
    connectorUrl: connectorUrl(c),
    stats: {
      connectedPeople: connectedPeople.size,
      callsToday: calls24.count ?? 0,
      refusedToday: refused24.count ?? 0,
      waiting: (requests.data ?? []).length,
    },
    requests: (requests.data ?? []).map((r) => ({ id: String(r.id), ...named(r.user_id), reason: String(r.reason ?? ""), createdAt: r.created_at })),
    connected: (connected.data ?? []).map((r) => ({ tokenId: String(r.id), ...named(r.user_id), app: appName.get(String(r.client_id)) ?? "AI app", connectedAt: r.created_at, lastUsedAt: r.last_used_at })),
    allowed: (allowed.data ?? []).map((r) => ({ ...named(r.user_id), approvedAt: r.approved_at })).sort((a, b) => a.name.localeCompare(b.name)),
    calls: (calls.data ?? []).map((k) => ({
      id: String(k.id),
      ...named(k.user_id),
      app: appName.get(String(k.client_id)) ?? "AI app",
      tool: String(k.tool),
      target: String(k.target ?? ""),
      status: Number(k.status ?? 0),
      ok: k.ok === true,
      note: String(k.note ?? ""),
      ms: Number(k.ms ?? 0),
      at: k.created_at,
    })),
    // Who can still be turned on: active staff accounts that are not the admin and not already allowed.
    staff: (staff.data ?? [])
      .filter((u) => !isMcpAdminRole(String(u.role)) && !allowedIds.has(String(u.id)))
      .map((u) => ({ userId: String(u.id), name: String(u.name ?? ""), role: String(u.role ?? ""), title: String(u.title ?? "") })),
  });
});

router.post("/admin/requests/:id/:decision", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const decision = c.req.param("decision");
  if (decision !== "approve" && decision !== "reject") return c.json({ error: "invalid_param", message: "decision must be approve or reject" }, 400);
  const db = adminClient(c.env);
  const { data, error } = await db
    .from(MCP_ACCESS_REQUESTS)
    .update({ status: decision === "approve" ? "approved" : "rejected", decided_by: c.var.auth.id, decided_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("status", "pending")
    .select("user_id");
  if (error) return c.json({ error: "server_error", message: error.message }, 500);
  const row = (data ?? [])[0];
  if (!row) return c.json({ error: "not_found", message: "Request not found or already decided." }, 404);
  const userId = String(row.user_id);
  if (decision === "approve") {
    const p = await loadPerson(c.env, userId);
    if (!p || p.status !== "active" || !MCP_ELIGIBLE_ROLES.includes(p.role)) return c.json({ error: "not_eligible", message: "That account is not an active staff account." }, 400);
    await grantAccess(db, userId, c.var.auth.id);
  }
  await audit(c, `request ${decision}d`, userId);
  return c.json({ ok: true });
});

router.post("/admin/access", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!UUID.test(userId)) return c.json({ error: "invalid_param", message: "userId required" }, 400);
  const p = await loadPerson(c.env, userId);
  if (!p || p.status !== "active" || !MCP_ELIGIBLE_ROLES.includes(p.role)) return c.json({ error: "not_eligible", message: "That account is not an active staff account." }, 400);
  const db = adminClient(c.env);
  await grantAccess(db, userId, c.var.auth.id);
  await db
    .from(MCP_ACCESS_REQUESTS)
    .update({ status: "approved", decided_by: c.var.auth.id, decided_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "pending");
  await audit(c, `turned on for ${p.name}`, userId);
  return c.json({ ok: true });
});

router.delete("/admin/access/:userId", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const userId = c.req.param("userId");
  if (!UUID.test(userId)) return c.json({ error: "invalid_param", message: "userId required" }, 400);
  const db = adminClient(c.env);
  await removeAccess(db, userId);
  const revoked = await revokeUserTokens(db, userId);
  await releaseSession(c.env, userId);
  await audit(c, `removed (${revoked} connection(s) cut)`, userId);
  return c.json({ ok: true, revoked });
});

router.post("/admin/revoke", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown; userId?: unknown };
  const db = adminClient(c.env);
  let n = 0;
  if (typeof body.tokenId === "string" && body.tokenId.length <= 100) n = await revokeToken(db, body.tokenId, null);
  else if (typeof body.userId === "string" && UUID.test(body.userId)) {
    n = await revokeUserTokens(db, body.userId);
    await releaseSession(c.env, body.userId);
  } else return c.json({ error: "invalid_param", message: "tokenId or userId required" }, 400);
  await audit(c, `disconnected ${n} connection(s)`, typeof body.tokenId === "string" ? body.tokenId : String(body.userId));
  return c.json({ ok: true, revoked: n });
});

// ── leak check ──────────────────────────────────────────────────────────────
// Runs the connector's real read path AS the chosen staff account over every parameter-free list endpoint, a page
// at a time (the page loops `offset` until `done`). Field NAMES and outcomes only, never values. The session made
// for it is signed out when the last page is read (lib/mcp-session.ts releaseSession).

export type LeakRow = { path: string; outcome: "opened" | "refused" | "error"; status: number; hidden: string[]; sensitive: string[] };
const LEAK_PAGE = 20;
const LEAK_PARALLEL = 4;

export function analyseBody(path: string, status: number, isError: boolean, body: unknown, removed: string[]): LeakRow {
  if (status === 401 || status === 403) return { path, outcome: "refused", status, hidden: [], sensitive: [] };
  if (isError) return { path, outcome: "error", status, hidden: [], sensitive: [] };
  return { path, outcome: "opened", status, hidden: removed, sensitive: sensitiveKeys(body) };
}

router.post("/admin/leak-check", async (c) => {
  if (!isAdmin(c)) return deny(c);
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown; offset?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const p = UUID.test(userId) ? await loadPerson(c.env, userId) : null;
  if (!p) return c.json({ error: "not_found", message: "Account not found." }, 404);
  if (isMcpAdminRole(p.role)) return c.json({ error: "invalid_param", message: "The principal sees everything. Pick a staff account." }, 400);
  if (!(await mayConnect(c.env, p))) return c.json({ error: "invalid_param", message: "Turn on the AI Connector for this account first (and it must be active)." }, 400);

  const paths = leakCheckPaths(mcpAppRoutes());
  const page = paths.slice(offset, offset + LEAK_PAGE);
  const done = offset + page.length >= paths.length;
  const rows: LeakRow[] = [];
  try {
    for (let i = 0; i < page.length; i += LEAK_PARALLEL) {
      const chunk = page.slice(i, i + LEAK_PARALLEL);
      // eslint-disable-next-line no-await-in-loop -- bounded fan-out: 4 in-process reads at a time
      const got = await Promise.all(
        chunk.map(async (path) => {
          try {
            const r = await readEndpoint(c, userId, path, { limit: 5, page: 1 });
            return analyseBody(path, r.status, !!r.result.isError, r.body, r.removed);
          } catch {
            return { path, outcome: "error" as const, status: 500, hidden: [], sensitive: [] };
          }
        }),
      );
      rows.push(...got);
    }
  } finally {
    if (done) await releaseSession(c.env, userId);
  }
  if (offset === 0) await audit(c, `leak check run as ${p.name} over ${paths.length} endpoints`, userId);
  return c.json({ person: p.name, role: p.role, total: paths.length, offset, next: offset + page.length, done, rows });
});

export default router;
