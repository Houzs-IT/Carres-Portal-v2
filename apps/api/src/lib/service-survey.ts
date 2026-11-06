import type { SupabaseClient } from "@supabase/supabase-js";
import { newLinkToken } from "../routes/operation/delivery-links";
import type { Bindings } from "../types";

/** Houzs services/assr.ts:2349-2389: a survey goes stale fast, and the link names the customer. */
export const SURVEY_TTL_DAYS = 90;

/** One live token per case: reuse an unanswered, unexpired one, else mint. */
export async function issueSurveyToken(sb: SupabaseClient, caseId: string): Promise<string> {
  const { data: live, error } = await sb
    .from("service_case_survey_tokens")
    .select("token")
    .eq("case_id", caseId)
    .is("submitted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const existing = (live ?? [])[0] as { token: string } | undefined;
  if (existing) return existing.token;
  const token = newLinkToken();
  const expiresAt = new Date(Date.now() + SURVEY_TTL_DAYS * 86_400_000).toISOString();
  const { error: insErr } = await sb.from("service_case_survey_tokens").insert({ token, case_id: caseId, expires_at: expiresAt });
  if (insErr) throw insErr;
  return token;
}

export function surveyLink(env: Bindings, token: string): string {
  return `${(env.PUBLIC_WEB_URL ?? "https://carres-portal.pages.dev").replace(/\/$/, "")}/survey/${token}`;
}

/**
 * Houzs services/assrCompletionSurvey.ts: when a case closes, email the survey link to its
 * survey email. Sends nothing without RESEND_API_KEY and SURVEY_EMAIL_FROM, or without an
 * address. Success is provider dispatch, never receipt. Never throws: a mail fault must not
 * undo the close.
 */
export async function sendCompletionSurvey(env: Bindings, sb: SupabaseClient, caseId: string, transport: typeof fetch = fetch): Promise<"dispatched" | "skipped" | "failed"> {
  try {
    if (!env.RESEND_API_KEY || !env.SURVEY_EMAIL_FROM) return "skipped";
    const { data } = await sb.from("service_cases").select("case_no, customer_name, survey_email").eq("id", caseId).maybeSingle();
    const row = data as { case_no: string; customer_name: string | null; survey_email: string | null } | null;
    if (!row?.survey_email) return "skipped";
    const link = surveyLink(env, await issueSurveyToken(sb, caseId));
    const name = (row.customer_name ?? "").split(" ")[0] || "there";
    const res = await transport("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `survey-${caseId}` },
      body: JSON.stringify({
        from: env.SURVEY_EMAIL_FROM,
        to: [row.survey_email],
        subject: `How was your experience with case ${row.case_no}?`,
        text: `Thanks for your patience, ${name}.\n\nWe have finished your service case ${row.case_no}. Your feedback helps us improve.\n\nRate your experience: ${link}\n\nIt takes about 30 seconds: one rating and an optional note.\n\nCarres`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? "dispatched" : "failed";
  } catch {
    return "failed";
  }
}
