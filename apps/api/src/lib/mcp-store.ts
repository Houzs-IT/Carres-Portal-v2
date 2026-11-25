/**
 * Storage for the AI Connector (routes/mcp.ts, routes/mcp-admin.ts). Tables: migration 0782.
 *
 * Every read and write here uses the service key: the mcp_* tables have RLS on and no policy, so no signed-in
 * account can read them through the data API. That is the ONLY thing the service key does in the connector. The
 * ERP data an AI reads never passes through this file; it is read as the person (lib/mcp-session.ts).
 *
 * Tokens are stored as SHA-256 hashes only. Single-use rows (the pending "Allow?" screen, the authorization code)
 * are claimed by one conditional statement, so a replay finds nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MCP_ACCESS,
  MCP_ACCESS_REQUESTS,
  MCP_AUTH_REQUESTS,
  MCP_CALLS,
  MCP_OAUTH_CLIENTS,
  MCP_OAUTH_CODES,
  MCP_TOKENS,
} from "@carres/shared";
import { randomToken, sha256Hex } from "./mcp-access";

export const MCP_TOKEN_PREFIX = "crmcp_";
export const MCP_REFRESH_PREFIX = "crmcpr_";
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
/** The leak check's own client row: never shown as a connected app. */
export const LEAK_CLIENT_ID = "mcpc_leak_check";

type Db = SupabaseClient;

const nowIso = () => new Date().toISOString();

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

// ── access (who may connect) ────────────────────────────────────────────────

/** The admin always may; anyone else needs a row in mcp_access. */
export async function hasMcpAccess(db: Db, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const { data, error } = await db.from(MCP_ACCESS).select("user_id").eq("user_id", userId).maybeSingle();
  if (error) fail("mcp_access read", error);
  return !!data;
}

export async function grantAccess(db: Db, userId: string, approvedBy: string): Promise<void> {
  const { error } = await db
    .from(MCP_ACCESS)
    .upsert({ user_id: userId, approved_by: approvedBy, approved_at: nowIso() }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) fail("mcp_access grant", error);
}

export async function removeAccess(db: Db, userId: string): Promise<void> {
  const { error } = await db.from(MCP_ACCESS).delete().eq("user_id", userId);
  if (error) fail("mcp_access remove", error);
}

// ── clients ─────────────────────────────────────────────────────────────────

export type McpClient = { clientId: string; clientName: string; redirectUris: string[] };

export async function getClient(db: Db, clientId: string): Promise<McpClient | null> {
  if (!clientId || clientId.length > 100) return null;
  const { data, error } = await db.from(MCP_OAUTH_CLIENTS).select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  if (error) fail("mcp_oauth_clients read", error);
  if (!data) return null;
  const uris = Array.isArray(data.redirect_uris) ? (data.redirect_uris as unknown[]).map(String) : [];
  return { clientId: String(data.client_id), clientName: String(data.client_name ?? "") || "AI app", redirectUris: uris };
}

export async function registerClient(db: Db, name: string, redirectUris: string[]): Promise<McpClient> {
  const clientId = `mcpc_${randomToken(18)}`;
  const clientName = (name || "AI app").slice(0, 80);
  const { error } = await db.from(MCP_OAUTH_CLIENTS).insert({ client_id: clientId, client_name: clientName, redirect_uris: redirectUris });
  if (error) fail("mcp_oauth_clients insert", error);
  return { clientId, clientName, redirectUris };
}

export async function ensureLeakClient(db: Db): Promise<void> {
  const { error } = await db
    .from(MCP_OAUTH_CLIENTS)
    .upsert({ client_id: LEAK_CLIENT_ID, client_name: "Leak check", redirect_uris: [] }, { onConflict: "client_id", ignoreDuplicates: true });
  if (error) fail("mcp_oauth_clients leak client", error);
}

// ── pending "Allow?" screens ────────────────────────────────────────────────

export type AuthRequest = { id: string; clientId: string; redirectUri: string; state: string; codeChallenge: string };

const toAuthRequest = (r: Record<string, unknown>): AuthRequest => ({
  id: String(r.id),
  clientId: String(r.client_id),
  redirectUri: String(r.redirect_uri),
  state: r.state == null ? "" : String(r.state),
  codeChallenge: String(r.code_challenge),
});

