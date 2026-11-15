import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";

/** The header that tells the database a request came through this API (lib/api-door.ts; migration 0778). */
export const CARRES_API_HEADER = "x-carres-api";

// `env.CARRES_API_SECRET` is set for ONE request by middleware/api-door.ts, and only on a route where the door
// is open for the caller. Without it the client is exactly what it always was.
export function userClient(env: Bindings, jwt: string): SupabaseClient {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (env.CARRES_API_SECRET) headers[CARRES_API_HEADER] = env.CARRES_API_SECRET;
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// RED LINE: service_role bypasses RLS. Only call from cron, admin, or
// account-creation routes. Never echo this client (or its data) back to the
// browser without explicit per-row RLS-equivalent checks.
export function adminClient(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
