// Carres only (not part of Houzs's code): pickup requests.
//
// Carres collects goods at the supplier's warehouse. Carres ticks the Sales Order lines it will come for and sends a
// request with the day it expects to arrive (REQUESTED); the supplier accepts it (ACCEPTED) and gets the goods
// ready; after the lorry has the goods the request is COLLECTED: the supplier marks it with the Delivery Order
// Carres signed (a PDF), or Carres records it. Carres may cancel until then.
//
// THE SUPPLIER ASKS, CARRES DECIDES (owner, 17 Nov 2026). On an accepted request the supplier may ask Carres to move
// the day or to cancel. The ask changes nothing by itself: Carres books its lorry for the day it asked for, so the
// request keeps its day and its goods until Carres approves. One ask waits at a time, and Carres's answer to the
// latest one is kept for the supplier to read.
//
// ONE RECORD, TWO READERS. Carres staff and the supplier read the same request rows. The supplier's reads are
// always filtered by ITS supplier id taken from its session, never from the address or the body, so a request id
// that belongs to another supplier answers "not found".
// A request is a notice and its answer. It moves no stock: goods still enter Carres's books through the Purchase
// Order and its goods receipt.
import type { Db, Row } from "./db";
import { bool, first, int, jsonList, str, strOrNull } from "./db";
import { recordEvent, type Outcome } from "./session";

export type PickupStatus = "REQUESTED" | "ACCEPTED" | "COLLECTED" | "CANCELLED";
export const PICKUP_STATUSES: readonly PickupStatus[] = ["REQUESTED", "ACCEPTED", "COLLECTED", "CANCELLED"];

export type AskKind = "date" | "cancel";

export interface PickupLine {
  soDocNo: string;
  soItemId: string;
  itemCode: string;
  description: string;
  spec: string | null;
  modelName: string | null;
  uom: string;
  qty: number;
}

/** The supplier's ask that waits for Carres. */
export interface PickupAsk { kind: AskKind; date: string | null; askedAt: string; askedByName: string }
/** Carres's answer to the supplier's latest ask. */
export interface PickupAnswer { kind: AskKind; approved: boolean; date: string | null; answeredAt: string; reason: string | null }
export interface DeliveryOrderFile { name: string; uploadedAt: string; size: number }
/** A Sales Order on the request and its customer, read through the supplier's scope ("" once it is not shared). */
export interface PickupOrder { docNo: string; customerName: string }

export interface Pickup {
  id: string;
  requestNo: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string;
  expectedTime: string | null;
  note: string | null;
  status: PickupStatus;
  requestedAt: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  collectedAt: string | null;
  /** The supplier's person who marked the goods collected; null when Carres recorded the collection. */
  collectedBySupplierName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Cancelled because the supplier asked and Carres approved. */
  cancelledBySupplier: boolean;
  /** The day an approved move came from. */
  previousExpectedDate: string | null;
  dateChangedAt: string | null;
  ask: PickupAsk | null;
  answer: PickupAnswer | null;
  deliveryOrder: DeliveryOrderFile | null;
  soDocNos: string[];
  orders: PickupOrder[];
  lineCount: number;
  unitCount: number;
  lines: PickupLine[];
}

/** A request as Carres staff read it: who at Carres sent, collected, cancelled or answered it is theirs to see only. */
export interface StaffPickup extends Omit<Pickup, "answer"> {
  requestedByName: string | null;
  collectedByName: string | null;
  cancelledByName: string | null;
  answer: (PickupAnswer & { byName: string | null }) | null;
}

const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const REQUEST_COLUMNS = `
  pr.id::text AS id, pr.request_no, pr.supplier_id::text AS supplier_id, s.name AS supplier_name,
  pr.expected_date::text AS expected_date, pr.expected_time, pr.note, pr.status,
  ${ts("pr.requested_at")} AS requested_at, ${ts("pr.accepted_at")} AS accepted_at, pr.accepted_by_name,
  ${ts("pr.collected_at")} AS collected_at, ${ts("pr.cancelled_at")} AS cancelled_at, pr.cancel_reason,
  pr.requested_by_name, pr.collected_by_name, pr.cancelled_by_name,
  pr.collected_by_supplier_name, pr.cancelled_by_supplier,
  pr.previous_expected_date::text AS previous_expected_date, ${ts("pr.date_changed_at")} AS date_changed_at,
  pr.ask_kind, pr.ask_date::text AS ask_date, ${ts("pr.ask_at")} AS ask_at, pr.ask_by_name,
  pr.answer_kind, pr.answer_approved, pr.answer_date::text AS answer_date, ${ts("pr.answer_at")} AS answer_at,
  pr.answer_by_name, pr.answer_reason,
  pr.do_name, pr.do_size, ${ts("pr.do_uploaded_at")} AS do_uploaded_at`;

const askKind = (v: unknown): AskKind | null => (v === "date" || v === "cancel" ? v : null);

