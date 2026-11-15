import type { Bindings } from "../types";
import { adminClient, CARRES_API_HEADER } from "./supabase";

/* THE API DOOR (owner, 16 Nov 2026; migrations 0778, 0779).
 *
 * What Carres pays for an item and who Carres buys it from are for Carres's internal roles. A store login still
 * needs the product tables to sell, and the same rows hold the cost. Row-level security chooses rows, never
 * columns, so the database answers an account that is not internal on those tables ONLY when the request came
 * through this API: the request carries a value the database also holds, and only this Worker can read it.
 *
 * The door opens per route, never per account. It is open on the routes below, which a store needs and whose
 * answers carry no cost and no supplier. On every other route a store's read of those tables finds nothing, so a
 * route written for the office cannot hand a store its cost by accident. A NEW route that must read the product
 * tables for a store is added here, after checking what it sends back.
 *
 * Internal roles never need the door: their own policy branch answers them.
 */

type DoorRoute = { method?: string; exact?: string; prefix?: string };

const DOOR_ROUTES: readonly DoorRoute[] = [
  // The catalogue a store sells from. The route removes cost and supplier for a role that does not see cost.
  { method: "GET", exact: "/api/catalog" },
  // Placing, pricing and changing an order: the price, lead-time and promotion checks read the product tables.
  { prefix: "/api/orders" },
  // Purchase-with-purchase codes: the same rule checks.
  { prefix: "/api/pwp-codes" },
];

export function opensApiDoor(method: string, path: string): boolean {
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return DOOR_ROUTES.some((route) => {
    if (route.method && route.method !== method.toUpperCase()) return false;
    if (route.exact) return clean === route.exact;
    return clean === route.prefix || clean.startsWith(`${route.prefix}/`);
  });
}

/* The value lives in the database (private.carres_api_secret) and is read with the service key, so it needs no
 * Worker secret of its own and replacing it is one UPDATE. It is held per isolate: read on the first request that
 * needs it, read again every five minutes. A failed read keeps the value already held; it is never logged and
 * never sent to a browser. */
const FRESH_MS = 5 * 60_000;
const RETRY_MS = 15_000;

let held: { secret: string; at: number } | null = null;
let lastFailedAt = 0;
let loading: Promise<string | null> | null = null;

async function readSecret(env: Bindings): Promise<string | null> {
  try {
    const { data, error } = await adminClient(env).rpc("carres_api_secret");
    if (error || typeof data !== "string" || data.length < 32) {
      console.error("[api-door] the database did not hand over the API's value:", error?.message ?? "empty answer");
      return null;
    }
    return data;
  } catch (e) {
    console.error("[api-door] the database did not hand over the API's value:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}

/** The value to send, or null when the database has never handed one over. */
export async function carresApiSecret(env: Bindings): Promise<string | null> {
  const now = Date.now();
  if (held && now - held.at < FRESH_MS) return held.secret;
  if (held && now - lastFailedAt < RETRY_MS) return held.secret;
  loading ??= readSecret(env)
    .then((secret) => {
      if (secret) held = { secret, at: Date.now() };
      else lastFailedAt = Date.now();
      return secret;
    })
    .finally(() => {
      loading = null;
    });
  const fresh = await loading;
  return fresh ?? held?.secret ?? null;
}

/** Test-only: hold a value without asking the database (null forgets it). */
export function _setCarresApiSecretForTesting(secret: string | null): void {
  held = secret ? { secret, at: Number.POSITIVE_INFINITY } : null;
  lastFailedAt = 0;
  loading = null;
}

/* GET /health/api-door: does the header reach the database and match? Asked with the service key, so it says
 * nothing about any account; the answer is held for a minute so the public URL cannot be used to load the
 * database. A deploy reads this BEFORE a policy is made to depend on the header. */
const CHECK_MS = 60_000;
let checked: { ok: boolean; at: number } | null = null;

export async function apiDoorReaches(env: Bindings): Promise<boolean> {
  const now = Date.now();
  if (checked && now - checked.at < CHECK_MS) return checked.ok;
  let ok = false;
  const secret = await carresApiSecret(env);
  if (secret) {
    try {
      const { data, error } = await adminClient(env).rpc("carres_api_door_check").setHeader(CARRES_API_HEADER, secret);
      ok = !error && data === true;
    } catch {
      ok = false;
    }
  }
  checked = { ok, at: Date.now() };
  return ok;
}

/** Test-only: forget the last answer of the deploy check. */
export function _forgetApiDoorCheckForTesting(): void {
  checked = null;
}
