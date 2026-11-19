// Carres only (not part of Houzs's code): Forgot password, from the ask to the email.
//
// A supplier person who forgot their password asks for a link on the sign-in page. The route (./routes.ts) answers
// at once with the same words for every email, and this runs after that answer has left. So nothing here can tell
// the caller whether an email signs in: not the answer, and not the time it took.
//
// The link is the same one-time link Carres makes in Settings › Supplier Access (./session.ts issueLink), with an
// hour to live instead of three days. Only its SHA-256 is stored. The email is handed straight to the mail
// provider (./mail.ts says why the engine's own sender is not used).
import type { Env } from "../../types";
import { getBranding } from "../../services/branding";
import { isChannelEnabled } from "../../services/email";
import { pagesUrl } from "./address";
import { logisticsName } from "./deliveries";
import { dbFor } from "./db";
import { resetMail, sendMail, type Mail, type MailResult } from "./mail";
import { requestReset, settleReset } from "./session";

/** The three things this reaches outside the platform's own tables, so a test can stand in for each. */
export interface ResetDeps {
  /** The company's public name (Settings › Branding), for the message. */
  companyName: (env: Env) => Promise<string>;
  /** Whether Carres has the supplier emails on (Settings › Email: the master switch and `Supplier portal invites`). */
  mailOn: (env: Env) => Promise<boolean>;
  send: (env: Env, to: string, mail: Mail) => Promise<MailResult>;
}

const live: ResetDeps = {
  companyName: async (env) => (await getBranding(env)).companyName,
  mailOn: (env) => isChannelEnabled(env, "supplier_invite"),
  send: (env, to, mail) => sendMail(env, to, mail),
};

let current: ResetDeps = live;

/** Tests only: stand in for the company name, the switch and the mail provider (tests-pg runs the route against a
 *  disposable database and sends nothing). Returns the undo. */
export function useResetDepsForTests(deps: ResetDeps): () => void {
  const before = current;
  current = deps;
  return () => { current = before; };
}

/**
 * Make the link and email it, if this email is a person who may sign in. Never throws and answers nothing: what
 * happened is written to the platform's own record (an ask that was emailed, or was not and why), which Carres
 * reads under Latest activity. The link itself is written nowhere.
 */
export async function sendResetLink(env: Env, input: { email: unknown; ip: string | null }, deps: ResetDeps = current): Promise<void> {
  const db = dbFor(env);
  const ask = await requestReset(db, input);
  if (!ask) return;
  let result: MailResult;
  try {
    if (!(await deps.mailOn(env))) {
      result = { status: "not_sent", reason: "Supplier emails are switched off in Settings." };
    } else {
      // A 3PL's person is sent to the 3PL address, never to one that says "supplier".
      const logistics = (await logisticsName(db, ask.supplierId)) !== null;
      const url = `${pagesUrl(env, logistics, "/supplier/setup")}#t=${ask.token}`;
      const mail = resetMail({ name: ask.name, companyName: await deps.companyName(env), url, setup: ask.purpose === "setup" });
      result = await deps.send(env, ask.email, mail);
    }
  } catch {
    // The error is not logged: it may quote the message, and the message holds the link.
    result = { status: "not_sent", reason: "The message could not be made." };
  }
  await settleReset(db, ask.askId, result.status === "sent", result.status === "sent" ? null : result.reason);
}