function toPickup(r: Row, lines: PickupLine[], customers: Map<string, string>): StaffPickup {
  const kind = askKind(r.ask_kind);
  const answerKind = askKind(r.answer_kind);
  const soDocNos = [...new Set(lines.map((l) => l.soDocNo))];
  return {
    id: str(r.id),
    requestNo: str(r.request_no),
    supplierId: str(r.supplier_id),
    supplierName: str(r.supplier_name),
    expectedDate: str(r.expected_date),
    expectedTime: strOrNull(r.expected_time),
    note: strOrNull(r.note),
    status: str(r.status) as PickupStatus,
    requestedAt: strOrNull(r.requested_at),
    acceptedAt: strOrNull(r.accepted_at),
    acceptedByName: strOrNull(r.accepted_by_name),
    collectedAt: strOrNull(r.collected_at),
    collectedBySupplierName: strOrNull(r.collected_by_supplier_name),
    cancelledAt: strOrNull(r.cancelled_at),
    cancelReason: strOrNull(r.cancel_reason),
    cancelledBySupplier: bool(r.cancelled_by_supplier),
    previousExpectedDate: strOrNull(r.previous_expected_date),
    dateChangedAt: strOrNull(r.date_changed_at),
    ask: kind ? { kind, date: strOrNull(r.ask_date), askedAt: str(r.ask_at), askedByName: str(r.ask_by_name) } : null,
    answer: answerKind
      ? {
          kind: answerKind, approved: bool(r.answer_approved), date: strOrNull(r.answer_date), answeredAt: str(r.answer_at),
          reason: strOrNull(r.answer_reason), byName: strOrNull(r.answer_by_name),
        }
      : null,
    deliveryOrder: r.do_name ? { name: str(r.do_name), uploadedAt: str(r.do_uploaded_at), size: int(r.do_size) } : null,
    soDocNos,
    orders: soDocNos.map((docNo) => ({ docNo, customerName: customers.get(docNo) ?? "" })),
    lineCount: lines.length,
    unitCount: lines.reduce((a, l) => a + l.qty, 0),
    lines,
    requestedByName: strOrNull(r.requested_by_name),
    collectedByName: strOrNull(r.collected_by_name),
    cancelledByName: strOrNull(r.cancelled_by_name),
  };
}

/** A request as the supplier reads it: no Carres staff name and no internal supplier id. */
export type SupplierPickup = Omit<Pickup, "supplierId">;

/** What the supplier reads of a request, NAMED FIELD BY FIELD. A column added to the request later reaches the
 *  supplier only when it is added here; nothing passes by default. */
export function forSupplier(p: StaffPickup): SupplierPickup {
  return {
    id: p.id,
    requestNo: p.requestNo,
    supplierName: p.supplierName,
    expectedDate: p.expectedDate,
    expectedTime: p.expectedTime,
    note: p.note,
    status: p.status,
    requestedAt: p.requestedAt,
    acceptedAt: p.acceptedAt,
    acceptedByName: p.acceptedByName,
    collectedAt: p.collectedAt,
    collectedBySupplierName: p.collectedBySupplierName,
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    cancelledBySupplier: p.cancelledBySupplier,
    previousExpectedDate: p.previousExpectedDate,
    dateChangedAt: p.dateChangedAt,
    ask: p.ask ? { kind: p.ask.kind, date: p.ask.date, askedAt: p.ask.askedAt, askedByName: p.ask.askedByName } : null,
    // Carres's answer without the name of the staff member who gave it.
    answer: p.answer
      ? { kind: p.answer.kind, approved: p.answer.approved, date: p.answer.date, answeredAt: p.answer.answeredAt, reason: p.answer.reason }
      : null,
    deliveryOrder: p.deliveryOrder ? { name: p.deliveryOrder.name, uploadedAt: p.deliveryOrder.uploadedAt, size: p.deliveryOrder.size } : null,
    soDocNos: [...p.soDocNos],
    orders: p.orders.map((o) => ({ docNo: o.docNo, customerName: o.customerName })),
    lineCount: p.lineCount,
    unitCount: p.unitCount,
    lines: p.lines.map((l) => ({
      soDocNo: l.soDocNo, soItemId: l.soItemId, itemCode: l.itemCode, description: l.description, spec: l.spec,
      modelName: l.modelName, uom: l.uom, qty: l.qty,
    })),
  };
}

async function linesFor(db: Db, requestIds: string[]): Promise<Map<string, PickupLine[]>> {
  const out = new Map<string, PickupLine[]>();
  if (!requestIds.length) return out;
  const rows = await db.query(
    `SELECT pl.request_id::text AS request_id, pl.so_doc_no, pl.so_item_id::text AS so_item_id, pl.item_code,
            pl.description, pl.spec, pl.model_name, pl.uom, pl.qty
       FROM public.carres_pickup_request_lines pl
      WHERE pl.request_id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb))
      ORDER BY pl.so_doc_no, pl.id`,
    [jsonList(requestIds)],
  );
  for (const r of rows) {
    const key = str(r.request_id);
    out.set(key, [...(out.get(key) ?? []), {
      soDocNo: str(r.so_doc_no), soItemId: str(r.so_item_id), itemCode: str(r.item_code), description: str(r.description),
      spec: strOrNull(r.spec), modelName: strOrNull(r.model_name), uom: str(r.uom), qty: int(r.qty),
    }]);
  }
  return out;
}

/** The customer of each Sales Order on these requests, read through each supplier's OWN scope (migration 2012):
 *  the one place that decides what a supplier may read of an order. An order no longer shared reads as "". */
