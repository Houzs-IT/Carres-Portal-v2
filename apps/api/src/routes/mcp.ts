/**
 * /api/mcp — the AI Connector (a remote MCP server). Owner, 25 Nov 2026: every company system gets the same AI
 * Connector as Hookka ERP and Houzs ERP. Mounted on the root app BEFORE the signed-in /api group (index.ts):
 * every handler here does its own authentication.
 *
 *   POST /api/mcp                  MCP Streamable HTTP (JSON-RPC, stateless), Bearer crmcp_…
 *   POST /api/mcp/oauth/register   OAuth dynamic client registration (public clients).
 *   GET  /api/mcp/oauth/authorize  -> the web app's /ai-connect "Allow?" screen (routes/mcp-admin.ts consent).
 *   POST /api/mcp/oauth/token      authorization_code (PKCE S256) / refresh_token (rotating).
 *   GET  /.well-known/oauth-*      discovery, at the API site's root (mcpWellKnown, index.ts).
 *
 * READ-ONLY AND OWN PERMISSIONS, BY CONSTRUCTION:
 *   - A tool call re-enters the whole API in-process as a GET (never anything else) carrying a genuine Supabase
 *     session of the person who connected the app (lib/mcp-session.ts). So authMiddleware verifies a real ES256 JWT,
 *     every route's own role guard runs, the API door (lib/api-door.ts) opens or stays shut for that person's role,
 *     and every table answers through RLS as that person. Nothing is read with the service key on their behalf.
 *   - The connector token is never accepted anywhere else: middleware/auth.ts takes only Supabase JWTs, and the
 *     minted JWT never leaves this Worker. A leaked crmcp_ token reads (as that person) through this endpoint
 *     only, and the admin can cut it.
 *   - Paths that write on GET, mint a sign-on or hand out file links are refused before the call (lib/mcp-access.ts).
 *   - Credential-shaped keys are removed from every reply; replies are capped at 60k characters.
 */
import { Hono, type Context } from "hono";
import { adminClient } from "../lib/supabase";
import {
  classifyPath,
  cleanQuery,
  isMcpAdminRole,
  MCP_ELIGIBLE_ROLES,
  moduleCatalog,
  pkceS256,
  readablePaths,
  redactSecrets,
  validCodeVerifier,
  validRedirectUri,
  type RouteInfo,
} from "../lib/mcp-access";
import {
  consumeCode,
  createAuthRequest,
  getClient,
  hasMcpAccess,
  issueTokens,
  logCall,
  refreshTokens,
  registerClient,
  resolveAccessToken,
} from "../lib/mcp-store";
import { McpSessionError, sessionFor } from "../lib/mcp-session";
import type { Bindings } from "../types";

type McpEnv = { Bindings: Bindings };
const mcp = new Hono<McpEnv>();

// The whole API, for in-process tool calls; set by index.ts (importing it here would be circular).
type FetchApp = { fetch: (req: Request, env: Bindings, ctx?: ExecutionContext) => Response | Promise<Response>; routes: RouteInfo[] };
let appRef: FetchApp | null = null;
export function setMcpApp(a: FetchApp): void {
  appRef = a;
}
export function mcpAppRoutes(): RouteInfo[] {
  return appRef?.routes ?? [];
}

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_RESULT_CHARS = 60_000;
export const MCP_PATH = "/api/mcp";
const SERVER_INFO = { name: "carres-erp", title: "Carres ERP", version: "1.0.0" };
const DEFAULT_STAFF_WEB_URL = "https://erp.carresofficial.com";

/** The API's public origin (api.carresofficial.com in production). `MCP_PUBLIC_ORIGIN` overrides it. */
export function apiOrigin(c: Context): string {
  const env = c.env as Bindings;
  return (env.MCP_PUBLIC_ORIGIN || new URL(c.req.url).origin).replace(/\/+$/, "");
}

/** Where the "Allow?" screen lives: the staff portal (erp.carresofficial.com), or the local web app in dev. */
export function staffWebOrigin(env: Bindings): string {
  if (env.STAFF_WEB_URL) return env.STAFF_WEB_URL.replace(/\/+$/, "");
  const pub = env.PUBLIC_WEB_URL ?? "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(pub)) return pub;
  return DEFAULT_STAFF_WEB_URL;
}

export const connectorUrl = (c: Context): string => `${apiOrigin(c)}${MCP_PATH}`;

// ── who is calling ──────────────────────────────────────────────────────────

export type McpPerson = { id: string; email: string; name: string; role: string; title: string | null; status: string };

