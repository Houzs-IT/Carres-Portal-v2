// Carres only (not part of Houzs's code): Settings › Supplier Access, the Carres side.
//
// Carres decides, per supplier: whether it may sign in at all, which Sales Orders it is shared (by product category,
// by product, or the supplier's own items), whether it is the supplier paid a share of subscription collections,
// and which of its people hold which role. Nothing here is reachable by a supplier.
import type { Db, Row } from "./db";
import { bool, first, int, jsonList, str, strOrNull } from "./db";
import { isEmail, normEmail } from "./credentials";
import { isUuid } from "./pickups";
import { issueLink, recordEvent, type Outcome } from "./session";

export interface ScopeModel { id: string; code: string; name: string; category: string }
export interface ScopeSku { code: string; name: string; category: string }

export interface AccessSummary {
  supplierId: string;
  code: string;
  name: string;
  enabled: boolean;
  ownItems: boolean;
  subscriptionShare: boolean;
  categories: string[];
  modelCount: number;
  skuCount: number;
  userCount: number;
  lastSignInAt: string | null;
}

export interface AccessDetail extends Omit<AccessSummary, "modelCount" | "skuCount" | "userCount" | "lastSignInAt"> {
  /** False until Carres saves this supplier's access for the first time. */
  saved: boolean;
  models: ScopeModel[];
  skus: ScopeSku[];
  /** Items bound to this supplier under Supplier › Items: what "own items" shares. */
  boundItemCount: number;
  users: SupplierPerson[];
}

export interface SupplierPerson {
  id: number;
  name: string;
  email: string;
  canOperation: boolean;
  canFinance: boolean;
  status: "active" | "disabled";
  hasPassword: boolean;
  lastLoginAt: string | null;
  /** A set-password link is waiting to be used until this time. */
  linkExpiresAt: string | null;
}

const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** Every supplier that has an access row, on first. */
export async function listAccess(db: Db): Promise<AccessSummary[]> {
  const rows = await db.query(
    `SELECT a.supplier_id::text AS supplier_id, s.code, s.name, a.enabled, a.own_items, a.subscription_share,
            coalesce((SELECT jsonb_agg(sc.value ORDER BY sc.value) FROM public.carres_supplier_access_scope sc
                       WHERE sc.supplier_id = a.supplier_id AND sc.kind = 'category'), '[]'::jsonb)::text AS categories,
            (SELECT count(*)::int FROM public.carres_supplier_access_scope sc WHERE sc.supplier_id = a.supplier_id AND sc.kind = 'model') AS model_count,
            (SELECT count(*)::int FROM public.carres_supplier_access_scope sc WHERE sc.supplier_id = a.supplier_id AND sc.kind = 'sku') AS sku_count,
            (SELECT count(*)::int FROM public.carres_supplier_users u WHERE u.supplier_id = a.supplier_id AND u.status = 'active') AS user_count,
            (SELECT ${ts("max(u.last_login_at)")} FROM public.carres_supplier_users u WHERE u.supplier_id = a.supplier_id) AS last_sign_in_at
       FROM public.carres_supplier_access a
       JOIN scm.suppliers s ON s.id = a.supplier_id
      ORDER BY a.enabled DESC, s.name`,
  );
  return rows.map((r) => ({
    supplierId: str(r.supplier_id), code: str(r.code), name: str(r.name), enabled: bool(r.enabled), ownItems: bool(r.own_items),
    subscriptionShare: bool(r.subscription_share), categories: JSON.parse(str(r.categories) || "[]") as string[],
    modelCount: int(r.model_count), skuCount: int(r.sku_count), userCount: int(r.user_count), lastSignInAt: strOrNull(r.last_sign_in_at),
  }));
}

export interface AccessOptions {
  suppliers: Array<{ id: string; code: string; name: string }>;
  categories: string[];
  models: ScopeModel[];
  skus: ScopeSku[];
}

