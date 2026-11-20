// Carres only (not part of Houzs's code): a 3PL company's own delivery jobs on the Supplier Platform (owner, 19 Nov
// 2026: "the 3PL only sees its own orders, sets the delivery date and follows Last Mile").
//
// A 3PL company (scm.threepl_companies) names the supplier it bills Carres through (supplier_id, migration 1099). A
// person of THAT supplier who holds `v_deliveries` sees the jobs given to the 3PL's own lorries, drivers or helpers:
//   · a Delivery Order whose crew (scm.delivery_order_crew) is one of them, and
//   · a Sales Order not yet on a Delivery Order whose planned crew (scm.carres_so_crew_plan) is one of them.
// Nothing else: never a price, cost, margin, payment detail, salesperson, supplier or another 3PL's job; the one money
// figure is the balance the customer still owes (owner, 20 Nov 2026), for collecting on delivery. Every column read
// below is named; this file never reads a money column.
//
// Setting the delivery date writes the Sales Order's planned date (amended_delivery_date) through the engine's own
// header writer, `advanceSoGeneration`, and its history, `recordSoAudit`: the same door the Delivery Planning board
// uses, so there is one way to move a delivery date and it keeps the customer's original date untouched.
import type { Env } from "../../types";
import { getSupabaseService } from "../../db/supabase";
import { advanceSoGeneration } from "../../scm/lib/so-generation";
import { recordSoAudit } from "../../scm/lib/so-audit";
import { buildVariantSummary } from "../../scm/shared/variant-summary";
import { bool, str, strOrNull, type Db } from "./db";
import { recordEvent } from "./session";

/** Delivery Order states that mean the goods reached the customer (scm/shared/do-shipped-states.ts DO_ARRIVED_STATES). */
const ARRIVED = ["SIGNED", "DELIVERED", "INVOICED"] as const;

export interface DeliveryItem {
  code: string; description: string; description2: string | null; qty: number; uom: string | null;
  /** The item group (Mattress, Bedframe, Sofa, …), so the goods read by category. */
  category: string | null;
  /** Its variant in the documents' own words (fabric, sizes, legs, specials: scm/shared/variant-summary.ts). */
  variant: string | null;
  /** The line's stock status as the Sales Order list shows it: READY, PARTIAL or PENDING. */
  stock: "READY" | "PARTIAL" | "PENDING";
  /** When goods not yet in stock are due: the earliest delivery date of the Purchase Orders bought for this line
   *  (cancelled ones left out), the same as the Sales Order list's PO date. */
  poEta: string | null;
  poNos: string | null;
}

export interface DeliveryJob {
  /** "do" once a Delivery Order exists, "so" while the order is only planned on the board. */
  kind: "do" | "so";
  key: string;
  soDocNo: string | null;
  doNo: string | null;
  customer: string;
  address: string;
  phone: string | null;
  /** The customer's original date: never changed here. */
  customerDate: string | null;
  /** The planned delivery date the 3PL may set. */
  plannedDate: string | null;
  /** The Sales Order's Sales Exemption Expiry date (owner, 20 Nov 2026: shown to the 3PL). */
  exemptionDate: string | null;
  /** What the customer still owes on the Sales Order, in sen (owner, 20 Nov 2026: "balance must be seen"). The same
   *  live figure as the Sales Order list's Balance; no price, cost or payment detail beside it. */
  balanceSen: number | null;
  status: string;
  lorry: string | null;
  driver: string | null;
  helpers: string[];
  departedAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  proof: boolean;
  done: boolean;
  items: DeliveryItem[];
}

/** The 3PL company that bills Carres through this supplier, by name, or null: its people's pages carry the 3PL's own
 *  name, not the supplier's (owner, 19 Nov 2026: "what they see should not be the supplier's"). */
export async function logisticsName(db: Db, supplierId: string): Promise<string | null> {
  const rows = await db.query(
    `SELECT name FROM scm.threepl_companies WHERE supplier_id = $1::uuid AND is_active ORDER BY created_at LIMIT 1`, [supplierId]);
  return rows[0] ? str(rows[0].name) : null;
}

/** Whether this supplier is a 3PL company's billing supplier: only then does it have a Deliveries page. */
export async function isLogistics(db: Db, supplierId: string): Promise<boolean> {
  const rows = await db.query(
    `SELECT 1 FROM scm.threepl_companies WHERE supplier_id = $1::uuid AND is_active LIMIT 1`, [supplierId]);
  return rows.length > 0;
}