async function customersFor(db: Db, rows: Row[], lines: Map<string, PickupLine[]>): Promise<Map<string, Map<string, string>>> {
  const docsBySupplier = new Map<string, Set<string>>();
  for (const r of rows) {
    const supplier = str(r.supplier_id);
    const docs = docsBySupplier.get(supplier) ?? new Set<string>();
    for (const l of lines.get(str(r.id)) ?? []) docs.add(l.soDocNo);
    docsBySupplier.set(supplier, docs);
  }
  const out = new Map<string, Map<string, string>>();
  for (const [supplier, docs] of docsBySupplier) {
    const names = new Map<string, string>();
    if (docs.size && isUuid(supplier)) {
      const found = await db.query(
        `SELECT o.doc_no, o.customer_name
           FROM public.carres_supplier_scope_orders($1::uuid) o
          WHERE o.doc_no IN (SELECT jsonb_array_elements_text($2::text::jsonb))`,
        [supplier, jsonList([...docs])],
      );
      for (const f of found) names.set(str(f.doc_no), str(f.customer_name));
    }
    out.set(supplier, names);
  }
  return out;
}

async function build(db: Db, rows: Row[]): Promise<StaffPickup[]> {
  const lines = await linesFor(db, rows.map((r) => str(r.id)));
  const customers = await customersFor(db, rows, lines);
  return rows.map((r) => toPickup(r, lines.get(str(r.id)) ?? [], customers.get(str(r.supplier_id)) ?? new Map()));
}

export interface PickupFilter { supplierId?: string | null; status?: string | null; asked?: boolean }

/** CARRES'S SIDE: requests, newest expected day first among the live ones, of every supplier unless one is named.
 *  The supplier's own routes never call this: they read through listSupplierPickups below. */
export async function listPickups(db: Db, filter: PickupFilter): Promise<StaffPickup[]> {
  const status = (PICKUP_STATUSES as readonly string[]).includes(filter.status ?? "") ? filter.status : null;
  const rows = await db.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM public.carres_pickup_requests pr
       JOIN scm.suppliers s ON s.id = pr.supplier_id
      WHERE ($1::uuid IS NULL OR pr.supplier_id = $1::uuid)
        AND ($2::text IS NULL OR pr.status = $2::text)
        AND (NOT $3::boolean OR pr.ask_kind IS NOT NULL)
      ORDER BY (pr.status IN ('REQUESTED', 'ACCEPTED')) DESC, pr.expected_date DESC, pr.requested_at DESC
      LIMIT 500`,
    [filter.supplierId ?? null, status ?? null, filter.asked === true],
  );
  return build(db, rows);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** CARRES'S SIDE: one request. With `supplierId`, only when it belongs to that supplier. The supplier's own routes
 *  never call this: they read through getSupplierPickup below. */
export async function getPickup(db: Db, id: string, supplierId?: string | null): Promise<StaffPickup | null> {
  if (!isUuid(id)) return null;
  const rows = await db.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM public.carres_pickup_requests pr
       JOIN scm.suppliers s ON s.id = pr.supplier_id
      WHERE pr.id = $1::uuid AND ($2::uuid IS NULL OR pr.supplier_id = $2::uuid)`,
    [id, supplierId ?? null],
  );
  const one = first(await build(db, rows));
  return one ?? null;
}