/** What the pickers offer: the suppliers, the product categories in use, the product models and the SKUs. */
export async function accessOptions(db: Db): Promise<AccessOptions> {
  const [suppliers, categories, models, skus] = await Promise.all([
    db.query(`SELECT id::text AS id, code, name FROM scm.suppliers ORDER BY name`),
    db.query(`SELECT DISTINCT category::text AS category FROM scm.mfg_products WHERE category IS NOT NULL ORDER BY 1`),
    db.query(`SELECT id::text AS id, model_code, name, category::text AS category FROM scm.product_models ORDER BY name`),
    db.query(`SELECT DISTINCT ON (code) code, name, category::text AS category FROM scm.mfg_products ORDER BY code, updated_at DESC NULLS LAST`),
  ]);
  return {
    suppliers: suppliers.map((r) => ({ id: str(r.id), code: str(r.code), name: str(r.name) })),
    categories: categories.map((r) => str(r.category)),
    models: models.map((r) => ({ id: str(r.id), code: str(r.model_code), name: str(r.name), category: str(r.category) })),
    skus: skus.map((r) => ({ code: str(r.code), name: str(r.name), category: str(r.category) })),
  };
}

function toPerson(r: Row): SupplierPerson {
  return {
    id: int(r.id), name: str(r.name), email: str(r.email), canOperation: bool(r.can_operation), canFinance: bool(r.can_finance),
    status: str(r.status) === "disabled" ? "disabled" : "active", hasPassword: bool(r.has_password),
    lastLoginAt: strOrNull(r.last_login_at), linkExpiresAt: strOrNull(r.link_expires_at),
  };
}

const PERSON_COLUMNS = `
  u.id, u.name, u.email, u.can_operation, u.can_finance, u.status, (u.password_hash IS NOT NULL) AS has_password,
  ${ts("u.last_login_at")} AS last_login_at,
  (SELECT ${ts("max(l.expires_at)")} FROM public.carres_supplier_links l
    WHERE l.user_id = u.id AND l.used_at IS NULL AND l.expires_at > now()) AS link_expires_at`;

export async function listPeople(db: Db, supplierId: string): Promise<SupplierPerson[]> {
  const rows = await db.query(
    `SELECT ${PERSON_COLUMNS} FROM public.carres_supplier_users u WHERE u.supplier_id = $1::uuid ORDER BY u.status, u.name`,
    [supplierId],
  );
  return rows.map(toPerson);
}

/** One supplier's access as Settings shows it. A supplier with no access row yet reads as all-off. */
export async function getAccess(db: Db, supplierId: string): Promise<AccessDetail | null> {
  if (!isUuid(supplierId)) return null;
  const head = await db.query(
    `SELECT s.id::text AS supplier_id, s.code, s.name, (a.supplier_id IS NOT NULL) AS saved,
            coalesce(a.enabled, false) AS enabled, coalesce(a.own_items, false) AS own_items,
            coalesce(a.subscription_share, false) AS subscription_share,
            (SELECT count(DISTINCT b.item_code)::int FROM scm.supplier_material_bindings b WHERE b.supplier_id = s.id) AS bound_items
       FROM scm.suppliers s
       LEFT JOIN public.carres_supplier_access a ON a.supplier_id = s.id
      WHERE s.id = $1::uuid`,
    [supplierId],
  );
  const h = first(head);
  if (!h) return null;
  const [scope, people] = await Promise.all([
    db.query(
      `SELECT sc.kind, sc.value,
              m.model_code, m.name AS model_name, m.category::text AS model_category,
              p.name AS sku_name, p.category AS sku_category
         FROM public.carres_supplier_access_scope sc
         LEFT JOIN scm.product_models m ON sc.kind = 'model' AND m.id::text = sc.value
         LEFT JOIN LATERAL (SELECT mp.name, mp.category::text AS category FROM scm.mfg_products mp
                             WHERE sc.kind = 'sku' AND mp.code = sc.value ORDER BY mp.updated_at DESC NULLS LAST LIMIT 1) p ON true
        WHERE sc.supplier_id = $1::uuid
        ORDER BY sc.kind, sc.value`,
      [supplierId],
    ),
    listPeople(db, supplierId),
  ]);
  return {
    supplierId: str(h.supplier_id), code: str(h.code), name: str(h.name), saved: bool(h.saved), enabled: bool(h.enabled),
    ownItems: bool(h.own_items), subscriptionShare: bool(h.subscription_share), boundItemCount: int(h.bound_items),
    categories: scope.filter((r) => r.kind === "category").map((r) => str(r.value)),
    models: scope.filter((r) => r.kind === "model").map((r) => ({
      id: str(r.value), code: str(r.model_code), name: str(r.model_name) || "(model removed)", category: str(r.model_category),
    })),
    skus: scope.filter((r) => r.kind === "sku").map((r) => ({ code: str(r.value), name: str(r.sku_name), category: str(r.sku_category) })),
    users: people,
  };
}

