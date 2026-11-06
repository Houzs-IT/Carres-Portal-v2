import { Hono, type Context } from "hono";
import { adminClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * THE CUSTOMER SATISFACTION SURVEY (0765) — Houzs backend/src/routes/survey.ts.
 *
 * Mounted OUTSIDE the signed-in `/api` group: the customer has no login. The
 * 256-bit token is the whole trust boundary. Unknown and expired share one 404
 * so the token space cannot be probed for which cases exist. Every write binds
 * the case the token names, never a route param.
 *
 * ```
 * GET  /:token   the case number and customer name, and any rating already given
 * POST /:token   { rating 1 to 5, notes? } once
 * ```
 */
const publicServiceSurveyRouter = new Hono<AppEnv>();

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const GONE = "This survey link has expired or does not exist.";

type TokenRow = { case_id: string; submitted_at: string | null; expires_at: string };

async function resolve(c: Context<AppEnv>, token: string): Promise<TokenRow | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await adminClient(c.env)
    .from("service_case_survey_tokens")
    .select("case_id, submitted_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  const row = data as TokenRow | null;
  return row && new Date(row.expires_at).getTime() > Date.now() ? row : null;
}

publicServiceSurveyRouter.get("/:token", async (c) => {
  const tok = await resolve(c, c.req.param("token"));
  if (!tok) return c.json({ error: "survey_gone", message: GONE }, 404);
  const { data, error } = await adminClient(c.env)
    .from("service_cases")
    .select("case_no, customer_name, satisfaction_rating, satisfaction_notes")
    .eq("id", tok.case_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return c.json({ error: "survey_gone", message: GONE }, 404);
  const r = data as { case_no: string; customer_name: string | null; satisfaction_rating: number | null; satisfaction_notes: string | null };
  return c.json({
    alreadySubmitted: !!tok.submitted_at,
    caseNo: r.case_no,
    customerName: r.customer_name,
    rating: r.satisfaction_rating,
    notes: r.satisfaction_notes,
  });
});

publicServiceSurveyRouter.post("/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.json<{ rating?: unknown; notes?: unknown }>().catch(() => ({}) as { rating?: unknown; notes?: unknown });
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json({ error: "invalid_input", message: "Pick a rating from 1 to 5." }, 400);
  }
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;

  const tok = await resolve(c, token);
  if (!tok) return c.json({ error: "survey_gone", message: GONE }, 404);
  if (tok.submitted_at) return c.json({ error: "already_submitted", message: "This survey was already answered. Thank you." }, 409);

  const sb = adminClient(c.env);
  // Mark the token first: a second submit loses the race instead of overwriting the rating.
  const { data: claimed, error: claimErr } = await sb
    .from("service_case_survey_tokens")
    .update({ submitted_at: new Date().toISOString() })
    .eq("token", token)
    .is("submitted_at", null)
    .select("token");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) return c.json({ error: "already_submitted", message: "This survey was already answered. Thank you." }, 409);

  const { error } = await sb
    .from("service_cases")
    .update({ satisfaction_rating: rating, satisfaction_notes: notes })
    .eq("id", tok.case_id);
  if (error) throw error;
  return c.json({ ok: true });
});

export default publicServiceSurveyRouter;
