// Carres only (not part of Houzs's code): the invite a supplier's admin sends to a new person of their company.
//
// The admin adds the person in Settings › Users and access (./people.ts) and chooses "Send invite email": the
// person is sent the same one-time link Carres makes (./session.ts issueLink). Unlike Forgot password, the admin is
// told at once whether the email left: they are signed in, they typed the address, and they need to know whether to
// try again. The link itself is still kept nowhere but in the message: it goes straight to the mail provider
// (./mail.ts says why the engine's own sender is not used), and only its SHA-256 is stored.
import type { Env } from "../../types";
import { getBranding } from "../../services/branding";
import { isChannelEnabled } from "../../services/email";
import { supplierPublicUrl } from "./address";
import { inviteMail, sendMail, type Mail, type MailResult } from "./mail";

/** The three things this reaches outside the platform's own tables, so a test can stand in for each. */
export interface InviteDeps {
  companyName: (env: Env) => Promise<string>;
  /** Whether Carres has the supplier emails on (Settings › Email: the master switch and `Supplier portal invites`). */
  mailOn: (env: Env) => Promise<boolean>;
  send: (env: Env, to: string, mail: Mail) => Promise<MailResult>;
}

const live: InviteDeps = {
  companyName: async (env) => (await getBranding(env)).companyName,
  mailOn: (env) => isChannelEnabled(env, "supplier_invite"),
  send: (env, to, mail) => sendMail(env, to, mail),
};

let current: InviteDeps = live;

/** Tests only: stand in for the company name, the switch and the mail provider. Returns the undo. */
export function useInviteDepsForTests(deps: InviteDeps): () => void {
  const before = current;
  current = deps;
  return () => { current = before; };
}

/** Email the invite. Never throws: the answer says whether it left, and if not, why, in fixed words. */
export async function sendInvite(
  env: Env,
  p: { to: string; name: string; inviterName: string; supplierName: string; token: string },
  deps: InviteDeps = current,
): Promise<MailResult> {
  try {
    if (!(await deps.mailOn(env))) return { status: "not_sent", reason: "Supplier emails are switched off at Carres." };
    const url = `${supplierPublicUrl(env, "/supplier/setup")}#t=${p.token}`;
    const mail = inviteMail({ name: p.name, inviterName: p.inviterName, supplierName: p.supplierName, companyName: await deps.companyName(env), url });
    return await deps.send(env, p.to, mail);
  } catch {
    // The error is not logged: it may quote the message, and the message holds the link.
    return { status: "not_sent", reason: "The message could not be made." };
  }
}