export interface AccessInput {
  enabled: unknown;
  ownItems: unknown;
  subscriptionShare: unknown;
  categories: unknown;
  modelIds: unknown;
  skuCodes: unknown;
}

export interface CleanAccess { enabled: boolean; ownItems: boolean; subscriptionShare: boolean; categories: string[]; modelIds: string[]; skuCodes: string[] }

const stringList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string" || !x.trim() || x.length > 120) return null;
    out.add(x.trim());
  }
  return [...out];
};

/** The typed shape of a save, or why it is refused. Exported for its test. */
export function cleanAccessInput(input: AccessInput): { ok: true; value: CleanAccess } | { ok: false; error: string } {
  const categories = stringList(input.categories ?? [], 60);
  const modelIds = stringList(input.modelIds ?? [], 2000);
  const skuCodes = stringList(input.skuCodes ?? [], 5000);
  if (!categories || !modelIds || !skuCodes) return { ok: false, error: "The scope could not be read. Refresh and try again." };
  if (modelIds.some((m) => !isUuid(m))) return { ok: false, error: "A product could not be read. Refresh and try again." };
  const value: CleanAccess = {
    enabled: input.enabled === true,
    ownItems: input.ownItems === true,
    subscriptionShare: input.subscriptionShare === true,
    // Upper-cased first, then de-duplicated: "mattress" and "MATTRESS" are one category, saved once.
    categories: [...new Set(categories.map((c) => c.toUpperCase()))],
    modelIds,
    skuCodes,
  };
  if (value.enabled && !value.ownItems && !value.categories.length && !value.modelIds.length && !value.skuCodes.length) {
    return { ok: false, error: "Choose what this supplier sees before turning access on: a category, a product, or its own items." };
  }
  return { ok: true, value };
}