export async function createAuthRequest(db: Db, a: Omit<AuthRequest, "id">): Promise<string> {
  const id = `mcpa_${randomToken(18)}`;
  const { error } = await db.from(MCP_AUTH_REQUESTS).insert({
    id,
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    state: a.state || null,
    code_challenge: a.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) fail("mcp_auth_requests insert", error);
  // Housekeeping: expired screens and codes go when a new one starts (best-effort).
  await db.from(MCP_AUTH_REQUESTS).delete().lt("expires_at", nowIso());
  await db.from(MCP_OAUTH_CODES).delete().lt("expires_at", nowIso());
  return id;
}

export async function getAuthRequest(db: Db, id: string): Promise<AuthRequest | null> {
  if (!id || id.length > 100) return null;
  const { data, error } = await db
    .from(MCP_AUTH_REQUESTS)
    .select("id, client_id, redirect_uri, state, code_challenge")
    .eq("id", id)
    .gt("expires_at", nowIso())
    .maybeSingle();
  if (error) fail("mcp_auth_requests read", error);
  return data ? toAuthRequest(data) : null;
}

/** Single use: the DELETE … RETURNING that removes the row owns the decision. */
export async function takeAuthRequest(db: Db, id: string): Promise<AuthRequest | null> {
  if (!id || id.length > 100) return null;
  const { data, error } = await db
    .from(MCP_AUTH_REQUESTS)
    .delete()
    .eq("id", id)
    .gt("expires_at", nowIso())
    .select("id, client_id, redirect_uri, state, code_challenge");
  if (error) fail("mcp_auth_requests take", error);
  const row = (data ?? [])[0];
  return row ? toAuthRequest(row) : null;
}

// ── authorization codes ─────────────────────────────────────────────────────

export async function createCode(db: Db, a: { clientId: string; userId: string; redirectUri: string; codeChallenge: string }): Promise<string> {
  const code = randomToken(32);
  const { error } = await db.from(MCP_OAUTH_CODES).insert({
    code_hash: await sha256Hex(code),
    client_id: a.clientId,
    user_id: a.userId,
    redirect_uri: a.redirectUri,
    code_challenge: a.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    used: false,
  });
  if (error) fail("mcp_oauth_codes insert", error);
  return code;
}

/** Single use: the UPDATE claims the code; a replay finds used = true and gets nothing. */
export async function consumeCode(db: Db, code: string): Promise<{ clientId: string; userId: string; redirectUri: string; codeChallenge: string } | null> {
  if (!code || code.length > 200) return null;
  const { data, error } = await db
    .from(MCP_OAUTH_CODES)
    .update({ used: true })
    .eq("code_hash", await sha256Hex(code))
    .eq("used", false)
    .gt("expires_at", nowIso())
    .select("client_id, user_id, redirect_uri, code_challenge");
  if (error) fail("mcp_oauth_codes consume", error);
  const r = (data ?? [])[0];
  if (!r) return null;
  return { clientId: String(r.client_id), userId: String(r.user_id), redirectUri: String(r.redirect_uri), codeChallenge: String(r.code_challenge) };
}

// ── tokens ──────────────────────────────────────────────────────────────────

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number; tokenId: string };

export async function issueTokens(db: Db, userId: string, clientId: string): Promise<IssuedTokens> {
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const refreshToken = MCP_REFRESH_PREFIX + randomToken(32);
  const tokenId = `mcpt_${randomToken(12)}`;
  const now = Date.now();
  const { error } = await db.from(MCP_TOKENS).insert({
    id: tokenId,
    user_id: userId,
    client_id: clientId,
    access_hash: await sha256Hex(accessToken),
    access_expires_at: new Date(now + ACCESS_TTL_MS).toISOString(),
    refresh_hash: await sha256Hex(refreshToken),
    refresh_expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
  });
  if (error) fail("mcp_tokens insert", error);
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId };
}