export async function loadPerson(env: Bindings, userId: string): Promise<McpPerson | null> {
  const { data, error } = await adminClient(env).from("app_users").select("id, email, name, role, title, status").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    email: String(data.email ?? ""),
    name: String(data.name ?? ""),
    role: String(data.role ?? ""),
    title: data.title == null ? null : String(data.title),
    status: String(data.status ?? ""),
  };
}

/** May this person use the connector right now? Active, a Carres staff role, and approved (the admin always is). */
export async function mayConnect(env: Bindings, p: McpPerson | null): Promise<boolean> {
  if (!p || p.status !== "active" || !MCP_ELIGIBLE_ROLES.includes(p.role)) return false;
  return hasMcpAccess(adminClient(env), p.id, isMcpAdminRole(p.role));
}

// ── discovery ───────────────────────────────────────────────────────────────

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["erp.read"],
    resource_name: "Carres ERP",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${MCP_PATH}/oauth/authorize`,
    token_endpoint: `${origin}${MCP_PATH}/oauth/token`,
    registration_endpoint: `${origin}${MCP_PATH}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["erp.read"],
  };
}

export const mcpWellKnown = new Hono<McpEnv>();
mcpWellKnown.get("/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(apiOrigin(c))));
mcpWellKnown.get("/oauth-protected-resource/*", (c) => c.json(protectedResourceMetadata(apiOrigin(c))));
mcpWellKnown.get("/oauth-authorization-server", (c) => c.json(authorizationServerMetadata(apiOrigin(c))));
mcpWellKnown.get("/oauth-authorization-server/*", (c) => c.json(authorizationServerMetadata(apiOrigin(c))));

// ── OAuth ───────────────────────────────────────────────────────────────────

mcp.post("/oauth/register", async (c) => {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5 || uris.some((u) => u.length > 500 || !validRedirectUri(u))) {
    return c.json({ error: "invalid_redirect_uri", error_description: "1-5 redirect URIs required: https, or http on localhost" }, 400);
  }
  const cl = await registerClient(adminClient(c.env), typeof body.client_name === "string" ? body.client_name : "AI app", uris);
  return c.json(
    {
      client_id: cl.clientId,
      client_name: cl.clientName,
      redirect_uris: cl.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
});

const plain = (msg: string, status: 400 | 403 = 400) =>
  new Response(`${msg}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

mcp.get("/oauth/authorize", async (c) => {
  const q = (k: string) => c.req.query(k) ?? "";
  const clientId = q("client_id");
  const redirectUri = q("redirect_uri");
  if (!clientId || !redirectUri) return plain("Invalid request: missing client or return address.");
  const db = adminClient(c.env);
  const cl = await getClient(db, clientId);
  if (!cl) return plain("This AI app is not registered. Remove the connector and add it again.");
  // Exact match against what the app registered: the code can only ever go back to the app that asked.
  if (!cl.redirectUris.includes(redirectUri)) return plain("Invalid request: the return address does not match this app.");
  if (q("response_type") !== "code") return plain("Only response_type=code is supported.");
  const challenge = q("code_challenge");
  if (!/^[A-Za-z0-9\-_]{43,128}$/.test(challenge) || q("code_challenge_method") !== "S256") return plain("This app must use PKCE (S256).");
  const id = await createAuthRequest(db, { clientId, redirectUri, state: q("state").slice(0, 500), codeChallenge: challenge });
  // The web app signs the person in (or uses their session) and shows Allow / Cancel.
  return c.redirect(`${staffWebOrigin(c.env)}/ai-connect?request=${encodeURIComponent(id)}`, 302);
});

mcp.post("/oauth/token", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  let f: Record<string, string | undefined> = {};
  try {
    const b = ct.includes("application/json") ? ((await c.req.json()) as Record<string, unknown>) : await c.req.parseBody();
    for (const [k, v] of Object.entries(b)) if (typeof v === "string") f[k] = v;
  } catch {
    f = {};
  }
  const err = (error: string, desc: string, status: 400 | 401 = 400) => c.json({ error, error_description: desc }, status, { "Cache-Control": "no-store" });
  const db = adminClient(c.env);
  const clientId = f.client_id || "";
  if (!clientId || !(await getClient(db, clientId))) return err("invalid_client", "Unknown client", 401);

  let userId: string;
  let issued: Awaited<ReturnType<typeof issueTokens>>;
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return err("invalid_request", "code and code_verifier are required");
    if (!validCodeVerifier(f.code_verifier)) return err("invalid_grant", "code_verifier is malformed");
    const rec = await consumeCode(db, f.code);
    if (!rec || rec.clientId !== clientId) return err("invalid_grant", "Code is invalid, used or expired");
    if (f.redirect_uri && f.redirect_uri !== rec.redirectUri) return err("invalid_grant", "redirect_uri mismatch");
    if ((await pkceS256(f.code_verifier)) !== rec.codeChallenge) return err("invalid_grant", "PKCE check failed");
    userId = rec.userId;
    issued = await issueTokens(db, userId, clientId);
  } else if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return err("invalid_request", "refresh_token is required");
    const r = await refreshTokens(db, f.refresh_token, clientId);
    if (!r) return err("invalid_grant", "Refresh token is invalid, revoked or expired");
    userId = r.userId;
    issued = r;
  } else {
    return err("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
  if (!(await mayConnect(c.env, await loadPerson(c.env, userId)))) {
    return err("invalid_grant", "This account may not use the AI connector");
  }
  return c.json(
    { access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, refresh_token: issued.refreshToken, scope: "erp.read" },
    200,
    { "Cache-Control": "no-store", Pragma: "no-cache" },
  );
});

// ── MCP endpoint ────────────────────────────────────────────────────────────

type Identity = { tokenId: string; clientId: string; person: McpPerson };
type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to Carres ERP (Carres mattresses, bed frames and sofas: sales orders from stores and showrooms, catalogue, delivery, stock, payments and finance, rental) as the signed-in staff member.
Everything is READ-ONLY and limited to what this person may see in the ERP. Never guess figures a call did not return.
Start with list_modules, then list_endpoints for a module, then erp_get. Use query parameters (dates YYYY-MM-DD, page/limit, search, status) to keep answers small.
If a call says "Not available to your role", tell the person they do not have permission for that data.
Note: the Supply Chain, Service Cases, Projects, Team and Finance screens staff open under /operation/sc are a separate system and are not part of this connector.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  { name: "whoami", title: "Who am I connected as", description: "The ERP account this connection uses and its role.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  { name: "list_modules", title: "List ERP modules", description: "The ERP modules (API path prefixes) with how many read endpoints each has. Start here.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  {
    name: "list_endpoints",
    title: "List read endpoints",
    description: "Every readable GET endpoint under a module prefix (e.g. /api/orders), with :id style placeholders.",
    inputSchema: { type: "object", properties: { prefix: { type: "string", description: "Module prefix from list_modules" } }, required: ["prefix"], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "erp_get",
    title: "Read from the ERP",
    description: "Read one ERP endpoint as the signed-in person (GET only) and return its JSON. Large replies are cut; narrow them with query parameters.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint path without query string, with real ids in place of :id, e.g. /api/orders" },
        query: { type: "object", description: 'Query parameters, e.g. {"from":"2026-11-01","to":"2026-11-30"}', additionalProperties: { type: ["string", "number", "boolean"] } },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

/** One in-process GET through the whole API, as the person. Never any other method. */
async function innerGet(c: Context, jwt: string, pathWithQuery: string): Promise<Response> {
  if (!appRef) throw new Error("MCP app not initialised");
  let ctx: Parameters<FetchApp["fetch"]>[2];
  try {
    ctx = c.executionCtx as unknown as typeof ctx;
  } catch {
    ctx = undefined;
  }
  const req = new Request(apiOrigin(c) + pathWithQuery, { method: "GET", headers: { authorization: `Bearer ${jwt}`, accept: "application/json" } });
  return appRef.fetch(req, c.env as Bindings, ctx);
}

export type ReadOutcome = { result: ToolResult; status: number; note: string; target: string; body: unknown; removed: string[] };

/** Read one endpoint as the person; shared with the leak check (routes/mcp-admin.ts). */
export async function readEndpoint(c: Context, userId: string, rawPath: string, query: unknown): Promise<ReadOutcome> {
  const d = classifyPath(rawPath);
  if (!d.ok) return { result: text(d.reason, true), status: 400, note: "blocked path", target: String(rawPath ?? "").slice(0, 300), body: null, removed: [] };
  const qs = cleanQuery(query);
  const target = d.path + (qs.toString() ? `?${qs.toString()}` : "");
  let jwt: string;
  try {
    jwt = await sessionFor(c.env as Bindings, userId);
  } catch (e) {
    const msg = e instanceof McpSessionError ? e.message : "Could not sign in as this account.";
    return { result: text(msg, true), status: 401, note: "no session", target, body: null, removed: [] };
  }
  const res = await innerGet(c, jwt, target);
  const ctype = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403) {
    return { result: text("Not available to your role: you do not have permission for this in the ERP.", true), status: res.status, note: "no permission", target, body: null, removed: [] };
  }
  if (res.status === 404 && !ctype.includes("json")) {
    return { result: text("No such endpoint. Use list_endpoints to find one.", true), status: 404, note: "not found", target, body: null, removed: [] };
  }
  if (!ctype.includes("json")) {
    return { result: text(`This endpoint returns a file (${ctype || "unknown type"}), not data. Open it in the ERP instead.`, true), status: res.status, note: "non-json", target, body: null, removed: [] };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 400) {
    const b = body && typeof body === "object" ? (body as { error?: unknown; message?: unknown }) : {};
    const msg = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : `HTTP ${res.status}`;
    return { result: text(`The ERP answered: ${msg}`, true), status: res.status, note: msg.slice(0, 120), target, body: null, removed: [] };
  }
  const { value, removed } = redactSecrets(body);
  let out = JSON.stringify(value);
  let cut = false;
  if (out.length > MAX_RESULT_CHARS) {
    out = out.slice(0, MAX_RESULT_CHARS);
    cut = true;
  }
  const notes: string[] = [];
  if (removed.size) notes.push(`Credential fields removed: ${[...removed].join(", ")}.`);
  if (cut) notes.push(`Reply cut at ${MAX_RESULT_CHARS} characters. Narrow it with query parameters (dates, page/limit, search).`);
  return { result: text((notes.length ? `${notes.join(" ")}\n` : "") + out), status: res.status, note: "", target, body: value, removed: [...removed] };
}

async function callTool(c: Context, id: Identity, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200;
  let note = "";
  let target = "";
  let result: ToolResult;
  try {
    if (name === "whoami") {
      result = text(JSON.stringify({ name: id.person.name, email: id.person.email, role: id.person.role, title: id.person.title, readOnly: true }));
    } else if (name === "list_modules") {
      result = text(JSON.stringify({ readOnly: true, modules: moduleCatalog(mcpAppRoutes()), tip: "Call list_endpoints with a prefix, then erp_get. A module you may not open answers 'Not available to your role'." }));
    } else if (name === "list_endpoints") {
      const prefix = String(args.prefix ?? "");
      target = prefix.slice(0, 300);
      const d = classifyPath(prefix);
      if (!d.ok) {
        result = text(d.reason, true);
        status = 400;
      } else {
        result = text(JSON.stringify({ prefix: d.path, endpoints: readablePaths(mcpAppRoutes(), d.path).slice(0, 300) }));
      }
    } else if (name === "erp_get") {
      const r = await readEndpoint(c, id.person.id, String(args.path ?? ""), args.query);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else {
      result = text(`Unknown tool: ${name}`, true);
      status = 400;
    }
  } catch (e) {
    result = text(`Failed: ${e instanceof Error ? e.message : String(e)}`, true);
    status = 500;
  }
  const done = logCall(adminClient(c.env as Bindings), { tokenId: id.tokenId, userId: id.person.id, clientId: id.clientId, tool: name, target, status, ok: !result.isError, note, ms: Date.now() - t0 });
  try {
    c.executionCtx.waitUntil(done);
  } catch {
    await done;
  }
  return result;
}

async function handleRpc(c: Context, id: Identity, m: RpcReq): Promise<unknown> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  if (!m || typeof m !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      return reply(await callTool(c, id, String(m.params?.name ?? ""), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case "resources/list":
      return reply({ resources: [] });
    case "resources/templates/list":
      return reply({ resourceTemplates: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      if (m.id === undefined || m.id === null || (m.method ?? "").startsWith("notifications/")) return null;
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ""}` } };
  }
}

