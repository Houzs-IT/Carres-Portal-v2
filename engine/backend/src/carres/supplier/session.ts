// Carres only (not part of Houzs's code): who a supplier person is, and how they sign in.
//
// THE RULE THIS FILE KEEPS (owner, 15 Nov 2026): a supplier's login is never a way into Carres's system.
//   * A supplier person is a row in carres_supplier_users. It is not an engine user and not a portal account, so
//     nothing that checks a staff session (middleware/auth.ts reads public.sessions) can ever accept their token,
//     and no staff token is accepted here (this file reads carres_supplier_sessions only).
//   * The token is random, lives in their browser, and is stored here only as its SHA-256.
//   * Each request re-reads the person, their status and their supplier's access: disabling any of the three ends
//     the session on the next request, with nothing to revoke.
//   * A wrong password is counted per EMAIL, in the database itself, so the lock holds even when a cache is down.
//     Each try is written before it is counted (takeTry below), so tries sent at the same moment cannot all slip
//     under the limit. The answer is the same whether or not the email exists.
//   * Nothing is counted per address. Behind the engine site's /api proxy every browser arrives under one address
//     (./credentials.ts callerAddress), so a count per address would either stop nobody or, counted on that shared
//     address, let one outsider refuse every supplier. `ip` is kept only as a record of where a try came from.
import type { Db } from "./db";
import { bool, first, int, str } from "./db";
import {
  FAIL_WINDOW_MINUTES, LINK_HOURS, MAX_FAILS_PER_EMAIL, MAX_PASSWORD, MAX_RESET_MAILS_PER_EMAIL, RESET_LINK_HOURS,
  RESET_WINDOW_MINUTES, SESSION_HOURS,
  decoyHash, hashPassword, isEmail, newToken, normEmail, passwordProblem, sha256Hex, verifyPassword,
} from "./credentials";

export interface SupplierUser {
  id: number;
  name: string;
  email: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  canOperation: boolean;
  canFinance: boolean;
  /** This supplier is paid a share of subscription collections (Settings › Supplier Access). */
  subscriptionShare: boolean;
}

export type Outcome<T> = ({ ok: true } & T) | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 429; error: string };

const WRONG = "Email or password is incorrect.";
const LOCKED = `Too many attempts. Wait ${FAIL_WINDOW_MINUTES} minutes and try again.`;

