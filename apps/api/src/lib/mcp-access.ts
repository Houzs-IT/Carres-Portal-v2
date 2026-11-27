/**
 * What the AI Connector may read (routes/mcp.ts). Pure: no database, no network.
 *
 * The boundary is the Carres API itself: every tool call re-enters the API as a GET carrying a Supabase session
 * of the person who connected the AI app (lib/mcp-session.ts), so each route's own role guard, the API door
 * (lib/api-door.ts) and every table's RLS decide what comes back, exactly as for that person's own login. This
 * file adds four things on top:
 *   1. paths the connector never reads: sign-in and account, the connector itself, the engine sign-on, and the
 *      few GET routes that write or hand out a file link (each named below with its reason);
 *   2. credential-shaped fields removed from every reply, whoever asks;
 *   3. the module list (from the API's own GET routes) for list_modules / list_endpoints;
 *   4. the OAuth helpers that need no database: redirect URI rule, PKCE S256, the AI app's display name.
 */

/** Never readable through the connector, whatever the person's role. Prefix match on whole segments. */
export const MCP_BLOCKED_PREFIXES: readonly string[] = [
  // Sign-in, the person's own account and e-mail change.
  "/api/auth",
  "/api/account",
  // The connector and its admin page.
  "/api/mcp",
  "/api/mcp-admin",
  // Mints a sign-on for the engine (POST today; blocked whole so a later GET cannot hand one out).
  "/api/operation/scm-engine",
  // GET / enrols the caller into the auto-assign pool (routes/operation/staff.ts ensureEnrolled): a read that writes.
  "/api/operation/staff",
];

/**
 * Never readable, by shape anywhere in the path:
 *  - `/stripe/` — `GET …/stripe/checkout/:sid` reconciles with Stripe and records the payment (stripe-checkout.ts,
 *    rental.ts): a read that writes money.
 *  - `/files/url`, `/signed-document` — answer a time-limited file link, a bearer credential to a document.
 *  - `/print`, `/pdf`, `/download` — files, not data.
 */
export const MCP_BLOCKED_PATTERNS: readonly RegExp[] = [
  /\/stripe(\/|$)/,
  /\/files\/url$/,
  /\/signed-document$/,
  /\/(print|pdf|download)(\/|$)/,
];

export type PathDecision = { ok: true; path: string } | { ok: false; reason: string };

const BLOCKED_REASON =
  "That part of the ERP is not available through the AI connector (sign-in, account, file links and system actions are never shared).";

/** Normalise and gate one endpoint path (no query string). */
export function classifyPath(raw: string): PathDecision {
  const p = String(raw ?? "").trim().split("?")[0].split("#")[0];
  if (!p.startsWith("/api/")) {
    return { ok: false, reason: "Paths start with /api/. Use list_modules and list_endpoints to find one." };
  }
  if (p.length > 300 || /\.\.|\/\/|%2e|%2f|%5c|\\|[\s<>"']/i.test(p)) return { ok: false, reason: "Invalid path." };
  const path = p.replace(/\/+$/, "") || p;
  if (MCP_BLOCKED_PREFIXES.some((b) => path === b || path.startsWith(`${b}/`))) return { ok: false, reason: BLOCKED_REASON };
  if (MCP_BLOCKED_PATTERNS.some((re) => re.test(path))) return { ok: false, reason: BLOCKED_REASON };
  return { ok: true, path };
}

/** Query parameters an AI may pass: plain names, scalar values, bounded. Anything else is dropped. */
export function cleanQuery(query: unknown): URLSearchParams {
  const qs = new URLSearchParams();
  if (!query || typeof query !== "object" || Array.isArray(query)) return qs;
  let n = 0;
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (n >= 30) break;
    if (!/^[A-Za-z0-9_.\-[\]]{1,60}$/.test(k)) continue;
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    qs.set(k, String(v).slice(0, 500));
    n += 1;
  }
  return qs;
}

/** Field names removed from every reply: credentials and secrets, never needed to answer a question. */
export const SECRET_KEY =
  /(password|passwd|secret|token|api_?key|apikey|pin_?hash|pin_?code|^pin$|totp|otp_|mfa|session_?key|private_?key|signing_?key|service_?role|webhook|refresh_?token|access_?token|hashed)/i;

/** Strip credential-shaped fields (any depth). Returns the cleaned value and the names removed. */
export function redactSecrets(v: unknown): { value: unknown; removed: Set<string> } {
  const removed = new Set<string>();
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 40) return null;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) {
          removed.add(k);
          continue;
        }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return x;
  };
  return { value: walk(v, 0), removed };
}