/** Several of ONE supplier's requests, in the order the ids were given. */
async function pickupsByIds(db: Db, ids: string[], supplierId: string): Promise<StaffPickup[]> {
  const rows = await db.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM public.carres_pickup_requests pr
       JOIN scm.suppliers s ON s.id = pr.supplier_id
      WHERE pr.id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb)) AND pr.supplier_id = $2::uuid`,
    [jsonList(ids), supplierId],
  );
  const built = await build(db, rows);
  const byId = new Map(built.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is StaffPickup => !!p);
}

// ── The supplier's side of reading ──────────────────────────────────────────────────────────────────────────────
// The supplier id is REQUIRED here and is the one in the session. Without a real one these answer nothing, so a
// forgotten argument can never widen a read to every supplier's requests.

export async function listSupplierPickups(db: Db, supplierId: string, status?: string | null): Promise<SupplierPickup[]> {
  if (!isUuid(supplierId)) return [];
  return (await listPickups(db, { supplierId, status })).map(forSupplier);
}

export async function getSupplierPickup(db: Db, id: string, supplierId: string): Promise<SupplierPickup | null> {
  if (!isUuid(supplierId)) return null;
  const pickup = await getPickup(db, id, supplierId);
  return pickup ? forSupplier(pickup) : null;
}

/** Where a request's Delivery Order is kept, for the supplier (its own request only) or for Carres (any). */
export async function deliveryOrderFile(db: Db, id: string, supplierId: string | null): Promise<{ key: string; name: string } | null> {
  if (!isUuid(id) || (supplierId !== null && !isUuid(supplierId))) return null;
  const rows = await db.query(
    `SELECT pr.do_key, pr.do_name FROM public.carres_pickup_requests pr
      WHERE pr.id = $1::uuid AND ($2::uuid IS NULL OR pr.supplier_id = $2::uuid) AND pr.do_key IS NOT NULL`,
    [id, supplierId],
  );
  const r = first(rows);
  return r ? { key: str(r.do_key), name: str(r.do_name) } : null;
}

// ── Carres side ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface EligibleLine extends PickupLine {
  soDate: string | null;
  status: string;
  customerName: string;
  deliveryDate: string | null;
}

/** Statuses whose goods Carres may still come for. A Draft is not shared at all; a cancelled or finished order has
 *  nothing left to collect. */
const COLLECTABLE = ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD"];

/** The supplier's shared order lines that are not on a live request yet: what Carres may tick. */
export async function eligibleLines(db: Db, supplierId: string): Promise<EligibleLine[]> {
  if (!isUuid(supplierId)) return [];
  const rows = await db.query(
    `SELECT it.so_item_id::text AS so_item_id, it.doc_no, it.item_code, it.description, it.spec, it.model_name, it.uom,
            it.qty, o.so_date::text AS so_date, o.status, o.customer_name,
            o.customer_delivery_date::text AS customer_delivery_date
       FROM public.carres_supplier_scope_items($1::uuid) it
       JOIN public.carres_supplier_scope_orders($1::uuid) o ON o.doc_no = it.doc_no
      WHERE o.status IN (SELECT jsonb_array_elements_text($2::text::jsonb))
        AND NOT EXISTS (SELECT 1 FROM public.carres_pickup_request_lines pl WHERE pl.so_item_id = it.so_item_id AND pl.open)
      ORDER BY o.so_date, it.doc_no, it.line_no, it.so_item_id
      LIMIT 2000`,
    [supplierId, jsonList(COLLECTABLE)],
  );
  return rows.map((r) => ({
    soDocNo: str(r.doc_no), soItemId: str(r.so_item_id), itemCode: str(r.item_code), description: str(r.description),
    spec: strOrNull(r.spec), modelName: strOrNull(r.model_name), uom: str(r.uom), qty: int(r.qty),
    soDate: strOrNull(r.so_date), status: str(r.status), customerName: str(r.customer_name),
    deliveryDate: strOrNull(r.customer_delivery_date),
  }));
}

export interface StaffActor { id: number | null; name: string }

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isClock = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Today in Kuala Lumpur, as YYYY-MM-DD: a pickup day is a calendar day there. */
export function todayMyt(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

export interface CreateInput { supplierId: unknown; expectedDate: unknown; expectedTime?: unknown; note?: unknown; soItemIds: unknown }

export async function createPickup(db: Db, input: CreateInput, actor: StaffActor, today = todayMyt()): Promise<Outcome<{ pickup: StaffPickup }>> {
  if (!isUuid(input.supplierId)) return { ok: false, status: 400, error: "Choose a supplier." };
  if (!isDay(input.expectedDate)) return { ok: false, status: 400, error: "Choose the day Carres will collect." };
  if (input.expectedDate < today) return { ok: false, status: 400, error: "The pickup day cannot be in the past." };
  const time = input.expectedTime == null || input.expectedTime === "" ? null : input.expectedTime;
  if (time !== null && !isClock(time)) return { ok: false, status: 400, error: "Enter the time as HH:MM." };
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const ids = Array.isArray(input.soItemIds) ? [...new Set(input.soItemIds.filter(isUuid))] : [];
  if (!ids.length) return { ok: false, status: 400, error: "Tick at least one Sales Order line." };
  if (ids.length > 500) return { ok: false, status: 400, error: "A request holds at most 500 lines. Put the rest on another request." };
  const supplierId = input.supplierId;
  const expectedDate = input.expectedDate;

  try {
    return await db.tx(async (tx): Promise<Outcome<{ pickup: StaffPickup }>> => {
      const access = await tx.query(
        `SELECT 1 FROM public.carres_supplier_access WHERE supplier_id = $1::uuid AND enabled`, [supplierId]);
      if (!access[0]) return { ok: false, status: 409, error: "This supplier's access is off. Turn it on in Settings › Supplier Access first." };

      // Only lines the supplier is shared, on an order that can still be collected, and on no live request.
      const lines = await tx.query(
        `SELECT it.so_item_id::text AS so_item_id, it.doc_no, it.item_code, it.description, it.spec, it.model_name, it.uom, it.qty
           FROM public.carres_supplier_scope_items($1::uuid) it
           JOIN public.carres_supplier_scope_orders($1::uuid) o ON o.doc_no = it.doc_no
          WHERE it.so_item_id::text IN (SELECT jsonb_array_elements_text($2::text::jsonb))
            AND o.status IN (SELECT jsonb_array_elements_text($3::text::jsonb))
            AND NOT EXISTS (SELECT 1 FROM public.carres_pickup_request_lines pl WHERE pl.so_item_id = it.so_item_id AND pl.open)
          ORDER BY it.doc_no, it.line_no`,
        [supplierId, jsonList(ids), jsonList(COLLECTABLE)],
      );
      if (lines.length !== ids.length) {
        return { ok: false, status: 409, error: "Some lines can no longer be requested: they are already on a pickup request, or the order changed. Refresh and tick again." };
      }

      const period = expectedDate.slice(2, 4) + expectedDate.slice(5, 7);
      const counter = await tx.query<{ last_no: number }>(
        `INSERT INTO public.carres_pickup_request_counters (period, last_no) VALUES ($1, 1)
         ON CONFLICT (period) DO UPDATE SET last_no = public.carres_pickup_request_counters.last_no + 1
         RETURNING last_no`,
        [period],
      );
      const requestNo = `CR-PKR-${period}-${String(int(counter[0]?.last_no)).padStart(3, "0")}`;
      const made = await tx.query<{ id: string }>(
        `INSERT INTO public.carres_pickup_requests
           (request_no, supplier_id, expected_date, expected_time, note, requested_by, requested_by_name)
         VALUES ($1, $2::uuid, $3::text::date, $4, $5, $6, $7)
         RETURNING id::text AS id`,
        [requestNo, supplierId, expectedDate, time, note, actor.id, actor.name],
      );
      const id = str(made[0]?.id);
      await tx.query(
        `INSERT INTO public.carres_pickup_request_lines
           (request_id, so_doc_no, so_item_id, item_code, description, spec, model_name, uom, qty)
         SELECT $1::uuid, x.doc_no, x.so_item_id::uuid, x.item_code, x.description, x.spec, x.model_name, x.uom, x.qty
           FROM jsonb_to_recordset($2::text::jsonb)
                AS x(doc_no text, so_item_id text, item_code text, description text, spec text, model_name text, uom text, qty integer)`,
        [id, JSON.stringify(lines)],
      );
      await recordEvent(tx, {
        kind: "pickup_requested", supplierId, staffUserId: actor.id, subject: requestNo,
        detail: { expectedDate, lines: lines.length },
      });
      const pickup = await getPickup(tx, id);
      return pickup ? { ok: true, pickup } : { ok: false, status: 404, error: "The request could not be read back." };
    });
  } catch (e) {
    // Two people sending the same line at once: the one-live-request index refuses the second.
    if (String((e as { message?: string } | null)?.message ?? "").includes("carres_pickup_request_lines_one_open_per_so_line")) {
      return { ok: false, status: 409, error: "Someone just requested one of these lines. Refresh and tick again." };
    }
    throw e;
  }
}

// Every statement below that moves a request out of ACCEPTED also clears a waiting ask, in the same statement: an
// ask only lives on an accepted request (the ask_shape check of migration 2017), so the request takes it along.

/** Carres has the goods. From REQUESTED too: goods handed over without the supplier pressing Accept were still collected. */
export async function collectPickup(db: Db, id: string, actor: StaffActor): Promise<Outcome<{ pickup: StaffPickup }>> {
  if (!isUuid(id)) return { ok: false, status: 404, error: "Pickup request not found." };
  return db.tx(async (tx): Promise<Outcome<{ pickup: StaffPickup }>> => {
    const moved = await tx.query(
      `UPDATE public.carres_pickup_requests
          SET status = 'COLLECTED', collected_at = now(), collected_by = $2, collected_by_name = $3,
              ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
        WHERE id = $1::uuid AND status IN ('REQUESTED', 'ACCEPTED')
        RETURNING request_no, supplier_id::text AS supplier_id`,
      [id, actor.id, actor.name],
    );
    if (!moved[0]) {
      const now = await getPickup(tx, id);
      if (!now) return { ok: false, status: 404, error: "Pickup request not found." };
      return { ok: false, status: 409, error: now.status === "COLLECTED" ? "This request is already collected." : "A cancelled request cannot be collected." };
    }
    await recordEvent(tx, { kind: "pickup_collected", supplierId: str(moved[0].supplier_id), staffUserId: actor.id, subject: str(moved[0].request_no) });
    const pickup = await getPickup(tx, id);
    return pickup ? { ok: true, pickup } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

export async function cancelPickup(db: Db, id: string, reason: unknown, actor: StaffActor): Promise<Outcome<{ pickup: StaffPickup }>> {
  if (!isUuid(id)) return { ok: false, status: 404, error: "Pickup request not found." };
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (!why) return { ok: false, status: 400, error: "Say why the request is cancelled. The supplier reads it." };
  return db.tx(async (tx): Promise<Outcome<{ pickup: StaffPickup }>> => {
    const moved = await tx.query(
      `UPDATE public.carres_pickup_requests
          SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancelled_by_name = $3, cancel_reason = $4,
              ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
        WHERE id = $1::uuid AND status IN ('REQUESTED', 'ACCEPTED')
        RETURNING request_no, supplier_id::text AS supplier_id`,
      [id, actor.id, actor.name, why],
    );
    if (!moved[0]) {
      const now = await getPickup(tx, id);
      if (!now) return { ok: false, status: 404, error: "Pickup request not found." };
      return { ok: false, status: 409, error: now.status === "COLLECTED" ? "Collected goods cannot be cancelled here." : "This request is already cancelled." };
    }
    // The lines are free to be asked for again.
    await tx.query(`UPDATE public.carres_pickup_request_lines SET open = false WHERE request_id = $1::uuid`, [id]);
    await recordEvent(tx, { kind: "pickup_cancelled", supplierId: str(moved[0].supplier_id), staffUserId: actor.id, subject: str(moved[0].request_no), detail: { reason: why } });
    const pickup = await getPickup(tx, id);
    return pickup ? { ok: true, pickup } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

/** The reason Carres gives the supplier when it cancels a request because the supplier asked. */
export const CANCEL_ASKED_REASON = "Asked by the supplier";

/**
 * CARRES ANSWERS the supplier's ask. Approving a move puts the request on the asked-for day (the day it moved from
 * is kept, and a time Carres had named no longer holds). Approving a cancel cancels the request and frees its lines,
 * as Carres's own cancel does. Declining leaves the request as it was. Either way the ask is answered and the answer
 * is kept for the supplier to read.
 */
export async function answerPickupAsk(
  db: Db, id: string, input: { approve: boolean; reason?: unknown }, actor: StaffActor, today = todayMyt(),
): Promise<Outcome<{ pickup: StaffPickup }>> {
  if (!isUuid(id)) return { ok: false, status: 404, error: "Pickup request not found." };
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  return db.tx(async (tx): Promise<Outcome<{ pickup: StaffPickup }>> => {
    const rows = await tx.query(
      `SELECT pr.request_no, pr.supplier_id::text AS supplier_id, pr.status, pr.ask_kind, pr.ask_date::text AS ask_date
         FROM public.carres_pickup_requests pr WHERE pr.id = $1::uuid FOR UPDATE`,
      [id],
    );
    const cur = first(rows);
    if (!cur) return { ok: false, status: 404, error: "Pickup request not found." };
    const kind = askKind(cur.ask_kind);
    if (!kind) return { ok: false, status: 409, error: "The supplier has no request waiting for an answer here." };
    const supplierId = str(cur.supplier_id);
    const requestNo = str(cur.request_no);
    const askDate = strOrNull(cur.ask_date);

    if (!input.approve) {
      await tx.query(
        `UPDATE public.carres_pickup_requests
            SET answer_kind = ask_kind, answer_approved = false, answer_date = ask_date, answer_at = now(),
                answer_by = $2, answer_by_name = $3, answer_reason = $4,
                ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
          WHERE id = $1::uuid`,
        [id, actor.id, actor.name, reason],
      );
      await recordEvent(tx, { kind: "pickup_ask_declined", supplierId, staffUserId: actor.id, subject: requestNo, detail: { ask: kind, date: askDate } });
    } else if (kind === "date") {
      if (!askDate || askDate < today) {
        return { ok: false, status: 409, error: "The day the supplier asked for has passed. Decline it, and the supplier can ask for another day." };
      }
      await tx.query(
        `UPDATE public.carres_pickup_requests
            SET previous_expected_date = expected_date, expected_date = ask_date, expected_time = NULL, date_changed_at = now(),
                answer_kind = 'date', answer_approved = true, answer_date = ask_date, answer_at = now(),
                answer_by = $2, answer_by_name = $3, answer_reason = $4,
                ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
          WHERE id = $1::uuid`,
        [id, actor.id, actor.name, reason],
      );
      await recordEvent(tx, { kind: "pickup_ask_approved", supplierId, staffUserId: actor.id, subject: requestNo, detail: { ask: kind, date: askDate } });
    } else {
      await tx.query(
        `UPDATE public.carres_pickup_requests
            SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancelled_by_name = $3, cancel_reason = $5,
                cancelled_by_supplier = true,
                answer_kind = 'cancel', answer_approved = true, answer_date = NULL, answer_at = now(),
                answer_by = $2, answer_by_name = $3, answer_reason = $4,
                ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
          WHERE id = $1::uuid`,
        [id, actor.id, actor.name, reason, CANCEL_ASKED_REASON],
      );
      // The lines are free to be asked for again, as with any cancel.
      await tx.query(`UPDATE public.carres_pickup_request_lines SET open = false WHERE request_id = $1::uuid`, [id]);
      await recordEvent(tx, { kind: "pickup_ask_approved", supplierId, staffUserId: actor.id, subject: requestNo, detail: { ask: kind } });
    }
    const pickup = await getPickup(tx, id);
    return pickup ? { ok: true, pickup } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

// ── Supplier side ───────────────────────────────────────────────────────────────────────────────────────────────

export interface SupplierActor { supplierId: string; userId: number; userName: string; ip: string | null }

/** At most this many requests in one press of a button. */
export const MAX_PICKUPS_AT_ONCE = 100;

/** A list of request ids from a body, each once, or null when it is not one. */
export function pickupIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PICKUPS_AT_ONCE) return null;
  const ids = [...new Set(v)];
  return ids.every(isUuid) ? (ids as string[]) : null;
}

/** Why a request is not where an action needs it, in the supplier's words. */
function notReady(requestNo: string, status: string, want: "accept" | "collect"): string {
  if (status === "CANCELLED") return `${requestNo} was cancelled by Carres. Refresh and try again.`;
  if (status === "COLLECTED") return `${requestNo} is already collected.`;
  if (want === "accept") return `${requestNo} is already accepted.`;
  return `${requestNo} is not accepted yet. Accept it first.`;
}

/**
 * Lock this supplier's requests for an action and check each is where the action needs it. All or nothing: the
 * supplier confirmed the whole selection ("these units will be ready"), so one that moved meanwhile stops all.
 */
async function lockOwn(tx: Db, ids: string[], supplierId: string, need: PickupStatus, want: "accept" | "collect"): Promise<Outcome<{ nos: Map<string, string> }>> {
  const rows = await tx.query(
    `SELECT pr.id::text AS id, pr.request_no, pr.status
       FROM public.carres_pickup_requests pr
      WHERE pr.id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb)) AND pr.supplier_id = $2::uuid
      ORDER BY pr.id
        FOR UPDATE`,
    [jsonList(ids), supplierId],
  );
  if (rows.length !== ids.length) return { ok: false, status: 404, error: "A pickup request was not found. Refresh and try again." };
  const byId = new Map(rows.map((r) => [str(r.id), r]));
  for (const id of ids) {
    const r = byId.get(id)!;
    if (str(r.status) !== need) return { ok: false, status: 409, error: notReady(str(r.request_no), str(r.status), want) };
  }
  return { ok: true, nos: new Map(rows.map((r) => [str(r.id), str(r.request_no)])) };
}

/** The supplier accepts a request: it will have the goods ready on the day. Only its own request, only once. */
export async function acceptPickup(db: Db, id: string, supplier: SupplierActor): Promise<Outcome<{ pickup: SupplierPickup }>> {
  if (!isUuid(id) || !isUuid(supplier.supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  return db.tx(async (tx): Promise<Outcome<{ pickup: SupplierPickup }>> => {
    const moved = await tx.query(
      `UPDATE public.carres_pickup_requests
          SET status = 'ACCEPTED', accepted_at = now(), accepted_by = $3, accepted_by_name = $4
        WHERE id = $1::uuid AND supplier_id = $2::uuid AND status = 'REQUESTED'
        RETURNING request_no`,
      [id, supplier.supplierId, supplier.userId, supplier.userName],
    );
    if (!moved[0]) {
      const now = await getPickup(tx, id, supplier.supplierId);
      if (!now) return { ok: false, status: 404, error: "Pickup request not found." };
      return { ok: false, status: 409, error: now.status === "CANCELLED" ? "Carres cancelled this request." : "This request is already accepted." };
    }
    await recordEvent(tx, {
      kind: "pickup_accepted", supplierId: supplier.supplierId, supplierUserId: supplier.userId, subject: str(moved[0].request_no), ip: supplier.ip,
    });
    const pickup = await getPickup(tx, id, supplier.supplierId);
    return pickup ? { ok: true, pickup: forSupplier(pickup) } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

/** The supplier accepts several requests at once, all or none. */
export async function acceptPickups(db: Db, ids: string[], supplier: SupplierActor): Promise<Outcome<{ pickups: SupplierPickup[] }>> {
  if (!isUuid(supplier.supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  return db.tx(async (tx): Promise<Outcome<{ pickups: SupplierPickup[] }>> => {
    const locked = await lockOwn(tx, ids, supplier.supplierId, "REQUESTED", "accept");
    if (!locked.ok) return locked;
    await tx.query(
      `UPDATE public.carres_pickup_requests
          SET status = 'ACCEPTED', accepted_at = now(), accepted_by = $3, accepted_by_name = $4
        WHERE id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb)) AND supplier_id = $2::uuid AND status = 'REQUESTED'`,
      [jsonList(ids), supplier.supplierId, supplier.userId, supplier.userName],
    );
    for (const id of ids) {
      await recordEvent(tx, {
        kind: "pickup_accepted", supplierId: supplier.supplierId, supplierUserId: supplier.userId, subject: locked.nos.get(id) ?? null, ip: supplier.ip,
      });
    }
    return { ok: true, pickups: (await pickupsByIds(tx, ids, supplier.supplierId)).map(forSupplier) };
  });
}

/** A Delivery Order already put in the file store, for one request. */
export interface StoredDeliveryOrder { key: string; name: string; size: number }

/** Accepted requests the supplier may mark collected, checked BEFORE any file is stored (the route then stores the
 *  files and calls markPickupsCollected, which checks again under a lock). */
export async function checkCollectable(db: Db, ids: string[], supplierId: string): Promise<Outcome<{ ready: true }>> {
  if (!isUuid(supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  const rows = await db.query(
    `SELECT pr.id::text AS id, pr.request_no, pr.status
       FROM public.carres_pickup_requests pr
      WHERE pr.id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb)) AND pr.supplier_id = $2::uuid`,
    [jsonList(ids), supplierId],
  );
  if (rows.length !== ids.length) return { ok: false, status: 404, error: "A pickup request was not found. Refresh and try again." };
  for (const r of rows) {
    if (str(r.status) !== "ACCEPTED") return { ok: false, status: 409, error: notReady(str(r.request_no), str(r.status), "collect") };
  }
  return { ok: true, ready: true };
}

/**
 * The supplier marks accepted requests collected, each with the Delivery Order Carres signed. All or none. An ask
 * still waiting on one of them is answered by the goods leaving: it is cleared.
 */
export async function markPickupsCollected(
  db: Db, ids: string[], files: Map<string, StoredDeliveryOrder>, supplier: SupplierActor,
): Promise<Outcome<{ pickups: SupplierPickup[] }>> {
  if (!isUuid(supplier.supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  if (ids.some((id) => !files.has(id))) return { ok: false, status: 400, error: "Attach the Delivery Order for every pickup." };
  return db.tx(async (tx): Promise<Outcome<{ pickups: SupplierPickup[] }>> => {
    const locked = await lockOwn(tx, ids, supplier.supplierId, "ACCEPTED", "collect");
    if (!locked.ok) return locked;
    await tx.query(
      `UPDATE public.carres_pickup_requests pr
          SET status = 'COLLECTED', collected_at = now(), collected_by_supplier_user = $3, collected_by_supplier_name = $4,
              do_key = x.do_key, do_name = x.do_name, do_size = x.do_size, do_uploaded_at = now(),
              ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
         FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, do_key text, do_name text, do_size integer)
        WHERE pr.id::text = x.id AND pr.supplier_id = $2::uuid AND pr.status = 'ACCEPTED'`,
      [JSON.stringify(ids.map((id) => ({ id, do_key: files.get(id)!.key, do_name: files.get(id)!.name, do_size: files.get(id)!.size }))),
        supplier.supplierId, supplier.userId, supplier.userName],
    );
    for (const id of ids) {
      await recordEvent(tx, {
        kind: "pickup_collected", supplierId: supplier.supplierId, supplierUserId: supplier.userId, subject: locked.nos.get(id) ?? null,
        ip: supplier.ip, detail: { by: "supplier", deliveryOrder: files.get(id)!.name },
      });
    }
    return { ok: true, pickups: (await pickupsByIds(tx, ids, supplier.supplierId)).map(forSupplier) };
  });
}

/** What the supplier may ask of an accepted request. */
export interface AskInput { kind: unknown; date?: unknown }

/** The supplier asks Carres to move an accepted request to another day, or to cancel it. Nothing moves yet. */
export async function askPickupChange(
  db: Db, id: string, input: AskInput, supplier: SupplierActor, today = todayMyt(),
): Promise<Outcome<{ pickup: SupplierPickup }>> {
  if (!isUuid(id) || !isUuid(supplier.supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  const kind = askKind(input.kind);
  if (!kind) return { ok: false, status: 400, error: "Say what you are asking Carres for." };
  if (kind === "date") {
    if (!isDay(input.date)) return { ok: false, status: 400, error: "Choose the new pickup day." };
    if (input.date < today) return { ok: false, status: 400, error: "The new pickup day cannot be in the past." };
  }
  const date = kind === "date" ? (input.date as string) : null;
  return db.tx(async (tx): Promise<Outcome<{ pickup: SupplierPickup }>> => {
    const rows = await tx.query(
      `SELECT pr.request_no, pr.status, pr.ask_kind, pr.expected_date::text AS expected_date
         FROM public.carres_pickup_requests pr WHERE pr.id = $1::uuid AND pr.supplier_id = $2::uuid FOR UPDATE`,
      [id, supplier.supplierId],
    );
    const cur = first(rows);
    if (!cur) return { ok: false, status: 404, error: "Pickup request not found." };
    if (str(cur.status) !== "ACCEPTED") return { ok: false, status: 409, error: "Only an accepted pickup can be changed." };
    if (askKind(cur.ask_kind)) return { ok: false, status: 409, error: "Carres has not answered your last request yet." };
    if (date && date === str(cur.expected_date)) return { ok: false, status: 400, error: "Choose a day other than the one already set." };
    await tx.query(
      `UPDATE public.carres_pickup_requests
          SET ask_kind = $3, ask_date = $4::text::date, ask_at = now(), ask_by = $5, ask_by_name = $6,
              answer_kind = NULL, answer_approved = NULL, answer_date = NULL, answer_at = NULL, answer_by = NULL,
              answer_by_name = NULL, answer_reason = NULL
        WHERE id = $1::uuid AND supplier_id = $2::uuid`,
      [id, supplier.supplierId, kind, date, supplier.userId, supplier.userName],
    );
    await recordEvent(tx, {
      kind: kind === "date" ? "pickup_date_asked" : "pickup_cancel_asked", supplierId: supplier.supplierId, supplierUserId: supplier.userId,
      subject: str(cur.request_no), ip: supplier.ip, detail: kind === "date" ? { date } : {},
    });
    const pickup = await getPickup(tx, id, supplier.supplierId);
    return pickup ? { ok: true, pickup: forSupplier(pickup) } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

/** The supplier takes back an ask Carres has not answered yet. */
export async function withdrawPickupAsk(db: Db, id: string, supplier: SupplierActor): Promise<Outcome<{ pickup: SupplierPickup }>> {
  if (!isUuid(id) || !isUuid(supplier.supplierId)) return { ok: false, status: 404, error: "Pickup request not found." };
  return db.tx(async (tx): Promise<Outcome<{ pickup: SupplierPickup }>> => {
    const moved = await tx.query(
      `UPDATE public.carres_pickup_requests
          SET ask_kind = NULL, ask_date = NULL, ask_at = NULL, ask_by = NULL, ask_by_name = NULL
        WHERE id = $1::uuid AND supplier_id = $2::uuid AND ask_kind IS NOT NULL
        RETURNING request_no`,
      [id, supplier.supplierId],
    );
    if (!moved[0]) {
      const now = await getPickup(tx, id, supplier.supplierId);
      if (!now) return { ok: false, status: 404, error: "Pickup request not found." };
      return { ok: false, status: 409, error: "There is no request waiting for Carres on this pickup." };
    }
    await recordEvent(tx, { kind: "pickup_ask_withdrawn", supplierId: supplier.supplierId, supplierUserId: supplier.userId, subject: str(moved[0].request_no), ip: supplier.ip });
    const pickup = await getPickup(tx, id, supplier.supplierId);
    return pickup ? { ok: true, pickup: forSupplier(pickup) } : { ok: false, status: 404, error: "Pickup request not found." };
  });
}

/** How many requests wait for the supplier to accept: the number on its menu. */
export async function pickupsWaiting(db: Db, supplierId: string): Promise<number> {
  const rows = await db.query(
    `SELECT count(*)::int AS n FROM public.carres_pickup_requests WHERE supplier_id = $1::uuid AND status = 'REQUESTED'`,
    [supplierId],
  );
  return int(rows[0]?.n);
}
