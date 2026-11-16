// Carres only (not part of Houzs's code): a supplier's admin manages their own company's people
// (Settings › Users and access on the supplier pages; owner, 16 Nov 2026).
//
// Carres turns a supplier on, decides what it is shared and adds its first person (./access.ts, Settings › Supplier
// Access). From there the supplier's admin, a person who holds "Manage users" in a department, adds the company's
// other people to THAT department, sets what each may see and press (./perms.ts), and takes access away.
//
// What this keeps:
//   * The supplier is always the one in the admin's session, never one named in the request, so an admin reads and
//     changes only their own company's people, and only in a department where they hold Manage users.
//   * An email belongs to one person in the whole platform, and to no Carres staff member. A refused email says
//     only that it already has an account, never at which company.
//   * An admin cannot take Manage users away from themselves, or remove themselves: a company is never left with no
//     one to manage it by its own hand.
//   * Taking access away disables the person and ends their sessions and waiting links at once; a person in both
//     departments loses only this one. The row stays, so the history still names them.
//   * Adding an email the company already has does not hit a wall the admin cannot see past. A person the company
//     itself removed comes back as if added fresh (the name, password and access given now; the other department
//     not restored). A colleague in the other department gets this department too and signs in as before. A person
//     Carres turned off stays off: only Carres turns them on again (Settings › Supplier Access).
import type { Db, Row } from "./db";
import { bool, first, int, str, strOrNull } from "./db";
import { hashPassword, isEmail, normEmail, passwordProblem } from "./credentials";
import { cleanPerms, readPerms, type Department } from "./perms";
import { issueLink, recordEvent, type Outcome, type SupplierUser } from "./session";

export interface OwnPerson {
  id: number;
  name: string;
  email: string;
  /** "invited": the person has not chosen a password yet. */
  status: "active" | "invited";
  self: boolean;
  /** The keys the person holds in this department. */
  perms: string[];
  lastLoginAt: string | null;
}

const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const PERSON_COLUMNS = `
  u.id, u.name, u.email, (u.password_hash IS NOT NULL) AS has_password, u.can_operation, u.can_finance,
  u.perms::text AS perms, ${ts("u.last_login_at")} AS last_login_at`;

const TAKEN = "This email already has an account.";
const OFF_BY_CARRES = "Carres turned off this person's access. Ask Carres to turn it on again.";

function toOwn(r: Row, department: Department, meId: number): OwnPerson {
  const perms = readPerms(r.perms, { canOperation: bool(r.can_operation), canFinance: bool(r.can_finance) });
  return {
    id: int(r.id),
    name: str(r.name),
    email: str(r.email),
    status: bool(r.has_password) ? "active" : "invited",
    self: int(r.id) === meId,
    perms: perms[department],
    lastLoginAt: strOrNull(r.last_login_at),
  };
}

/** The admin's own company's people in a department: the ones who may still sign in. */
export async function listOwnPeople(db: Db, me: SupplierUser, department: Department): Promise<OwnPerson[]> {
  const rows = await db.query(
    `SELECT ${PERSON_COLUMNS}
       FROM public.carres_supplier_users u
      WHERE u.supplier_id = $1::uuid AND u.status = 'active'
        AND (($2 = 'operation' AND u.can_operation) OR ($2 = 'finance' AND u.can_finance))
      ORDER BY lower(u.name), u.id`,
    [me.supplierId, department],
  );
  return rows.map((r) => toOwn(r, department, me.id));
}

async function readOwn(db: Db, me: SupplierUser, department: Department, id: number): Promise<Row | null> {
  const rows = await db.query(
    `SELECT ${PERSON_COLUMNS}
       FROM public.carres_supplier_users u
      WHERE u.id = $3 AND u.supplier_id = $1::uuid AND u.status = 'active'
        AND (($2 = 'operation' AND u.can_operation) OR ($2 = 'finance' AND u.can_finance))`,
    [me.supplierId, department, id],
  );
  return first(rows) ?? null;
}

const cleanName = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 120) : "");

export interface AddInput { name: unknown; email: unknown; how: unknown; password?: unknown; mustChange?: unknown; perms: unknown }

/**
 * Add a person to the admin's company, in the admin's department only. "invite": they get a link to choose their
 * password (the answer carries it once, for the email; only its hash is kept). "password": the admin gives them one,
 * and by default they choose their own at their first sign-in.
 *
 * `hadAccount`: the email was already a colleague in the company's other department. They now hold this department
 * too and keep signing in as before: no password is set and no link is made.
 */
