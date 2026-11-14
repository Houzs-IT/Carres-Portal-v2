import { Hono, type Context } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamInternalRole } from "@carres/shared";
import { adminClient } from "../lib/supabase";
import { setAccountStatus } from "../lib/account-status";
import type { AppEnv } from "../types";

/**
 * Staff portal accounts, asked for by the engine's Team page (owner, 14 Nov 2026: "one place to add people").
 *
 * Team > Invite Member on the engine (engine/backend/src/routes/users.ts) creates the engine member AND, through
 * these routes, the person's Carres portal login: the login staff actually use (erp.carresofficial.com). The
 * engine identity is then linked by email on the person's first visit (engine/backend/src/carres/sso.ts).
 *
 * TRUST: server to server only, never a browser. The engine signs `staff-accounts.<ts>.<raw body>` with HMAC-SHA256
 * under the secret the two Workers already share for single sign-on (SCM_ENGINE_SSO_SECRET here, CARRES_SSO_SECRET
 * on the engine). The purpose prefix keeps a signature for these routes from ever passing as an SSO assertion and
 * the reverse; the timestamp bounds replay to one minute. Mounted OUTSIDE the signed-in /api group: there is no
 * Supabase JWT, the signature is the trust boundary (same shape as the Stripe webhook).
 *
 * LIMITS (the engine is never trusted to choose a powerful role):
 *   - the portal role is derived HERE from the engine department name (portalRoleForDepartment). principal is never
 *     given, and dealer, showroom, supplier, partner and warehouse logins cannot be made from Team;
 *   - an existing portal account with that email is LINKED, never duplicated, and left exactly as it was;
 *   - password and disable/enable reach only operation, finance, hr and bd accounts. The principal's and every
 *     store/supplier/partner login stay with Admin > Accounts.
 * A password is never logged, audited or returned.
 */
const router = new Hono<AppEnv>();

/** Accounts Team may create, reset and disable. The owner changes a role later in Admin. */
export const TEAM_MANAGED_ROLES = ["operation", "finance", "hr", "bd"] as const;
export type TeamManagedRole = (typeof TEAM_MANAGED_ROLES)[number];
const isTeamManaged = (role: unknown): role is TeamManagedRole =>
  (TEAM_MANAGED_ROLES as readonly string[]).includes(String(role));

export const MIN_STAFF_PASSWORD = 12;
const MAX_PASSWORD = 72; // GoTrue's bcrypt ceiling
const MAX_SKEW_MS = 60_000;
/** Where the invite link lands: the staff portal's set-password page (apps/web/src/pages/UpdatePassword.tsx). */
const DEFAULT_STAFF_WEB_URL = "https://erp.carresofficial.com";

/**
 * The portal role for an engine department. Never principal: the owner's full access is given by hand in Admin.
 *   Finance / Accounts            -> finance
 *   Business Development          -> bd
 *   HR / Human Resources          -> hr
 *   everything else (Operation, Warehouse, Management, Sales, none) -> operation
 */
