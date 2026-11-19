// Carres only (not part of Houzs's code): a 3PL company's login, opened from the 3PL company's own form (owner, 19 Nov
// 2026: "after I create the 3PL, generate something, fill in his email, and open his account here").
//
// A 3PL company signs in to the Supplier Platform through the supplier it bills Carres through
// (scm.threepl_companies.supplier_id). Inviting a person here does, in one step, what Settings › Supplier Access does in
// three: it turns that supplier's access on (a 3PL needs no Sales Order scope, ./access.ts cleanAccessInput), adds the
// person under Warehouse and Operation, and makes their set-password link. The staff route emails the link.
// Nothing here reads a 3PL's prices, rates or bills.
import { addPerson, listPeople, type SupplierPerson } from "./access";
import { bool, first, str, type Db } from "./db";
import { isUuid } from "./pickups";
import { recordEvent } from "./session";

export interface ThreeplLogin {
  threepl: { id: string; name: string; code: string | null };
  /** The supplier it bills through, or null: without one it cannot have a login yet. */
  supplier: { id: string; code: string; name: string } | null;
  enabled: boolean;
  people: SupplierPerson[];
}

type Fail = { ok: false; status: 400 | 404 | 409; error: string };

async function head(db: Db, threeplId: string): Promise<ThreeplLogin | null> {
  if (!isUuid(threeplId)) return null;
  const r = first(await db.query(
    `SELECT t.id::text AS id, t.name, t.code, s.id::text AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
            coalesce(a.enabled, false) AS enabled
       FROM scm.threepl_companies t
       LEFT JOIN scm.suppliers s ON s.id = t.supplier_id
       LEFT JOIN public.carres_supplier_access a ON a.supplier_id = t.supplier_id
      WHERE t.id = $1::uuid`,
    [threeplId],
  ));
  if (!r) return null;
  const supplierId = str(r.supplier_id);
  return {
    threepl: { id: str(r.id), name: str(r.name), code: r.code == null ? null : str(r.code) },
    supplier: supplierId ? { id: supplierId, code: str(r.supplier_code), name: str(r.supplier_name) } : null,
    enabled: bool(r.enabled),
    people: supplierId ? await listPeople(db, supplierId) : [],
  };
}

export function threeplLogin(db: Db) {
  return {
    async read(threeplId: string): Promise<{ ok: true; login: ThreeplLogin } | Fail> {
      const login = await head(db, threeplId);
      return login ? { ok: true, login } : { ok: false, status: 404, error: "3PL company not found." };
    },

    async invite(
      threeplId: string, input: { name: unknown; email: unknown }, staffUserId: number | null,
    ): Promise<{ ok: true; person: SupplierPerson; link: { token: string; expiresAt: string } } | Fail> {
      const login = await head(db, threeplId);
      if (!login) return { ok: false, status: 404, error: "3PL company not found." };
      if (!login.supplier) return { ok: false, status: 409, error: "Link this 3PL company to its supplier first (the Supplier field above), then invite people." };
      const supplierId = login.supplier.id;

      const added = await addPerson(db, supplierId, { name: input.name, email: input.email, canOperation: true, canFinance: false }, staffUserId);
      if (!added.ok) return added as Fail;

      // The person's own login needs the supplier switched on. A 3PL shares no Sales Orders, so nothing else changes.
      if (!login.enabled) {
        await db.query(
          `INSERT INTO public.carres_supplier_access (supplier_id, enabled, updated_by) VALUES ($1::uuid, true, $2)
           ON CONFLICT (supplier_id) DO UPDATE SET enabled = true, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [supplierId, staffUserId],
        );
        await recordEvent(db, { kind: "access_saved", supplierId, staffUserId, detail: { enabled: true, threepl: login.threepl.name } });
      }
      return { ok: true, person: added.person, link: added.link };
    },
  };
}