// The 3PL's own lorries, drivers and helpers. A constant, used at the top of each statement below.
const FLEET = `
  WITH tpl AS (SELECT id FROM scm.threepl_companies WHERE supplier_id = $1::uuid AND is_active),
       ly  AS (SELECT id FROM scm.lorries WHERE threepl_company_id IN (SELECT id FROM tpl)),
       dr  AS (SELECT id FROM scm.drivers WHERE threepl_company_id IN (SELECT id FROM tpl)),
       hp  AS (SELECT id FROM scm.helpers WHERE threepl_company_id IN (SELECT id FROM tpl))`;

// A job is on the fleet when its lorry, either driver or either helper is the 3PL's. Two constants, one per table.
const ON_FLEET_CREW = `(c.lorry_id IN (SELECT id FROM ly)
    OR c.driver_1_id IN (SELECT id FROM dr) OR c.driver_2_id IN (SELECT id FROM dr)
    OR c.helper_1_id IN (SELECT id FROM hp) OR c.helper_2_id IN (SELECT id FROM hp))`;
const ON_FLEET_PLAN = `(p.lorry_id IN (SELECT id FROM ly)
    OR p.driver_1_id IN (SELECT id FROM dr) OR p.driver_2_id IN (SELECT id FROM dr)
    OR p.helper_1_id IN (SELECT id FROM hp) OR p.helper_2_id IN (SELECT id FROM hp))`;

const DO_JOBS = `${FLEET}
  SELECT 'do' AS kind, d.id::text AS key, d.so_doc_no, d.do_number, d.debtor_name,
         d.address1, d.address2, d.city, d.state, d.postcode, d.phone,
         d.customer_delivery_date::text AS customer_date, s.amended_delivery_date::text AS planned_date,
         COALESCE(s.sales_exemption_expiry, s.customer_delivery_date)::text AS exemption_date, COALESCE(pt.balance_sen_live, s.balance_sen) AS balance_sen, d.status,
         c.lorry_plate AS lorry, c.driver_1_name AS driver, c.helper_1_name AS helper_1, c.helper_2_name AS helper_2,
         to_char(d.departure_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI') AS departed_at,
         to_char(d.arrival_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI') AS arrived_at,
         to_char(COALESCE(d.delivered_at, d.signed_at) AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI') AS delivered_at,
         (d.pod_r2_key IS NOT NULL OR d.signature_data IS NOT NULL OR jsonb_array_length(COALESCE(d.pod_photo_keys, '[]'::jsonb)) > 0) AS proof
    FROM scm.delivery_orders d
    JOIN scm.delivery_order_crew c ON c.do_id = d.id
    LEFT JOIN scm.mfg_sales_orders s ON s.doc_no = d.so_doc_no
    LEFT JOIN scm.mfg_sales_orders_with_payment_totals pt ON pt.doc_no = s.doc_no
   WHERE ${ON_FLEET_CREW} AND d.status <> 'CANCELLED'`;

const SO_JOBS = `${FLEET}
  SELECT 'so' AS kind, s.doc_no AS key, s.doc_no AS so_doc_no, NULL::text AS do_number, s.debtor_name,
         COALESCE(NULLIF(s.delivery_address1, ''), s.address1) AS address1,
         COALESCE(NULLIF(s.delivery_address2, ''), s.address2) AS address2,
         s.city, s.customer_state AS state, s.postcode, s.phone,
         s.customer_delivery_date::text AS customer_date, s.amended_delivery_date::text AS planned_date,
         COALESCE(s.sales_exemption_expiry, s.customer_delivery_date)::text AS exemption_date, COALESCE(pt.balance_sen_live, s.balance_sen) AS balance_sen, s.status,
         l.plate AS lorry, dv.name AS driver, h1.name AS helper_1, h2.name AS helper_2,
         NULL::text AS departed_at, NULL::text AS arrived_at, NULL::text AS delivered_at, false AS proof
    FROM scm.carres_so_crew_plan p
    JOIN scm.mfg_sales_orders s ON s.doc_no = p.so_doc_no
    LEFT JOIN scm.mfg_sales_orders_with_payment_totals pt ON pt.doc_no = s.doc_no
    LEFT JOIN scm.lorries l ON l.id = p.lorry_id
    LEFT JOIN scm.drivers dv ON dv.id = p.driver_1_id
    LEFT JOIN scm.helpers h1 ON h1.id = p.helper_1_id
    LEFT JOIN scm.helpers h2 ON h2.id = p.helper_2_id
   WHERE ${ON_FLEET_PLAN} AND upper(s.status::text) NOT IN ('CANCELLED', 'DRAFT')
     AND NOT EXISTS (SELECT 1 FROM scm.delivery_orders d WHERE d.so_doc_no = s.doc_no AND d.status <> 'CANCELLED')`;