/** Rotate: the old refresh token stops working the moment a new pair is issued (conditional on the old hash). */
export async function refreshTokens(db: Db, refreshToken: string, clientId: string): Promise<(IssuedTokens & { userId: string }) | null> {
  if (!refreshToken.startsWith(MCP_REFRESH_PREFIX) || refreshToken.length > 200) return null;
  const h = await sha256Hex(refreshToken);
  const { data: r, error } = await db
    .from(MCP_TOKENS)
    .select("id, user_id, client_id")
    .eq("refresh_hash", h)
    .is("revoked_at", null)
    .gt("refresh_expires_at", nowIso())
    .maybeSingle();
  if (error) fail("mcp_tokens refresh read", error);
  if (!r || String(r.client_id) !== clientId) return null;
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const newRefresh = MCP_REFRESH_PREFIX + randomToken(32);
  const now = Date.now();
  const { data: upd, error: updErr } = await db
    .from(MCP_TOKENS)
    .update({
      access_hash: await sha256Hex(accessToken),
      access_expires_at: new Date(now + ACCESS_TTL_MS).toISOString(),
      refresh_hash: await sha256Hex(newRefresh),
      refresh_expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
    })
    .eq("id", r.id)
    .eq("refresh_hash", h)
    .is("revoked_at", null)
    .select("id");
  if (updErr) fail("mcp_tokens rotate", updErr);
  if (!upd || upd.length === 0) return null;
  return { accessToken, refreshToken: newRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId: String(r.id), userId: String(r.user_id) };
}

export type McpTokenRow = { tokenId: string; userId: string; clientId: string };

/** The token row behind an access token (unknown / expired / revoked -> null). Access is re-checked by the caller. */
export async function resolveAccessToken(db: Db, token: string): Promise<McpTokenRow | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 200) return null;
  const { data: r, error } = await db
    .from(MCP_TOKENS)
    .select("id, user_id, client_id, last_used_at")
    .eq("access_hash", await sha256Hex(token))
    .is("revoked_at", null)
    .gt("access_expires_at", nowIso())
    .maybeSingle();
  if (error) fail("mcp_tokens resolve", error);
  if (!r) return null;
  const row: McpTokenRow = { tokenId: String(r.id), userId: String(r.user_id), clientId: String(r.client_id) };
  const last = r.last_used_at ? Date.parse(String(r.last_used_at)) : 0;
  if (!last || Date.now() - last > 60_000) {
    await db.from(MCP_TOKENS).update({ last_used_at: nowIso() }).eq("id", row.tokenId); // cosmetic; errors ignored
  }
  return row;
}

/** Revoke one token; `userId` limits it to that person's own (the "My connected apps" Disconnect). */
export async function revokeToken(db: Db, tokenId: string, userId: string | null): Promise<number> {
  let q = db.from(MCP_TOKENS).update({ revoked_at: nowIso() }).eq("id", tokenId).is("revoked_at", null);
  if (userId !== null) q = q.eq("user_id", userId);
  const { data, error } = await q.select("id");
  if (error) fail("mcp_tokens revoke", error);
  return (data ?? []).length;
}

export async function revokeUserTokens(db: Db, userId: string): Promise<number> {
  const { data, error } = await db.from(MCP_TOKENS).update({ revoked_at: nowIso() }).eq("user_id", userId).is("revoked_at", null).select("id");
  if (error) fail("mcp_tokens revoke user", error);
  return (data ?? []).length;
}

// ── call log ────────────────────────────────────────────────────────────────

export async function logCall(
  db: Db,
  c: { tokenId: string; userId: string; clientId: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number },
): Promise<void> {
  try {
    const { error } = await db.from(MCP_CALLS).insert({
      id: `mcpl_${randomToken(12)}`,
      token_id: c.tokenId,
      user_id: c.userId,
      client_id: c.clientId,
      tool: c.tool.slice(0, 60),
      target: c.target.slice(0, 500),
      status: c.status,
      ok: c.ok,
      note: c.note.slice(0, 300),
      ms: c.ms,
    });
    if (error) console.warn("[mcp] call log failed:", error.message);
  } catch (e) {
    console.warn("[mcp] call log failed:", e instanceof Error ? e.message : String(e));
  }
}

export { MCP_ACCESS, MCP_ACCESS_REQUESTS, MCP_CALLS, MCP_OAUTH_CLIENTS, MCP_TOKENS };
