// Carres only (not part of Houzs's code): who a supplier person is, and how they sign in.
//
// THE RULE THIS FILE KEEPS (owner, 15 Nov 2026): a supplier's login is never a way into Carres's system.
//   * A supplier person is a row in carres_supplier_users. It is not an engine user and not a portal account, so
//     nothing that checks a staff session (middleware/auth.ts reads public.sessions) can ever accept their token,
//     and no staff token is accepted here (this file reads carres_supplier_sessions only).
//   * The token is random, lives in their browser, and is stored here only as its SHA-256.
//   * Each request re-reads the person, their status and their supplier's access: disabling any of the three ends
//     the session on the next request, with nothing to revoke.
//   * A wrong password is counted per email and per address in the database itself, so the lock holds even when a
//     cache is down. The answer is the same whether or not the email exists. `ip` is the caller's OWN address or
//     null (./credentials.ts callerAddress): an address every caller shares is never counted, so one outsider's
//     wrong tries cannot refuse everybody.
import type { Db } from "./db";
import { bool, first, int, str } from "./db";
import {
  FAIL_WINDOW_MINUTES, LINK_HOURS, MAX_FAILS_PER_EMAIL, MAX_FAILS_PER_IP, MAX_PASSWORD, SESSION_HOURS,
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

async function openSession(
  db: Db, userId: number, ip: string | null, userAgent: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const rows = await db.query<{ expires_at: string }>(
    `INSERT INTO public.carres_supplier_sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5)
     RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
    [await sha256Hex(token), userId, SESSION_HOURS, ip, userAgent ? userAgent.slice(0, 300) : null],
  );
  return { token, expiresAt: str(rows[0]?.expires_at) };
}

export async function signIn(
  db: Db, input: { email: unknown; password: unknown; ip: string | null; userAgent: string | null },
): Promise<Outcome<{ token: string; expiresAt: string; user: SupplierUser }>> {
  const email = normEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!isEmail(email) || !password || password.length > MAX_PASSWORD) return { ok: false, status: 401, error: WRONG };

  // Wrong passwords since this email last signed in (inside the window), and from this address.
  const counts = await db.query<{ by_email: number; by_ip: number }>(
    `SELECT
       (SELECT count(*)::int FROM public.carres_supplier_events f
         WHERE f.kind = 'signin_failed' AND f.subject = $1
           AND f.at > now() - make_interval(mins => $3)
           AND f.at > coalesce((SELECT max(g.at) FROM public.carres_supplier_events g
                                 WHERE g.kind = 'signin' AND g.subject = $1), '-infinity'::timestamptz)) AS by_email,
       (SELECT count(*)::int FROM public.carres_supplier_events f
         WHERE f.kind = 'signin_failed' AND f.ip = $2 AND f.at > now() - make_interval(mins => $3)) AS by_ip`,
    [email, input.ip, FAIL_WINDOW_MINUTES],
  );
  if (int(counts[0]?.by_email) >= MAX_FAILS_PER_EMAIL || (input.ip && int(counts[0]?.by_ip) >= MAX_FAILS_PER_IP)) {
    return { ok: false, status: 429, error: LOCKED };
  }

  const found = await db.query(
    `SELECT ${USER_COLUMNS}, u.password_hash, u.status, a.enabled
       FROM public.carres_supplier_users u
       JOIN public.carres_supplier_access a ON a.supplier_id = u.supplier_id
       JOIN scm.suppliers s ON s.id = u.supplier_id
      WHERE u.email = $1`,
    [email],
  );
  const row = first(found);
  // Always one full password check, against a decoy when there is nothing real to check.
  const stored = row && typeof row.password_hash === "string" && row.password_hash ? row.password_hash : await decoyHash();
  const matches = await verifyPassword(password, stored);
  const allowed = !!row && !!row.password_hash && matches && row.status === "active" && bool(row.enabled);
  if (!allowed) {
    await recordEvent(db, {
      kind: "signin_failed", subject: email, ip: input.ip,
      supplierId: row ? str(row.supplier_id) : null, supplierUserId: row ? int(row.id) : null,
    });
    return { ok: false, status: 401, error: WRONG };
  }

  const user = toUser(row);
  await db.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1 AND expires_at <= now()`, [user.id]);
  const session = await openSession(db, user.id, input.ip, input.userAgent);
  await db.query(`UPDATE public.carres_supplier_users SET last_login_at = now() WHERE id = $1`, [user.id]);
  await recordEvent(db, { kind: "signin", subject: email, ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id });
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

/** Choose a password through a link. The link works once; every session the person had ends. */
export async function useLink(
  db: Db, input: { token: string; password: unknown; ip: string | null },
): Promise<Outcome<{ email: string }>> {
  const hash = input.token && input.token.length <= 200 ? await sha256Hex(input.token) : "";
  return db.tx(async (tx): Promise<Outcome<{ email: string }>> => {
    const rows = await tx.query(
      `SELECT l.user_id, u.email, u.supplier_id::text AS supplier_id
         FROM public.carres_supplier_links l
         JOIN public.carres_supplier_users u ON u.id = l.user_id AND u.status = 'active'
        WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > now()
        FOR UPDATE OF l`,
      [hash],
    );
    const link = first(rows);
    if (!link) return { ok: false, status: 404, error: "This link is no longer valid. Ask Carres for a new one." };
    const email = str(link.email);
    const problem = passwordProblem(input.password, email);
    if (problem) return { ok: false, status: 400, error: problem };
    const userId = int(link.user_id);
    await tx.query(`UPDATE public.carres_supplier_users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [userId, await hashPassword(input.password as string)]);
    // This link is spent, and so is any other link still waiting for this person.
    await tx.query(`UPDATE public.carres_supplier_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [userId]);
    await recordEvent(tx, { kind: "password_set", subject: email, ip: input.ip, supplierId: str(link.supplier_id), supplierUserId: userId });
    return { ok: true, email };
  });
}

/** Change one's own password. Every session ends and a new one is opened for this browser. */
export async function changePassword(
  db: Db, user: SupplierUser, input: { current: unknown; next: unknown; ip: string | null; userAgent: string | null },
): Promise<Outcome<{ token: string; expiresAt: string }>> {
  const current = typeof input.current === "string" ? input.current : "";
  const rows = await db.query(`SELECT password_hash FROM public.carres_supplier_users WHERE id = $1`, [user.id]);
  const stored = typeof rows[0]?.password_hash === "string" ? (rows[0].password_hash as string) : "";
  if (!current || current.length > MAX_PASSWORD || !stored || !(await verifyPassword(current, stored))) {
    return { ok: false, status: 400, error: "Your current password is incorrect." };
  }
  const problem = passwordProblem(input.next, user.email);
  if (problem) return { ok: false, status: 400, error: problem };
  if (input.next === current) return { ok: false, status: 400, error: "Choose a password you have not used here." };
  const nextHash = await hashPassword(input.next as string);
  return db.tx(async (tx) => {
    await tx.query(`UPDATE public.carres_supplier_users SET password_hash = $2, updated_at = now() WHERE id = $1`, [user.id, nextHash]);
    await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [user.id]);
    const session = await openSession(tx, user.id, input.ip, input.userAgent);
    await recordEvent(tx, { kind: "password_changed", subject: user.email, ip: input.ip, supplierId: user.supplierId, supplierUserId: user.id });
    return { ok: true as const, ...session };
  });
}

/** A new one-time set-password link for a person (staff side). Older unused links stop working. The token is
 *  returned ONCE, to be sent to the person; only its hash is kept. */
export async function issueLink(
  db: Db, input: { userId: number; staffUserId: number | null },
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
      [await sha256Hex(token), input.userId, purpose, input.staffUserId, LINK_HOURS],
    );
    await recordEvent(tx, {
      kind: "link_issued", subject: str(u.email), supplierId: str(u.supplier_id), supplierUserId: input.userId,
      staffUserId: input.staffUserId, detail: { purpose },
    });
    return { token, purpose, expiresAt: str(made[0]?.expires_at) };
  });
}