export async function addOwnPerson(
  db: Db, me: SupplierUser, department: Department, input: AddInput,
): Promise<Outcome<{ person: OwnPerson; linkToken: string | null; hadAccount: boolean }>> {
  const name = cleanName(input.name);
  const email = normEmail(input.email);
  const how = input.how === "invite" || input.how === "password" ? input.how : null;
  if (!name) return { ok: false, status: 400, error: "Enter the person's name." };
  if (!isEmail(email)) return { ok: false, status: 400, error: "Enter a valid email address." };
  if (!how) return { ok: false, status: 400, error: "Choose how they sign in." };
  const keys = cleanPerms(department, input.perms);
  let passwordHash: string | null = null;
  if (how === "password") {
    const problem = passwordProblem(input.password, email);
    if (problem) return { ok: false, status: 400, error: problem };
    passwordHash = await hashPassword(input.password as string);
  }
  const mustChange = how === "password" && input.mustChange !== false;

  const staff = await db.query(`SELECT 1 FROM public.users WHERE lower(email) = $1 LIMIT 1`, [email]);
  if (staff[0]) return { ok: false, status: 409, error: TAKEN };
  // The email's one account, if it has one. `removed_here`: the last act that took its access was this company's own
  // admin (Remove access), not Carres (Disable, or any later change Carres made to the person).
  const known = first(await db.query(
    `SELECT u.id, u.supplier_id::text AS supplier_id, u.status,
            (u.can_operation AND $2 = 'operation') OR (u.can_finance AND $2 = 'finance') AS in_department,
            (SELECT e.staff_user_id IS NULL AND e.detail->>'via' = 'supplier'
               FROM public.carres_supplier_events e
              WHERE e.subject = u.email AND e.kind = 'person_changed'
                AND (e.detail->>'removed' IS NOT NULL OR e.detail->>'status' IS NOT NULL)
              ORDER BY e.at DESC, e.id DESC
              LIMIT 1) AS removed_here
       FROM public.carres_supplier_users u
      WHERE u.email = $1`,
    [email, department],
  ));
  if (known) {
    // Another company's person, or one already in this list: the answer never names the other company.
    if (str(known.supplier_id) !== me.supplierId || (str(known.status) === "active" && bool(known.in_department))) {
      return { ok: false, status: 409, error: TAKEN };
    }
    if (str(known.status) === "active") return joinDepartment(db, me, department, int(known.id), email, keys);
    if (!bool(known.removed_here)) return { ok: false, status: 409, error: OFF_BY_CARRES };
  }

  const perms = JSON.stringify({ operation: department === "operation" ? keys : [], finance: department === "finance" ? keys : [] });
  let id = 0;
  if (known) {
    // Removed by this company: back as if added fresh. Their old password and the other department stay gone.
    id = await db.tx(async (tx) => {
      const back = await tx.query<{ id: number }>(
        `UPDATE public.carres_supplier_users
            SET status = 'active', name = $2, can_operation = ($3 = 'operation'), can_finance = ($3 = 'finance'),
                perms = $4::text::jsonb, password_hash = $5, must_change_password = $6, updated_at = now()
          WHERE id = $1 AND status = 'disabled'
          RETURNING id`,
        [int(known.id), name, department, perms, passwordHash, mustChange],
      );
      const backId = int(first(back)?.id);
      if (backId) {
        await recordEvent(tx, {
          kind: "person_added", supplierId: me.supplierId, supplierUserId: me.id, subject: email,
          detail: { via: "supplier", department, how, permissions: keys.length, again: true },
        });
      }
      return backId;
    });
    // Another admin brought them back a moment ago: they are in the list now.
    if (!id) return { ok: false, status: 409, error: TAKEN };
  } else {
    try {
      id = await db.tx(async (tx) => {
        const made = await tx.query<{ id: number }>(
          `INSERT INTO public.carres_supplier_users
             (supplier_id, email, name, can_operation, can_finance, perms, password_hash, must_change_password)
           VALUES ($1::uuid, $2, $3, $4, $5, $6::text::jsonb, $7, $8)
           RETURNING id`,
          [me.supplierId, email, name, department === "operation", department === "finance", perms, passwordHash, mustChange],
        );
        const newId = int(first(made)?.id);
        await recordEvent(tx, {
          kind: "person_added", supplierId: me.supplierId, supplierUserId: me.id, subject: email,
          detail: { via: "supplier", department, how, permissions: keys.length },
        });
        return newId;
      });
    } catch (e) {
      // The same email added by two admins at the same moment: the unique index refuses the second.
      if (String((e as { message?: string } | null)?.message ?? "").includes("carres_supplier_users_email_key")) {
        return { ok: false, status: 409, error: TAKEN };
      }
      throw e;
    }
  }

  let linkToken: string | null = null;
  if (how === "invite") {
    const link = await issueLink(db, { userId: id, staffUserId: null });
    linkToken = link?.token ?? null;
  }
  const row = await readOwn(db, me, department, id);
  if (!row) return { ok: false, status: 404, error: "The person could not be read back." };
  return { ok: true, person: toOwn(row, department, me.id), linkToken, hadAccount: false };
}

/**
 * A colleague already in the company's other department gets this one too, holding what the admin ticked. Their
 * name, password and links stay as they are; their next request reads the change (./session.ts resolveSession).
 */