const stockOf = (v: unknown): DeliveryItem["stock"] => {
  const t = str(v).toUpperCase();
  return t === "READY" ? "READY" : t === "PARTIAL" ? "PARTIAL" : "PENDING";
};

const joinAddress = (r: Record<string, unknown>): string =>
  [r.address1, r.address2, [r.postcode, r.city].filter((v) => v).join(" "), r.state]
    .map((v) => str(v).trim()).filter((v) => v).join(", ");

function toJob(r: Record<string, unknown>): DeliveryJob {
  const status = str(r.status).toUpperCase();
  return {
    kind: r.kind === "do" ? "do" : "so",
    key: str(r.key),
    soDocNo: strOrNull(r.so_doc_no),
    doNo: strOrNull(r.do_number),
    customer: str(r.debtor_name),
    address: joinAddress(r),
    phone: strOrNull(r.phone),
    customerDate: strOrNull(r.customer_date),
    plannedDate: strOrNull(r.planned_date),
    exemptionDate: strOrNull(r.exemption_date),
    balanceSen: r.balance_sen == null ? null : Number(r.balance_sen),
    status,
    lorry: strOrNull(r.lorry),
    driver: strOrNull(r.driver),
    helpers: [r.helper_1, r.helper_2].map((h) => str(h)).filter((h) => h),
    departedAt: strOrNull(r.departed_at),
    arrivedAt: strOrNull(r.arrived_at),
    deliveredAt: strOrNull(r.delivered_at),
    proof: bool(r.proof),
    done: (ARRIVED as readonly string[]).includes(status),
    items: [],
  };
}