export function portalRoleForDepartment(department: string | null | undefined): TeamManagedRole {
  const d = ` ${(department ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  if (/ financ| account/.test(d)) return "finance";
  if (/ business development | bd /.test(d)) return "bd";
  if (/ hr | human resource/.test(d)) return "hr";
  return "operation";
}

const enc = new TextEncoder();
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const signedText = (ts: string, body: string) => `staff-accounts.${ts}.${body}`;

/** What the engine sends (engine/backend/src/carres/portal-staff.ts signs the same way). Exported for tests. */
export async function signStaffRequest(secret: string, body: string, now = Date.now()): Promise<{ ts: string; signature: string }> {
  const ts = String(now);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ts, signature: b64url(await crypto.subtle.sign("HMAC", key, enc.encode(signedText(ts, body)))) };
}

export async function verifyStaffRequest(
  secret: string, ts: string | undefined, signature: string | undefined, body: string, now = Date.now(),
): Promise<boolean> {
  if (!ts || !signature || !/^\d{10,16}$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  try {
    return await crypto.subtle.verify("HMAC", key, fromB64url(signature), enc.encode(signedText(ts, body)));
  } catch {
    return false;
  }
}

type Verified<T> = { ok: true; body: T } | { ok: false; res: Response };

async function readSigned<T>(c: Context<AppEnv>): Promise<Verified<T>> {
  const secret = c.env.SCM_ENGINE_SSO_SECRET;
  if (!secret || secret.length < 32) {
    return { ok: false, res: c.json({ error: "not_set_up", message: "Staff accounts from Team are not set up." }, 503) };
  }
  const raw = await c.req.text();
  const ok = await verifyStaffRequest(secret, c.req.header("x-carres-engine-ts"), c.req.header("x-carres-engine-signature"), raw);
  if (!ok) return { ok: false, res: c.json({ error: "unauthorized", message: "Request could not be verified." }, 401) };
  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return { ok: false, res: c.json({ error: "invalid_input", message: "Body must be JSON." }, 422) };
  }
}

const normEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const passwordProblem = (pw: unknown): string | null =>
  typeof pw !== "string" || pw.length < MIN_STAFF_PASSWORD
    ? `Password must be at least ${MIN_STAFF_PASSWORD} characters.`
    : pw.length > MAX_PASSWORD
      ? `Password must be at most ${MAX_PASSWORD} characters.`
      : null;

const actorText = (actor: unknown) =>
  `Team (Supply Chain)${typeof actor === "string" && actor.trim() ? ` · ${actor.trim().slice(0, 200)}` : ""}`;

interface ExistingUser { id: string; email: string; name: string | null; role: string; status: string }

async function findByEmail(sb: SupabaseClient, email: string): Promise<ExistingUser | null> {
  const { data } = await sb.from("app_users").select("id, email, name, role, status").eq("email", email).maybeSingle();
  return (data as ExistingUser | null) ?? null;
}

interface CreateBody {
  email?: string;
  name?: string;
  department?: string | null;
  title?: string | null;
  delivery?: "invite" | "password";
  password?: string;
  actor?: string;
}

/**
 * POST /engine/staff-accounts { email, name, department?, title?, delivery: "invite" | "password", password?, actor? }
 * -> 201 { status: "created", userId, role, delivery, emailSent }
 * -> 200 { status: "existing", userId, role }       (linked, nothing changed)
 */
router.post("/", async (c) => {
  const v = await readSigned<CreateBody>(c);
  if (!v.ok) return v.res;
  const body = v.body;
  const email = normEmail(body.email);
  if (!isEmail(email)) return c.json({ error: "invalid_input", message: "Enter a valid email." }, 422);
  const delivery = body.delivery === "password" ? "password" : body.delivery === "invite" ? "invite" : null;
  if (!delivery) return c.json({ error: "invalid_input", message: "Choose invite or password." }, 422);
  if (delivery === "password") {
    const problem = passwordProblem(body.password);
    if (problem) return c.json({ error: "invalid_input", message: problem }, 422);
  }
  const name = (typeof body.name === "string" && body.name.trim()) || email.split("@")[0];
  const sb = adminClient(c.env);

  // Existing emails are linked, never duplicated, and never changed from here.
  const existing = await findByEmail(sb, email);
  if (existing) {
    if (!isTeamInternalRole(existing.role)) {
      return c.json({
        error: "email_in_use",
        message: "This email already signs in as a store, supplier or partner account. Use another email.",
      }, 409);
    }
    return c.json({ status: "existing", userId: existing.id, role: existing.role }, 200);
  }

  const role = portalRoleForDepartment(body.department);
  const appMetadata = { role };
  let userId: string;
  let emailSent = false;
  if (delivery === "password") {
    const created = await sb.auth.admin.createUser({
      email, password: body.password as string, email_confirm: true, app_metadata: appMetadata,
    });
    if (created.error || !created.data?.user) {
      return c.json({ error: "auth_user_create_failed", message: created.error?.message ?? "Could not create the login." }, 502);
    }
    userId = created.data.user.id;
  } else {
    // Supabase's own invite mail (the same mailer the sign-in page's reset link uses). The link signs them in on
    // the staff portal's /update-password page, where they choose their password.
    const redirectTo = `${(c.env.STAFF_WEB_URL || DEFAULT_STAFF_WEB_URL).replace(/\/+$/, "")}/update-password`;
    const invited = await sb.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name } });
    if (invited.error || !invited.data?.user) {
      return c.json({ error: "invite_failed", message: invited.error?.message ?? "Could not send the invite." }, 502);
    }
    userId = invited.data.user.id;
    emailSent = true;
    const meta = await sb.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
    if (meta.error) {
      await sb.auth.admin.deleteUser(userId);
      return c.json({ error: "auth_user_create_failed", message: meta.error.message }, 502);
    }
  }

  // Carres' own team: the CRnnn staff code and the is_person marker (0254, 0533), as the HR door gave them.
  const code = await sb.rpc("next_staff_code");
  if (code.error) {
    await sb.auth.admin.deleteUser(userId);
    return c.json({ error: "staff_code_failed", message: code.error.message }, 500);
  }
  const ins = await sb.from("app_users").insert({
    id: userId,
    email,
    name,
    role,
    title: (typeof body.title === "string" && body.title.trim()) || null,
    status: "active",
    staff_code: code.data as string,
    is_person: true,
  });
  if (ins.error) {
    await sb.auth.admin.deleteUser(userId);
    return c.json({ error: "app_users_insert_failed", message: ins.error.message }, 500);
  }

  await sb.from("audit_log").insert({
    role: "hr",
    actor_text: actorText(body.actor),
    action: `Created ${role} account · ${name} (${email}) · ${delivery === "invite" ? "invite emailed" : "password set"}`,
    ref: userId,
  });

  return c.json({ status: "created", userId, role, delivery, emailSent }, 201);
});

/** The target of a password or status change: must exist and be an account Team manages. */
async function managedTarget(c: Context<AppEnv>, sb: SupabaseClient, email: string): Promise<{ ok: true; user: ExistingUser } | { ok: false; res: Response }> {
  if (!isEmail(email)) return { ok: false, res: c.json({ error: "invalid_input", message: "Enter a valid email." }, 422) };
  const user = await findByEmail(sb, email);
  if (!user) return { ok: false, res: c.json({ error: "not_found", message: "This person has no portal account." }, 404) };
  if (!isTeamManaged(user.role)) {
    return { ok: false, res: c.json({ error: "not_team_managed", message: "This portal account is managed in Admin > Accounts." }, 403) };
  }
  return { ok: true, user };
}

/** POST /engine/staff-accounts/password { email, password, actor? } -> { ok: true } */
router.post("/password", async (c) => {
  const v = await readSigned<{ email?: string; password?: string; actor?: string }>(c);
  if (!v.ok) return v.res;
  const problem = passwordProblem(v.body.password);
  if (problem) return c.json({ error: "invalid_input", message: problem }, 422);
  const sb = adminClient(c.env);
  const t = await managedTarget(c, sb, normEmail(v.body.email));
  if (!t.ok) return t.res;
  const upd = await sb.auth.admin.updateUserById(t.user.id, { password: v.body.password as string });
  if (upd.error) return c.json({ error: "password_update_failed", message: upd.error.message }, 502);
  await sb.from("audit_log").insert({
    role: "hr",
    actor_text: actorText(v.body.actor),
    action: `Reset password · ${t.user.name ?? t.user.email} (${t.user.email})`,
    ref: t.user.id,
  });
  return c.json({ ok: true });
});

/** POST /engine/staff-accounts/status { email, status: "active" | "disabled", reason?, actor? } -> { ok, status } */
router.post("/status", async (c) => {
  const v = await readSigned<{ email?: string; status?: string; reason?: string | null; actor?: string }>(c);
  if (!v.ok) return v.res;
  const status = v.body.status;
  if (status !== "active" && status !== "disabled") {
    return c.json({ error: "invalid_input", message: "status must be active or disabled" }, 422);
  }
  const sb = adminClient(c.env);
  const t = await managedTarget(c, sb, normEmail(v.body.email));
  if (!t.ok) return t.res;
  // The one disable sequence (status flip, GoTrue ban, audit) shared with Admin > Accounts.
  const r = await setAccountStatus(sb, {
    userId: t.user.id,
    status,
    reason: typeof v.body.reason === "string" ? v.body.reason.slice(0, 500) : null,
    actorRole: "hr",
    actorText: actorText(v.body.actor),
  });
  if (!r.ok) return c.json({ error: r.code, message: r.message }, r.code === "not_found" ? 404 : 502);
  return c.json({ ok: true, status });
});

export default router;