async function joinDepartment(
  db: Db, me: SupplierUser, department: Department, id: number, email: string, keys: string[],
): Promise<Outcome<{ person: OwnPerson; linkToken: string | null; hadAccount: boolean }>> {
  const joined = await db.tx(async (tx) => {
    const done = await tx.query<{ id: number }>(
      `UPDATE public.carres_supplier_users
          SET can_operation = can_operation OR $2 = 'operation', can_finance = can_finance OR $2 = 'finance',
              perms = jsonb_set(perms, ARRAY[$2::text], $3::text::jsonb, true), updated_at = now()
        WHERE id = $1 AND supplier_id = $4::uuid AND status = 'active'
          AND NOT ((can_operation AND $2 = 'operation') OR (can_finance AND $2 = 'finance'))
        RETURNING id`,
      [id, department, JSON.stringify(keys), me.supplierId],
    );
    if (!first(done)) return false;
    await recordEvent(tx, {
      kind: "person_changed", supplierId: me.supplierId, supplierUserId: me.id, subject: email,
      detail: { via: "supplier", department, added: true, permissions: keys.length },
    });
    return true;
  });
  // Removed, or given this department, a moment ago by someone else.
  if (!joined) return { ok: false, status: 409, error: TAKEN };
  const row = await readOwn(db, me, department, id);
  if (!row) return { ok: false, status: 404, error: "The person could not be read back." };
  return { ok: true, person: toOwn(row, department, me.id), linkToken: null, hadAccount: true };
}

export interface PatchInput { name?: unknown; perms?: unknown }

/** Change a person's name or what they hold in the admin's department. Their next request reads the change. */
export async function updateOwnPerson(
  db: Db, me: SupplierUser, department: Department, id: number, patch: PatchInput,
): Promise<Outcome<{ person: OwnPerson }>> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 404, error: "Person not found." };
  const cur = await readOwn(db, me, department, id);
  if (!cur) return { ok: false, status: 404, error: "Person not found." };
  const name = patch.name === undefined ? str(cur.name) : cleanName(patch.name);
  if (!name) return { ok: false, status: 400, error: "Enter the person's name." };
  const keys = patch.perms === undefined
    ? readPerms(cur.perms, { canOperation: bool(cur.can_operation), canFinance: bool(cur.can_finance) })[department]
    : cleanPerms(department, patch.perms);
  if (id === me.id && !keys.includes("a_users")) return { ok: false, status: 400, error: "You cannot take away your own Manage users." };
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE public.carres_supplier_users
          SET name = $2, perms = jsonb_set(perms, ARRAY[$3::text], $4::text::jsonb, true), updated_at = now()
        WHERE id = $1`,
      [id, name, department, JSON.stringify(keys)],
    );
    await recordEvent(tx, {
      kind: "person_changed", supplierId: me.supplierId, supplierUserId: me.id, subject: str(cur.email),
      detail: { via: "supplier", department, permissions: keys.length },
    });
  });
  const row = await readOwn(db, me, department, id);
  return row ? { ok: true, person: toOwn(row, department, me.id) } : { ok: false, status: 404, error: "Person not found." };
}

/**
 * Take a person's access away. In both departments: only this department goes. Otherwise the person is disabled,
 * and their sessions and waiting links end at once.
 */
export async function removeOwnPerson(db: Db, me: SupplierUser, department: Department, id: number): Promise<Outcome<{ removed: true }>> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 404, error: "Person not found." };
  if (id === me.id) return { ok: false, status: 400, error: "You cannot remove yourself." };
  const cur = await readOwn(db, me, department, id);
  if (!cur) return { ok: false, status: 404, error: "Person not found." };
  const both = bool(cur.can_operation) && bool(cur.can_finance);
  await db.tx(async (tx) => {
    if (both && department === "operation") {
      await tx.query(
        `UPDATE public.carres_supplier_users
            SET can_operation = false, perms = jsonb_set(perms, '{operation}', '[]'::jsonb, true), updated_at = now()
          WHERE id = $1`,
        [id],
      );
    } else if (both) {
      await tx.query(
        `UPDATE public.carres_supplier_users
            SET can_finance = false, perms = jsonb_set(perms, '{finance}', '[]'::jsonb, true), updated_at = now()
          WHERE id = $1`,
        [id],
      );
    } else {
      await tx.query(`UPDATE public.carres_supplier_users SET status = 'disabled', updated_at = now() WHERE id = $1`, [id]);
      await tx.query(`UPDATE public.carres_supplier_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [id]);
      await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [id]);
    }
    // A person who keeps their other department stays signed in: every request re-reads what they hold
    // (./session.ts resolveSession), so this department's pages and buttons are closed to them from the next one.
    await recordEvent(tx, {
      kind: "person_changed", supplierId: me.supplierId, supplierUserId: me.id, subject: str(cur.email),
      detail: { via: "supplier", department, removed: true },
    });
  });
  return { ok: true, removed: true };
}
