/**
 * A Supabase session for the person behind an AI Connector token (routes/mcp.ts).
 *
 * WHY A REAL SESSION. On Carres the security boundary is RLS under the person's own Supabase JWT (ENGINEERING §2),
 * and every API route hands that JWT to `userClient`. Supabase signs its JWTs with an asymmetric key the Worker
 * does not hold, so the Worker cannot forge one, and must never read the person's data with the service key. The
 * only honest way to run a read "as the person" is a genuine session of theirs:
 *
 *   1. `auth.admin.generateLink({ type: "magiclink" })` (service key) returns a one-time token hash. No e-mail is
 *      sent. This is the same route the Stage 3 evidence used to sign in test accounts (docs/evidence/stage3/RAN-IT.md).
 *   2. `auth.verifyOtp({ token_hash })` (public key) exchanges it for a session. GoTrue refuses a banned (disabled,
 *      0731) account here, and the custom access token hook stamps the person's role claims exactly as at login.
 *   3. The access token is used ONLY inside this Worker, on an in-process GET through the whole API
 *      (routes/mcp.ts innerGet). The refresh token is thrown away at once; no copy is stored anywhere.
 *   4. The session is signed out (`auth.admin.signOut(jwt, "local")`) when it is replaced or released, so sessions
 *      do not pile up.
 *
 * The connector token itself (crmcp_…) is never a credential for the API: middleware/auth.ts accepts only ES256
 * Supabase JWTs, and the minted JWT never leaves the Worker.
 *
 * One session per person per isolate is kept for up to 10 minutes (and never past 2 minutes before it expires), so
 * a burst of tool calls does not mint a session each (GoTrue rate-limits token verification per IP).
 */
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase";
import type { Bindings } from "../types";

const KEEP_MS = 10 * 60 * 1000;
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

type Cached = { jwt: string; until: number };
const cache = new Map<string, Cached>();

export class McpSessionError extends Error {}

function jwtExpiryMs(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function signOut(env: Bindings, jwt: string): Promise<void> {
  try {
    await adminClient(env).auth.admin.signOut(jwt, "local");
  } catch {
    /* best-effort: the refresh token was never kept, so a session left behind cannot be used by anyone */
  }
}

async function mint(env: Bindings, userId: string): Promise<string> {
  const admin = adminClient(env);
  const { data: got, error: getErr } = await admin.auth.admin.getUserById(userId);
  const email = got?.user?.email;
  if (getErr || !email) throw new McpSessionError("This account cannot be signed in for the AI connector.");
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) throw new McpSessionError("Could not start a session for this account.");
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  const jwt = verified?.session?.access_token;
  if (verifyErr || !jwt) throw new McpSessionError("This account cannot sign in (it may be disabled).");
  if (verified.user?.id !== userId) {
    await signOut(env, jwt);
    throw new McpSessionError("Session did not match the account.");
  }
  return jwt;
}

/** A Supabase access token of this person, for in-process reads only. */
export async function sessionFor(env: Bindings, userId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.until > now) return hit.jwt;
  const jwt = await mint(env, userId);
  const exp = jwtExpiryMs(jwt);
  const until = Math.min(now + KEEP_MS, exp ? exp - EXPIRY_MARGIN_MS : now + KEEP_MS);
  cache.set(userId, { jwt, until });
  if (hit) await signOut(env, hit.jwt);
  return jwt;
}

/** Forget and sign out this person's session (Disconnect, Remove, the end of a leak check). */
export async function releaseSession(env: Bindings, userId: string): Promise<void> {
  const hit = cache.get(userId);
  cache.delete(userId);
  if (hit) await signOut(env, hit.jwt);
}

/** Test-only. */
export function _clearMcpSessionCache(): void {
  cache.clear();
}