/** Every job on the 3PL's own fleet, open ones first by date. */
export async function listDeliveries(db: Db, supplierId: string, view: unknown): Promise<{ rows: DeliveryJob[] }> {
  const [doRows, soRows] = await Promise.all([db.query(DO_JOBS, [supplierId]), db.query(SO_JOBS, [supplierId])]);
  let jobs = [...doRows, ...soRows].map(toJob);
  jobs = view === "done" ? jobs.filter((j) => j.done) : view === "all" ? jobs : jobs.filter((j) => !j.done);

  const doIds = jobs.filter((j) => j.kind === "do").map((j) => j.key);
  const soNos = jobs.filter((j) => j.kind === "so").map((j) => j.key);
  const [doItems, soItems] = await Promise.all([
    doIds.length
      ? db.query(`SELECT di.delivery_order_id::text AS owner, di.item_code, di.description, di.description2, di.qty, di.uom, di.item_group,
              di.variants::text AS variants, si.stock_status,
              (SELECT min(pi.delivery_date)::text FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                WHERE pi.so_item_id = di.so_item_id AND upper(coalesce(po.status::text, '')) <> 'CANCELLED') AS po_eta,
              (SELECT string_agg(DISTINCT po.po_number, ', ') FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                WHERE pi.so_item_id = di.so_item_id AND upper(coalesce(po.status::text, '')) <> 'CANCELLED') AS po_nos
                    FROM scm.delivery_order_items di LEFT JOIN scm.mfg_sales_order_items si ON si.id = di.so_item_id
                   WHERE di.delivery_order_id IN (SELECT jsonb_array_elements_text($1::text::jsonb)::uuid)
                   ORDER BY di.line_no NULLS LAST, di.created_at`, [JSON.stringify(doIds)])
      : Promise.resolve([]),
    soNos.length
      ? db.query(`SELECT i.doc_no AS owner, i.item_code, i.description, i.description2, i.qty, i.uom, i.item_group,
              i.variants::text AS variants, i.stock_status,
              (SELECT min(pi.delivery_date)::text FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                WHERE pi.so_item_id = i.id AND upper(coalesce(po.status::text, '')) <> 'CANCELLED') AS po_eta,
              (SELECT string_agg(DISTINCT po.po_number, ', ') FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                WHERE pi.so_item_id = i.id AND upper(coalesce(po.status::text, '')) <> 'CANCELLED') AS po_nos
                    FROM scm.mfg_sales_order_items i
                   WHERE i.doc_no IN (SELECT jsonb_array_elements_text($1::text::jsonb)) AND NOT COALESCE(i.cancelled, false)
                   ORDER BY i.line_no NULLS LAST, i.created_at`, [JSON.stringify(soNos)])
      : Promise.resolve([]),
  ]);
  const byOwner = new Map<string, DeliveryItem[]>();
  for (const r of [...doItems, ...soItems]) {
    const list = byOwner.get(str(r.owner)) ?? [];
    let variants: Record<string, unknown> | null = null;
    try { variants = r.variants ? (JSON.parse(str(r.variants)) as Record<string, unknown>) : null; } catch { variants = null; }
    const variant = variants && typeof variants === "object" ? buildVariantSummary(strOrNull(r.item_group), variants) : "";
    list.push({
      code: str(r.item_code), description: str(r.description), description2: strOrNull(r.description2), qty: Number(r.qty ?? 0),
      uom: strOrNull(r.uom), category: strOrNull(r.item_group), variant: variant || null,
      stock: stockOf(r.stock_status), poEta: strOrNull(r.po_eta), poNos: strOrNull(r.po_nos),
    });
    byOwner.set(str(r.owner), list);
  }
  for (const j of jobs) j.items = byOwner.get(j.key) ?? [];

  const day = (j: DeliveryJob) => j.plannedDate ?? j.customerDate ?? "9999-12-31";
  jobs.sort((a, b) => (view === "done" ? day(b).localeCompare(day(a)) : day(a).localeCompare(day(b))) || a.key.localeCompare(b.key));
  return { rows: jobs };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (v: string): boolean => {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export type DateOutcome =
  | { ok: true; soDocNo: string; plannedDate: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** The 3PL sets the planned delivery date of one of its own open jobs. `key` is a Sales Order number (a planned job)
 *  or a Delivery Order id (the date is the Sales Order's, as on the board). */
export async function setDeliveryDate(
  env: Env, db: Db,
  who: { supplierId: string; userId: number; userName: string; supplierName: string; ip: string | null },
  input: { kind: unknown; key: unknown; date: unknown },
): Promise<DateOutcome> {
  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!isRealDate(date)) return { ok: false, status: 400, error: "Choose a delivery date." };
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!key || (input.kind !== "do" && input.kind !== "so")) return { ok: false, status: 400, error: "Choose the delivery." };

  // The job must be one of this 3PL's, and not yet delivered: found the same way the list finds it.
  const { rows } = await listDeliveries(db, who.supplierId, "all");
  const job = rows.find((j) => j.kind === input.kind && j.key === key);
  if (!job || !job.soDocNo) return { ok: false, status: 404, error: "Delivery not found." };
  if (job.done) return { ok: false, status: 409, error: "This delivery is already delivered." };

  const sb = getSupabaseService(env);
  const result = await advanceSoGeneration(sb, job.soDocNo, { amended_delivery_date: date });
  if (!result.applied) {
    return {
      ok: false, status: 409,
      error: result.reason === "lease"
        ? "Carres is editing this order right now. Try again in a few minutes."
        : "This order changed a moment ago. Refresh and try again.",
    };
  }
  const before = strOrNull((result.previous as Record<string, unknown>).amended_delivery_date) ?? job.plannedDate;
  await recordSoAudit(sb as unknown as Parameters<typeof recordSoAudit>[0], { // the board passes the same client (scm/middleware/auth.ts)
    docNo: job.soDocNo,
    action: "UPDATE_DETAILS",
    actorId: null,
    actorName: `${who.userName} (${who.supplierName}, 3PL)`,
    fieldChanges: [{ field: "amendedDeliveryDate", from: before, to: date }],
    statusSnapshot: job.status,
    source: "carres-3pl",
    note: "Delivery date set by the 3PL on its own pages",
  });
  await recordEvent(db, {
    kind: "delivery_date_set", supplierId: who.supplierId, supplierUserId: who.userId, subject: job.soDocNo, ip: who.ip,
    detail: { from: before, to: date, doNo: job.doNo },
  });
  return { ok: true, soDocNo: job.soDocNo, plannedDate: date };
}
