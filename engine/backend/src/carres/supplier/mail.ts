// Carres only (not part of Houzs's code): the one email the Supplier Platform sends, the link a person asked for
// with Forgot password.
//
// WHY IT DOES NOT GO THROUGH THE ENGINE'S OWN SENDER (services/email.ts sendEmail). That sender keeps a copy of
// every message in email_outbox, body and all, so a failed send can be tried again. This message carries the
// one-time link, and the platform's rule is that a link exists in the person's hands alone: the database keeps only
// its SHA-256 (migration 2012), so a copy of the database signs nobody in. So the message is handed to the mail
// provider directly, and nothing of its body is written anywhere here. A send that fails is not tried again: the
// person asks again, and the reason is kept (without the link) in the platform's own record.
import { MIN_PASSWORD, RESET_LINK_HOURS } from "./credentials";

export type MailEnv = { RESEND_API_KEY?: string; EMAIL_FROM?: string };

export type MailResult =
  | { status: "sent" }
  | { status: "not_sent"; reason: string };

export interface Mail { subject: string; html: string; text: string }

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** How long the link lives, in words. */
const life = (hours: number): string => (hours === 1 ? "1 hour" : `${hours} hours`);

/**
 * The message. Words: docs/COPY-STANDARD.md "Supplier Platform words".
 *
 * `url` carries the link's secret after the `#`. A browser never sends that part to a server, so it reaches no
 * access log even when a mail program opens the link through a checking service first.
 */
export function resetMail(p: { name: string; companyName: string; url: string; setup: boolean }): Mail {
  const company = p.companyName.trim() || "Carres";
  const act = p.setup ? "Choose your password" : "Choose a new password";
  const lines = [
    `Hello ${p.name},`,
    `Someone asked for a link to ${p.setup ? "choose the" : "choose a new"} password for your ${company} supplier account.`,
    `The link works once, for ${life(RESET_LINK_HOURS)}. Use at least ${MIN_PASSWORD} characters.`,
    `If you did not ask for this, do nothing. Your password stays as it is.`,
  ];
  const text = [lines[0], "", lines[1], "", `${act}:`, p.url, "", lines[2], "", lines[3], "", company].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:8px;padding:24px">
<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${esc(lines[0]!)}</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.5">${esc(lines[1]!)}</p>
<p style="margin:0 0 20px"><a href="${esc(p.url)}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px">${esc(act)}</a></p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#57534e">${esc(lines[2]!)}</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#57534e">${esc(lines[3]!)}</p>
<p style="margin:0;font-size:12px;color:#78716c">${esc(company)}</p>
</div></body></html>`;
  return { subject: act, html, text };
}

type Post = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Hand the message to the mail provider (Resend, the provider the engine already uses). The answer says only
 * whether it left. The reason for a failure is one of a few fixed sentences: nothing the provider answers is
 * passed on, so nothing of the message can come back through it.
 */
export async function sendMail(env: MailEnv, to: string, mail: Mail, post: Post = fetch): Promise<MailResult> {
  if (!env.RESEND_API_KEY) return { status: "not_sent", reason: "Email is not set up." };
  const from = (env.EMAIL_FROM ?? "").trim() || "Carres <noreply@carresofficial.com>";
  let res: Response;
  try {
    res = await post("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
  } catch {
    return { status: "not_sent", reason: "The mail service could not be reached." };
  }
  if (!res.ok) return { status: "not_sent", reason: `The mail service refused the message (${res.status}).` };
  return { status: "sent" };
}