/**
 * Money and people field names. The leak check reports where these reach an account, NAMES ONLY.
 * Carres adds supplier: who Carres buys from is for principal, operation and finance only (CLAUDE.md §7).
 */
export const SENSITIVE_KEY =
  /(cost|salary|salaries|wage|payroll|margin|profit|commission|supplier|ic_?no|ic_?number|nric|passport|bank_?acc|account_?no|account_?number|basic_?pay|allowance|epf|socso)/i;

export type RouteInfo = { method: string; path: string };

/** Readable GET endpoints (no wildcards, not blocked), sorted. */
export function readablePaths(routes: readonly RouteInfo[], prefix: string | null): string[] {
  const set = new Set<string>();
  for (const r of routes) {
    if (r.method !== "GET") continue;
    if (!r.path.startsWith("/api/") || r.path.includes("*")) continue;
    if (prefix && !(r.path === prefix || r.path.startsWith(`${prefix}/`))) continue;
    if (!classifyPath(r.path.replace(/:[^/]+/g, "x")).ok) continue;
    set.add(r.path.replace(/\/+$/, "") || r.path);
  }
  return [...set].sort();
}

/** Areas whose second segment is the module (/api/operation/orders, /api/finance/payments, …). */
const AREAS = new Set(["operation", "finance", "principal", "bd", "ops"]);

/** One module per first path segment, one level deeper inside an area. */
export function moduleCatalog(routes: readonly RouteInfo[]): { prefix: string; endpoints: number }[] {
  const counts = new Map<string, number>();
  for (const p of readablePaths(routes, null)) {
    const seg = p.split("/").filter(Boolean); // ["api", "operation", "orders", ...]
    const prefix = AREAS.has(seg[1]) && seg[2] && !seg[2].startsWith(":") ? `/api/${seg[1]}/${seg[2]}` : `/api/${seg[1]}`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()].map(([prefix, endpoints]) => ({ prefix, endpoints })).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** List endpoints worth probing in the leak check: parameter-free GETs. */
export function leakCheckPaths(routes: readonly RouteInfo[]): string[] {
  return readablePaths(routes, null).filter((p) => !p.includes(":"));
}

/** Every key name in a JSON value (any depth, capped). */
export function jsonKeys(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || out.size > 2000) return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) jsonKeys(x, out, depth + 1);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      jsonKeys(x, out, depth + 1);
    }
  }
  return out;
}

/** The sensitive field names in one reply (credentials are already gone; never values). */
export function sensitiveKeys(body: unknown): string[] {
  return [...jsonKeys(body)].filter((k) => SENSITIVE_KEY.test(k) && !SECRET_KEY.test(k)).sort();
}

// ── OAuth helpers ───────────────────────────────────────────────────────────

/** A redirect URI a client may register: https anywhere, http only for loopback, never a fragment. */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256 (RFC 7636 §4.2): BASE64URL(SHA256(ASCII(verifier))). */
export async function pkceS256(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(buf));
}

/** A verifier RFC 7636 §4.1 allows: 43-128 unreserved characters. */
export function validCodeVerifier(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64Url(a);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A friendly app name for the admin page, from the registered client name. */
export function appLabel(clientName: string): string {
  const n = (clientName ?? "").toLowerCase();
  if (n.includes("claude")) return "Claude";
  if (n.includes("chatgpt") || n.includes("openai")) return "ChatGPT";
  if (n.includes("gemini") || n.includes("google")) return "Gemini";
  return clientName || "AI app";
}

/** Roles that may be given the connector: Carres's own staff. Store logins (dealer, salesperson, showroom) and
 *  outside parties are never offered it; they have no Carres staff login here. */
export const MCP_ELIGIBLE_ROLES: readonly string[] = ["principal", "operation", "finance", "bd", "hr"];

/** The connector admin: the principal (Chairman, de-facto super-admin; lib/auth-guards.ts). */
export const isMcpAdminRole = (role: string | null | undefined): boolean => role === "principal";