/** The person behind a connector token, or null (unknown / revoked / expired / inactive / access removed). */
export async function mcpIdentity(env: Bindings, token: string): Promise<Identity | null> {
  const row = await resolveAccessToken(adminClient(env), token);
  if (!row) return null;
  const person = await loadPerson(env, row.userId);
  if (!person || !(await mayConnect(env, person))) return null;
  return { tokenId: row.tokenId, clientId: row.clientId, person };
}

export function unauthorized(c: Context, hadToken: boolean): Response {
  return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
    "WWW-Authenticate": `Bearer realm="carres-erp", resource_metadata="${apiOrigin(c)}/.well-known/oauth-protected-resource${MCP_PATH}"${hadToken ? ', error="invalid_token"' : ""}`,
  });
}

mcp.post("/", async (c) => {
  const token = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const id = token ? await mcpIdentity(c.env, token) : null;
  if (!id) return unauthorized(c, !!token);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const msgs = Array.isArray(body) ? (body as RpcReq[]).slice(0, 20) : [body as RpcReq];
  const out: unknown[] = [];
  for (const m of msgs) {
    // eslint-disable-next-line no-await-in-loop -- JSON-RPC batch items run in order, as the client sent them
    const r = await handleRpc(c, id, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? out : out[0]);
});

// Stateless server: no server-initiated stream, no session to delete.
mcp.get("/", (c) => c.json({ error: "Use POST (MCP Streamable HTTP)." }, 405, { Allow: "POST" }));
mcp.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));

export default mcp;