export interface EventInput {
  kind: string;
  supplierId?: string | null;
  supplierUserId?: number | null;
  staffUserId?: number | null;
  subject?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

/** One line in the platform's own record. Never holds a password, a token or a link. */
export async function recordEvent(db: Db, e: EventInput): Promise<void> {
  await db.query(
    `INSERT INTO public.carres_supplier_events (kind, supplier_id, supplier_user_id, staff_user_id, subject, ip, detail)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::text::jsonb)`,
    [e.kind, e.supplierId ?? null, e.supplierUserId ?? null, e.staffUserId ?? null, e.subject ?? null, e.ip ?? null,
      JSON.stringify(e.detail ?? {})],
  );
}

const USER_COLUMNS = `
  u.id, u.name, u.email, u.supplier_id::text AS supplier_id, u.can_operation, u.can_finance,
  s.code AS supplier_code, s.name AS supplier_name, a.subscription_share`;

/** Always true, and it keeps a statement that reads a password from ever being answered out of a cache. The
 *  engine's database link (Hyperdrive) is set up with caching off, and it never caches a statement that asks the
 *  time (developers.cloudflare.com/hyperdrive/concepts/query-caching: caching is ON unless turned off, answers
 *  are kept a minute, and NOW() is found by its text). With this in the two statements that read a password, an
 *  old password cannot outlive a reset by that minute even if the setting is one day turned on. Every other read
 *  that decides who is let in (a session, a link, the count of wrong tries) already asks the time. */
const FRESH = "NOW() IS NOT NULL";

function toUser(r: Record<string, unknown>): SupplierUser {
  return {
    id: int(r.id),
    name: str(r.name),
    email: str(r.email),
    supplierId: str(r.supplier_id),
    supplierCode: str(r.supplier_code),
    supplierName: str(r.supplier_name),
    canOperation: bool(r.can_operation),
    canFinance: bool(r.can_finance),
    subscriptionShare: bool(r.subscription_share),
  };
}

/**
 * Open a session for a person, IF the password that was just checked is still the one stored.
 *
 * The check and the insert are ONE statement, and the person's row is locked for it. Apart, a sign-in that read
 * the old password a moment before a reset could put its session in a moment after the reset had thrown every
 * session out, and an old password would have opened a session that outlives it by twelve hours. As one locked
 * statement it either lands before the reset, whose own delete then removes it, or waits for the reset and finds
 * another password. Null when the password has changed, or the person or their supplier's access is no longer on.
 */
async function openSession(
  db: Db, userId: number, checkedHash: string, ip: string | null, userAgent: string | null,
): Promise<{ token: string; expiresAt: string } | null> {
  const token = newToken();
  const rows = await db.query<{ expires_at: string }>(
    `INSERT INTO public.carres_supplier_sessions (token_hash, user_id, expires_at, ip, user_agent)
     SELECT $1, u.id, now() + make_interval(hours => $3), $4, $5
       FROM public.carres_supplier_users u
       JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id AND a.enabled
      WHERE u.id = $2 AND u.status = 'active' AND u.password_hash = $6
        FOR SHARE OF u
     RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
    [await sha256Hex(token), userId, SESSION_HOURS, ip, userAgent ? userAgent.slice(0, 300) : null, checkedHash],
  );
  const row = first(rows);
  return row ? { token, expiresAt: str(row.expires_at) } : null;
}

/** Where a try at a password was made: signing in, or the current password on Change password. */
type TryDoor = "signin" | "password_change";

/**
 * The wrong tries at this email's password that still count: every one inside the window, at EITHER door, since
 * the person last chose a password through a link. `atDoor` says how many of them were made at one door.
 *
 * ONLY A LINK STARTS THE COUNT AGAIN, which makes a new link the way Carres lets a locked person back in. A good
 * sign-in does not start it again. If it did, an email whose owner signs in would forgive tries that an unknown
 * email never forgives, and that difference would tell an outsider which emails are real. A good try needs no
 * forgiving anyway: its row stops being a wrong try.
 */
async function wrongTries(db: Db, email: string, door: TryDoor): Promise<{ all: number; atDoor: number }> {
  const rows = await db.query<{ all_tries: number; door_tries: number }>(
    `SELECT count(*)::int AS all_tries,
            (count(*) FILTER (WHERE f.detail->>'via' = $3))::int AS door_tries
       FROM public.carres_supplier_events f
      WHERE f.kind = 'signin_failed' AND f.subject = $1
        AND f.at > now() - make_interval(mins => $2)
        AND f.at > coalesce((SELECT max(g.at) FROM public.carres_supplier_events g
                              WHERE g.kind = 'password_set' AND g.subject = $1), '-infinity'::timestamptz)`,
    [email, FAIL_WINDOW_MINUTES, door],
  );
  const r = first(rows);
  return { all: int(r?.all_tries), atDoor: int(r?.door_tries) };
}

/** A try that may go on to a password check, or a refusal. `atThisDoor`: the tries that locked the email were made
 *  at the door now being tried, not at the other one. */
type Try = { ok: true; id: number } | { ok: false; atThisDoor: boolean };

/**
 * Take one try at this email's password.
 *
 * THE TRY IS WRITTEN BEFORE IT IS COUNTED. Counted first, tries sent at the same moment each read a count under the
 * limit and each got a real password check, so the limit held only against a caller polite enough to wait. Written
 * first, the n-th try to count finds at least n rows (its own and every earlier one), so no more than
 * MAX_FAILS_PER_EMAIL passwords are checked in a window however the tries arrive, and at whichever door: the two
 * doors share the one count.
 *
 * The row is written as a wrong try and stays one unless the caller turns it into something else: a crash between
 * here and the answer counts against the email, never for it.
 */
async function takeTry(
  db: Db, t: { email: string; door: TryDoor; ip: string | null; supplierId: string | null; supplierUserId: number | null },
): Promise<Try> {
  // Already locked: refused without writing, so hammering a locked email adds no rows.
  const before = await wrongTries(db, t.email, t.door);
  if (before.all >= MAX_FAILS_PER_EMAIL) return { ok: false, atThisDoor: before.atDoor >= MAX_FAILS_PER_EMAIL };
  const made = await db.query<{ id: number }>(
    `INSERT INTO public.carres_supplier_events (kind, supplier_id, supplier_user_id, subject, ip, detail)
     VALUES ('signin_failed', $1::uuid, $2, $3, $4, $5::text::jsonb)
     RETURNING id`,
    [t.supplierId, t.supplierUserId, t.email, t.ip, JSON.stringify({ via: t.door })],
  );
  const after = await wrongTries(db, t.email, t.door);
  if (after.all > MAX_FAILS_PER_EMAIL) return { ok: false, atThisDoor: after.atDoor > MAX_FAILS_PER_EMAIL };
  return { ok: true, id: int(first(made)?.id) };
}

export async function signIn(
  db: Db, input: { email: unknown; password: unknown; ip: string | null; userAgent: string | null },
): Promise<Outcome<{ token: string; expiresAt: string; user: SupplierUser }>> {
  const email = normEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!isEmail(email) || !password || password.length > MAX_PASSWORD) return { ok: false, status: 401, error: WRONG };

  // The same statements run whether or not the email exists, so neither the answer nor the time it takes tells.
  // `now()` is in the statement on purpose (FRESH below): the password checked must be the one stored this moment.
  const found = await db.query(
    `SELECT ${USER_COLUMNS}, u.password_hash, u.status, a.enabled
       FROM public.carres_supplier_users u
       JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id
       JOIN scm.suppliers s ON s.id = u.supplier_id
      WHERE u.email = $1 AND ${FRESH}`,
    [email],
  );
  const row = first(found);
  const tried = await takeTry(db, {
    email, door: "signin", ip: input.ip,
    supplierId: row ? str(row.supplier_id) : null, supplierUserId: row ? int(row.id) : null,
  });
  if (!tried.ok) return { ok: false, status: 429, error: LOCKED };

  // Always one full password check, against a decoy when there is nothing real to check.
  const stored = row && typeof row.password_hash === "string" && row.password_hash ? row.password_hash : await decoyHash();
  const matches = await verifyPassword(password, stored);
  const allowed = !!row && !!row.password_hash && matches && row.status === "active" && bool(row.enabled);
  if (!allowed) return { ok: false, status: 401, error: WRONG };

  const user = toUser(row);
  await db.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1 AND expires_at <= now()`, [user.id]);
  // Only if the password just checked is still the stored one (openSession says why). If it is not, this was a
  // try with an old password: the row stays a wrong try and the answer is the one for any wrong password.
  const session = await openSession(db, user.id, stored, input.ip, input.userAgent);
  if (!session) return { ok: false, status: 401, error: WRONG };
  // The try was good: its row stops being a wrong try and becomes the record of the sign-in.
  await db.query(`UPDATE public.carres_supplier_events SET kind = 'signin' WHERE id = $1`, [tried.id]);
  await db.query(`UPDATE public.carres_supplier_users SET last_login_at = now() WHERE id = $1`, [user.id]);
  return { ok: true, ...session, user };
}

/** The person behind a bearer token, or null. Read on every request, so a disabled person or supplier is out at once. */
export async function resolveSession(db: Db, token: string): Promise<SupplierUser | null> {
  if (!token || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const rows = await db.query(
    `SELECT ${USER_COLUMNS}, (ses.last_seen_at < now() - interval '5 minutes') AS stale
       FROM public.carres_supplier_sessions ses
       JOIN public.carres_supplier_users u ON u.id = ses.user_id AND u.status = 'active'
       JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id AND a.enabled
       JOIN scm.suppliers s ON s.id = u.supplier_id
      WHERE ses.token_hash = $1 AND ses.expires_at > now()`,
    [hash],
  );
  const row = first(rows);
  if (!row) return null;
  if (bool(row.stale)) {
    await db.query(`UPDATE public.carres_supplier_sessions SET last_seen_at = now() WHERE token_hash = $1`, [hash]);
  }
  return toUser(row);
}

export async function signOut(db: Db, token: string): Promise<void> {
  if (!token) return;
  await db.query(`DELETE FROM public.carres_supplier_sessions WHERE token_hash = $1`, [await sha256Hex(token)]);
}

/** Whether a set-password link can still be used, and for whom. */
export async function readLink(db: Db, token: string): Promise<{ name: string; email: string; purpose: string } | null> {
  if (!token || token.length > 200) return null;
  const rows = await db.query(
    `SELECT u.name, u.email, l.purpose
       FROM public.carres_supplier_links l
       JOIN public.carres_supplier_users u ON u.id = l.user_id AND u.status = 'active'
      WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > now()`,
    [await sha256Hex(token)],
  );
  const r = first(rows);
  return r ? { name: str(r.name), email: str(r.email), purpose: str(r.purpose) } : null;
}

/** What choosing a password through a link answers. `session` is null when the supplier's access is off: the
 *  password is saved and nobody is signed in. */
export interface LinkUsed { email: string; session: { token: string; expiresAt: string; user: SupplierUser } | null }

/**
 * Choose a password through a link. The link works once, every session the person had ends, and THE LINK SIGNS
 * THE PERSON IN.
 *
 * Why it signs them in: a person whose email is being hammered with wrong tries is locked, and the link is how
 * Carres lets them back in. Sent to the sign-in page to type the new password, they would be locked again by the
 * next few wrong tries before they got there, and the link would have unlocked nothing. Holding the link is
 * already the right to choose the password; signing in with it adds no power.
 */
export async function useLink(
  db: Db, input: { token: string; password: unknown; ip: string | null; userAgent?: string | null },
): Promise<Outcome<LinkUsed>> {
  const hash = input.token && input.token.length <= 200 ? await sha256Hex(input.token) : "";
  return db.tx(async (tx): Promise<Outcome<LinkUsed>> => {
    const rows = await tx.query(
      `SELECT ${USER_COLUMNS}
         FROM public.carres_supplier_links l
         JOIN public.carres_supplier_users u ON u.id = l.user_id AND u.status = 'active'
         JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id
         JOIN scm.suppliers s ON s.id = u.supplier_id
        WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > now()
        FOR UPDATE OF l`,
      [hash],
    );
    const link = first(rows);
    if (!link) return { ok: false, status: 404, error: "This link is no longer valid. Ask Carres for a new one." };
    const user = toUser(link);
    const problem = passwordProblem(input.password, user.email);
    if (problem) return { ok: false, status: 400, error: problem };
    const nextHash = await hashPassword(input.password as string);
    await tx.query(`UPDATE public.carres_supplier_users SET password_hash = $2, updated_at = now() WHERE id = $1`, [user.id, nextHash]);
    // This link is spent, and so is any other link still waiting for this person.
    await tx.query(`UPDATE public.carres_supplier_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [user.id]);
    await recordEvent(tx, { kind: "password_set", subject: user.email, ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id });
    const session = await openSession(tx, user.id, nextHash, input.ip, input.userAgent ?? null);
    if (!session) return { ok: true, email: user.email, session: null };
    await tx.query(`UPDATE public.carres_supplier_users SET last_login_at = now() WHERE id = $1`, [user.id]);
    await recordEvent(tx, {
      kind: "signin", subject: user.email, ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id, detail: { via: "link" },
    });
    return { ok: true, email: user.email, session: { ...session, user } };
  });
}

/**
 * Change one's own password. Every session ends and a new one is opened for this browser.
 *
 * A wrong current password is a wrong try at this person's password, counted with the sign-in tries in the one
 * count: an open session (a shared warehouse computer, a stolen token) must not be a second set of guesses, or a
 * way to guess at full speed.
 *
 * When the email is locked, WHERE the wrong tries were made decides what happens to the person who is signed in.
 * Made here, whoever is at this keyboard is guessing: every session of the person ends. Made at the sign-in page,
 * an outsider is guessing: the person stays signed in and only waits, like anyone, before a password is checked.
 */
export async function changePassword(
  db: Db, user: SupplierUser, input: { current: unknown; next: unknown; ip: string | null; userAgent: string | null },
): Promise<Outcome<{ token: string; expiresAt: string }>> {
  const current = typeof input.current === "string" ? input.current : "";
  const rows = await db.query(`SELECT password_hash FROM public.carres_supplier_users WHERE id = $1 AND ${FRESH}`, [user.id]);
  const hash = first(rows)?.password_hash;
  const stored = typeof hash === "string" ? hash : "";
  const tried = await takeTry(db, {
    email: user.email, door: "password_change", ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id,
  });
  if (!tried.ok) {
    if (!tried.atThisDoor) return { ok: false, status: 429, error: LOCKED };
    await db.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [user.id]);
    return { ok: false, status: 401, error: LOCKED };
  }
  if (!current || current.length > MAX_PASSWORD || !stored || !(await verifyPassword(current, stored))) {
    return { ok: false, status: 400, error: "Your current password is incorrect." };
  }
  // The current password was right, so this was not a wrong try.
  await db.query(`DELETE FROM public.carres_supplier_events WHERE id = $1 AND kind = 'signin_failed'`, [tried.id]);
  const problem = passwordProblem(input.next, user.email);
  if (problem) return { ok: false, status: 400, error: problem };
  if (input.next === current) return { ok: false, status: 400, error: "Choose a password you have not used here." };
  const nextHash = await hashPassword(input.next as string);
  return db.tx(async (tx): Promise<Outcome<{ token: string; expiresAt: string }>> => {
    // Only where the password that was just checked is still the stored one: a reset that landed in between wins.
    const changed = await tx.query(
      `UPDATE public.carres_supplier_users SET password_hash = $2, updated_at = now()
        WHERE id = $1 AND password_hash = $3
        RETURNING id`,
      [user.id, nextHash, stored],
    );
    if (!first(changed)) return { ok: false, status: 400, error: "Your current password is incorrect." };
    await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [user.id]);
    const session = await openSession(tx, user.id, nextHash, input.ip, input.userAgent);
    // The person or the supplier's access was turned off meanwhile: the password is changed, nobody is signed in.
    if (!session) return { ok: false, status: 401, error: "Your session has ended. Please sign in again." };
    await recordEvent(tx, { kind: "password_changed", subject: user.email, ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id });
    return { ok: true, ...session };
  });
}

/** A new one-time set-password link for a person. Older unused links stop working. The token is returned ONCE, to
 *  be sent to the person; only its hash is kept. Carres makes one from Settings (`staffUserId`); a person makes one
 *  for themselves with Forgot password (`forgot`), and that one lives an hour, not three days. */
export async function issueLink(
  db: Db, input: { userId: number; staffUserId: number | null; forgot?: boolean },
): Promise<{ token: string; purpose: "setup" | "reset"; expiresAt: string } | null> {
  return db.tx(async (tx) => {
    const rows = await tx.query(
      `SELECT id, email, supplier_id::text AS supplier_id, (password_hash IS NOT NULL) AS has_password, status
         FROM public.carres_supplier_users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    const u = first(rows);
    if (!u || u.status !== "active") return null;
    const purpose: "setup" | "reset" = bool(u.has_password) ? "reset" : "setup";
    await tx.query(`UPDATE public.carres_supplier_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [input.userId]);
    const token = newToken();
    const made = await tx.query<{ expires_at: string }>(
      `INSERT INTO public.carres_supplier_links (token_hash, user_id, purpose, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
       RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
      [await sha256Hex(token), input.userId, purpose, input.staffUserId, input.forgot ? RESET_LINK_HOURS : LINK_HOURS],
    );
    await recordEvent(tx, {
      kind: "link_issued", subject: str(u.email), supplierId: str(u.supplier_id), supplierUserId: input.userId,
      staffUserId: input.staffUserId, detail: input.forgot ? { purpose, via: "forgot" } : { purpose },
    });
    return { token, purpose, expiresAt: str(made[0]?.expires_at) };
  });
}

/** What to email a person who asked for a link. The token is here and nowhere else: it is not stored. */
export interface ResetToSend {
  /** The ask's own row in the record, to be settled once the email has or has not left (settleReset). */
  askId: number;
  userId: number;
  supplierId: string;
  name: string;
  email: string;
  token: string;
  purpose: "setup" | "reset";
  expiresAt: string;
}

/** The links this email asked for inside the window (Forgot password), however each ask ended. */
async function resetAsks(db: Db, email: string): Promise<number> {
  const rows = await db.query<{ asks: number }>(
    `SELECT count(*)::int AS asks
       FROM public.carres_supplier_events e
      WHERE e.kind IN ('reset_requested', 'reset_mailed', 'reset_not_mailed') AND e.subject = $1
        AND e.at > now() - make_interval(mins => $2)`,
    [email, RESET_WINDOW_MINUTES],
  );
  return int(first(rows)?.asks);
}

/** How an ask ended: its row stops saying "asked" and says the email left, or why it did not. One row an ask,
 *  as a sign-in is one row whether it failed or not. The reason is a fixed sentence, never the link. */
export async function settleReset(db: Db, askId: number, sent: boolean, reason: string | null = null): Promise<void> {
  await db.query(
    `UPDATE public.carres_supplier_events SET kind = $2, detail = $3::text::jsonb
      WHERE id = $1 AND kind = 'reset_requested'`,
    [askId, sent ? "reset_mailed" : "reset_not_mailed", JSON.stringify(sent || !reason ? {} : { reason })],
  );
}

/**
 * Forgot password: the person behind this email asks for a link. Answers what to email them, or null when there is
 * nothing to send.
 *
 * NOTHING HERE REACHES THE CALLER. The route has already answered, with the same words for every email, so neither
 * the answer nor the time it takes says whether an email signs in here. Null means any of: not an email, nobody
 * with that email, a disabled person, a supplier whose access is off, or too many asks. For the first four nothing
 * is written at all, so asking about emails that do not exist leaves no rows behind.
 *
 * THE ASK IS WRITTEN BEFORE IT IS COUNTED, as a wrong password is (takeTry above): asks sent at the same moment
 * cannot all slip under the limit, and no more than MAX_RESET_MAILS_PER_EMAIL links are made for one email in a
 * window however they arrive. An email already at the limit is refused without writing.
 *
 * A link made here replaces any link still waiting for the person (issueLink), the newest email is the one that
 * works, and using it ends every session they had (useLink).
 */
export async function requestReset(db: Db, input: { email: unknown; ip: string | null }): Promise<ResetToSend | null> {
  const email = normEmail(input.email);
  if (!isEmail(email)) return null;
  const rows = await db.query(
    `SELECT u.id, u.name, u.email, u.supplier_id::text AS supplier_id
       FROM public.carres_supplier_users u
       JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id AND a.enabled
      WHERE u.email = $1 AND u.status = 'active' AND ${FRESH}`,
    [email],
  );
  const u = first(rows);
  if (!u) return null;
  const userId = int(u.id);
  const supplierId = str(u.supplier_id);

  if ((await resetAsks(db, email)) >= MAX_RESET_MAILS_PER_EMAIL) return null;
  const asked = await db.query<{ id: number }>(
    `INSERT INTO public.carres_supplier_events (kind, supplier_id, supplier_user_id, subject, ip, detail)
     VALUES ('reset_requested', $1::uuid, $2, $3, $4, '{}'::jsonb)
     RETURNING id`,
    [supplierId, userId, email, input.ip],
  );
  const askId = int(first(asked)?.id);
  if ((await resetAsks(db, email)) > MAX_RESET_MAILS_PER_EMAIL) {
    await settleReset(db, askId, false, "Too many links were asked for. The limit starts again after an hour.");
    return null;
  }

  const link = await issueLink(db, { userId, staffUserId: null, forgot: true });
  if (!link) {
    await settleReset(db, askId, false, "The person was disabled before the link was made.");
    return null;
  }
  return { askId, userId, supplierId, name: str(u.name), email, token: link.token, purpose: link.purpose, expiresAt: link.expiresAt };
}