async function writeAccess(tx: Db, supplierId: string, v: CleanAccess, staffUserId: number | null): Promise<void> {
  await tx.query(
    `INSERT INTO public.carres_supplier_access (supplier_id, enabled, own_items, subscription_share, updated_by)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (supplier_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, own_items = EXCLUDED.own_items, subscription_share = EXCLUDED.subscription_share,
           updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [supplierId, v.enabled, v.ownItems, v.subscriptionShare, staffUserId],
  );
  await tx.query(`DELETE FROM public.carres_supplier_access_scope WHERE supplier_id = $1::uuid`, [supplierId]);
  await tx.query(
    `INSERT INTO public.carres_supplier_access_scope (supplier_id, kind, value)
     SELECT $1::uuid, x.kind, x.value FROM jsonb_to_recordset($2::text::jsonb) AS x(kind text, value text)`,
    [supplierId, JSON.stringify([
      ...v.categories.map((value) => ({ kind: "category", value })),
      ...v.modelIds.map((value) => ({ kind: "model", value })),
      ...v.skuCodes.map((value) => ({ kind: "sku", value })),
    ])],
  );
}

async function checkAccess(db: Db, supplierId: string, v: CleanAccess): Promise<string | null> {
  const supplier = await db.query(`SELECT 1 FROM scm.suppliers WHERE id = $1::uuid`, [supplierId]);
  if (!supplier[0]) return "Supplier not found.";
  const bad = await db.query(
    `SELECT
       (SELECT count(*)::int FROM jsonb_array_elements_text($1::text::jsonb) c
         WHERE NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::scm.mfg_product_category)) e WHERE e::text = c)) AS categories,
       (SELECT count(*)::int FROM jsonb_array_elements_text($2::text::jsonb) m
         WHERE NOT EXISTS (SELECT 1 FROM scm.product_models pm WHERE pm.id::text = m)) AS models,
       (SELECT count(*)::int FROM jsonb_array_elements_text($3::text::jsonb) k
         WHERE NOT EXISTS (SELECT 1 FROM scm.mfg_products mp WHERE mp.code = k)) AS skus`,
    [jsonList(v.categories), jsonList(v.modelIds), jsonList(v.skuCodes)],
  );
  if (int(bad[0]?.categories)) return "A category is not in the product list. Refresh and choose again.";
  if (int(bad[0]?.models)) return "A product is not in the product list. Refresh and choose again.";
  if (int(bad[0]?.skus)) return "An item is not in the product list. Refresh and choose again.";
  if (v.subscriptionShare) {
    const other = await db.query(
      `SELECT s.name FROM public.carres_supplier_access a JOIN scm.suppliers s ON s.id = a.supplier_id
        WHERE a.subscription_share AND a.supplier_id <> $1::uuid`,
      [supplierId],
    );
    if (other[0]) return `${str(other[0].name)} already receives the subscription share. Turn it off there first.`;
  }
  return null;
}

/** Save a supplier's access. Turning it off ends every session of its people at once. */
export async function saveAccess(db: Db, supplierId: string, input: AccessInput, staffUserId: number | null): Promise<Outcome<{ access: AccessDetail }>> {
  if (!isUuid(supplierId)) return { ok: false, status: 404, error: "Supplier not found." };
  const clean = cleanAccessInput(input);
  if (!clean.ok) return { ok: false, status: 400, error: clean.error };
  const problem = await checkAccess(db, supplierId, clean.value);
  if (problem) return { ok: false, status: problem === "Supplier not found." ? 404 : 409, error: problem };
  await db.tx(async (tx) => {
    await writeAccess(tx, supplierId, clean.value, staffUserId);
    if (!clean.value.enabled) {
      await tx.query(
        `DELETE FROM public.carres_supplier_sessions ses USING public.carres_supplier_users u
          WHERE u.id = ses.user_id AND u.supplier_id = $1::uuid`,
        [supplierId],
      );
    }
    await recordEvent(tx, {
      kind: "access_saved", supplierId, staffUserId,
      detail: {
        enabled: clean.value.enabled, ownItems: clean.value.ownItems, subscriptionShare: clean.value.subscriptionShare,
        categories: clean.value.categories, models: clean.value.modelIds.length, skus: clean.value.skuCodes.length,
      },
    });
  });
  const access = await getAccess(db, supplierId);
  return access ? { ok: true, access } : { ok: false, status: 404, error: "Supplier not found." };
}

export interface Preview { orders: number; lines: number; units: number; incomingOrders: number }

class Undo extends Error { constructor(readonly preview: Preview) { super("undo"); } }

/**
 * What the supplier WOULD see with this scope, counted by the same two functions its own pages read, so Settings
 * can show the effect before anyone saves. The scope is written inside a transaction that is always rolled back.
 */
export async function previewAccess(db: Db, supplierId: string, input: AccessInput): Promise<Outcome<{ preview: Preview }>> {
  if (!isUuid(supplierId)) return { ok: false, status: 404, error: "Supplier not found." };
  const clean = cleanAccessInput({ ...input, enabled: false });
  if (!clean.ok) return { ok: false, status: 400, error: clean.error };
  const supplier = await db.query(`SELECT 1 FROM scm.suppliers WHERE id = $1::uuid`, [supplierId]);
  if (!supplier[0]) return { ok: false, status: 404, error: "Supplier not found." };
  try {
    await db.tx(async (tx) => {
      // Counted as if on, and never as the subscription supplier (that flag has its own one-supplier index).
      await writeAccess(tx, supplierId, { ...clean.value, enabled: true, subscriptionShare: false }, null);
      const rows = await tx.query(
        `SELECT count(*)::int AS orders, coalesce(sum(o.line_count), 0)::int AS lines, coalesce(sum(o.unit_count), 0)::int AS units,
                count(*) FILTER (WHERE o.status = 'CONFIRMED')::int AS incoming
           FROM public.carres_supplier_scope_orders($1::uuid) o`,
        [supplierId],
      );
      const r = rows[0] ?? {};
      throw new Undo({ orders: int(r.orders), lines: int(r.lines), units: int(r.units), incomingOrders: int(r.incoming) });
    });
  } catch (e) {
    if (e instanceof Undo) return { ok: true, preview: e.preview };
    throw e;
  }
  return { ok: false, status: 409, error: "The preview could not be counted." };
}

export interface PersonInput { name: unknown; email: unknown; canOperation: unknown; canFinance: unknown }

/** Add a person to a supplier and make their first set-password link. The link is returned once. */
export async function addPerson(
  db: Db, supplierId: string, input: PersonInput, staffUserId: number | null,
): Promise<Outcome<{ person: SupplierPerson; link: { token: string; expiresAt: string } }>> {
  if (!isUuid(supplierId)) return { ok: false, status: 404, error: "Supplier not found." };
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const email = normEmail(input.email);
  const canOperation = input.canOperation === true;
  const canFinance = input.canFinance === true;
  if (!name) return { ok: false, status: 400, error: "Enter the person's name." };
  if (!isEmail(email)) return { ok: false, status: 400, error: "Enter a valid email address." };
  if (!canOperation && !canFinance) return { ok: false, status: 400, error: "Choose at least one role." };

  const supplier = await db.query(`SELECT 1 FROM scm.suppliers WHERE id = $1::uuid`, [supplierId]);
  if (!supplier[0]) return { ok: false, status: 404, error: "Supplier not found." };
  const taken = await db.query(
    `SELECT s.name FROM public.carres_supplier_users u JOIN scm.suppliers s ON s.id = u.supplier_id WHERE u.email = $1`, [email]);
  if (taken[0]) return { ok: false, status: 409, error: `This email already signs in for ${str(taken[0].name)}.` };
  // A supplier person must never share an email with Carres staff: one inbox, two kinds of access, is a mix-up
  // waiting to happen, and staff are added in Team.
  const staff = await db.query(`SELECT 1 FROM public.users WHERE lower(email) = $1`, [email]);
  if (staff[0]) return { ok: false, status: 409, error: "This email belongs to a Carres staff account. Use the supplier's own email." };

  const id = await db.tx(async (tx) => {
    // A supplier with no access row yet gets one, switched off: adding a person shares nothing by itself.
    await tx.query(
      `INSERT INTO public.carres_supplier_access (supplier_id, updated_by) VALUES ($1::uuid, $2) ON CONFLICT (supplier_id) DO NOTHING`,
      [supplierId, staffUserId],
    );
    const made = await tx.query<{ id: number }>(
      `INSERT INTO public.carres_supplier_users (supplier_id, email, name, can_operation, can_finance, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id`,
      [supplierId, email, name, canOperation, canFinance, staffUserId],
    );
    const newId = int(made[0]?.id);
    await recordEvent(tx, { kind: "person_added", supplierId, supplierUserId: newId, staffUserId, subject: email, detail: { canOperation, canFinance } });
    return newId;
  });
  const link = await issueLink(db, { userId: id, staffUserId });
  const person = (await listPeople(db, supplierId)).find((p) => p.id === id);
  if (!link || !person) return { ok: false, status: 404, error: "The person could not be read back." };
  return { ok: true, person, link: { token: link.token, expiresAt: link.expiresAt } };
}

export interface PersonPatch { name?: unknown; canOperation?: unknown; canFinance?: unknown; status?: unknown }

/** Change a person's name, roles or status. Disabling ends their sessions and their waiting links at once. */
export async function updatePerson(db: Db, userId: number, patch: PersonPatch, staffUserId: number | null): Promise<Outcome<{ person: SupplierPerson }>> {
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, status: 404, error: "Person not found." };
  const rows = await db.query(
    `SELECT id, supplier_id::text AS supplier_id, name, email, can_operation, can_finance, status FROM public.carres_supplier_users WHERE id = $1`,
    [userId],
  );
  const cur = first(rows);
  if (!cur) return { ok: false, status: 404, error: "Person not found." };
  const name = patch.name === undefined ? str(cur.name) : typeof patch.name === "string" ? patch.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const canOperation = patch.canOperation === undefined ? bool(cur.can_operation) : patch.canOperation === true;
  const canFinance = patch.canFinance === undefined ? bool(cur.can_finance) : patch.canFinance === true;
  const status = patch.status === undefined ? str(cur.status) : patch.status === "disabled" ? "disabled" : patch.status === "active" ? "active" : "";
  if (!name) return { ok: false, status: 400, error: "Enter the person's name." };
  if (!canOperation && !canFinance) return { ok: false, status: 400, error: "Choose at least one role." };
  if (!status) return { ok: false, status: 400, error: "The status could not be read." };
  const supplierId = str(cur.supplier_id);
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE public.carres_supplier_users SET name = $2, can_operation = $3, can_finance = $4, status = $5, updated_at = now() WHERE id = $1`,
      [userId, name, canOperation, canFinance, status],
    );
    if (status === "disabled") {
      await tx.query(`DELETE FROM public.carres_supplier_sessions WHERE user_id = $1`, [userId]);
      await tx.query(`UPDATE public.carres_supplier_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    }
    await recordEvent(tx, { kind: "person_changed", supplierId, supplierUserId: userId, staffUserId, subject: str(cur.email), detail: { canOperation, canFinance, status } });
  });
  const person = (await listPeople(db, supplierId)).find((p) => p.id === userId);
  return person ? { ok: true, person } : { ok: false, status: 404, error: "Person not found." };
}

export interface ActivityRow { at: string; kind: string; who: string | null; subject: string | null; ip: string | null }

/** The latest sign-ins and changes for a supplier, for Carres to read. `who` is the person who DID it: the Carres
 *  staff member when one acted (a link made, a person added or changed), otherwise the supplier's own person. */
export async function recentActivity(db: Db, supplierId: string, limit = 50): Promise<ActivityRow[]> {
  if (!isUuid(supplierId)) return [];
  const rows = await db.query(
    `SELECT ${ts("e.at")} AS at, e.kind, e.subject, e.ip,
            coalesce(st.name, u.name) AS who
       FROM public.carres_supplier_events e
       LEFT JOIN public.carres_supplier_users u ON u.id = e.supplier_user_id
       LEFT JOIN public.users st ON st.id = e.staff_user_id
      WHERE e.supplier_id = $1::uuid
      ORDER BY e.at DESC, e.id DESC
      LIMIT $2`,
    [supplierId, Math.min(200, Math.max(1, limit))],
  );
  return rows.map((r) => ({ at: str(r.at), kind: str(r.kind), who: strOrNull(r.who), subject: strOrNull(r.subject), ip: strOrNull(r.ip) }));
}
