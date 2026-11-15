// Carres only (not part of Houzs's code): pickup requests.
//
// Carres collects goods at the supplier's warehouse. Carres ticks the Sales Order lines it will come for and sends a
// request with the day it expects to arrive (REQUESTED); the supplier accepts it (ACCEPTED) and gets the goods
// ready; after the lorry has the goods Carres records the collection (COLLECTED). Carres may cancel until then.
//
// ONE RECORD, TWO READERS. Carres staff and the supplier read the same request rows. The supplier's reads are
// always filtered by ITS supplier id taken from its session, never from the address or the body, so a request id
// that belongs to another supplier answers "not found".
// A request is a notice and its answer. It moves no stock: goods still enter Carres's books through the Purchase
// Order and its goods receipt.
import type { Db, Row } from "./db";
import { int, jsonList, str, strOrNull } from "./db";
import { recordEvent, type Outcome } from "./session";

export type PickupStatus = "REQUESTED" | "ACCEPTED" | "COLLECTED" | "CANCELLED";
export const PICKUP_STATUSES: readonly PickupStatus[] = ["REQUESTED", "ACCEPTED", "COLLECTED", "CANCELLED"];

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
  cancelledAt: string | null;
  cancelReason: string | null;
  soDocNos: string[];
  lineCount: number;
  unitCount: number;
  lines: PickupLine[];
}

/** A request as Carres staff read it: who at Carres sent, collected or cancelled it is theirs to see only. */
export interface StaffPickup extends Pickup {
  requestedByName: string | null;
  collectedByName: string | null;
  cancelledByName: string | null;
}

const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const REQUEST_COLUMNS = `
  pr.id::text AS id, pr.request_no, pr.supplier_id::text AS supplier_id, s.name AS supplier_name,
  pr.expected_date::text AS expected_date, pr.expected_time, pr.note, pr.status,
  ${ts("pr.requested_at")} AS requested_at, ${ts("pr.accepted_at")} AS accepted_at, pr.accepted_by_name,
  ${ts("pr.collected_at")} AS collected_at, ${ts("pr.cancelled_at")} AS cancelled_at, pr.cancel_reason,
  pr.requested_by_name, pr.collected_by_name, pr.cancelled_by_name`;

function toPickup(r: Row, lines: PickupLine[]): StaffPickup {
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
    cancelledAt: strOrNull(r.cancelled_at),
    cancelReason: strOrNull(r.cancel_reason),
    soDocNos: [...new Set(lines.map((l) => l.soDocNo))],
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
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    soDocNos: [...p.soDocNos],
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

export interface PickupFilter { supplierId?: string | null; status?: string | null }

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
      ORDER BY (pr.status IN ('REQUESTED', 'ACCEPTED')) DESC, pr.expected_date DESC, pr.requested_at DESC
      LIMIT 500`,
    [filter.supplierId ?? null, status ?? null],
  );
  const lines = await linesFor(db, rows.map((r) => str(r.id)));
  return rows.map((r) => toPickup(r, lines.get(str(r.id)) ?? []));
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
  if (!rows[0]) return null;
  const lines = await linesFor(db, [id]);
  return toPickup(rows[0], lines.get(id) ?? []);
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

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
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

/** Carres has the goods. From REQUESTED too: goods handed over without the supplier pressing Accept were still collected. */
export async function collectPickup(db: Db, id: string, actor: StaffActor): Promise<Outcome<{ pickup: StaffPickup }>> {
  if (!isUuid(id)) return { ok: false, status: 404, error: "Pickup request not found." };
  return db.tx(async (tx): Promise<Outcome<{ pickup: StaffPickup }>> => {
    const moved = await tx.query(
      `UPDATE public.carres_pickup_requests
          SET status = 'COLLECTED', collected_at = now(), collected_by = $2, collected_by_name = $3
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
          SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancelled_by_name = $3, cancel_reason = $4
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

// ── Supplier side ───────────────────────────────────────────────────────────────────────────────────────────────

/** The supplier accepts a request: it will have the goods ready on the day. Only its own request, only once. */
export async function acceptPickup(
  db: Db, id: string, supplier: { supplierId: string; userId: number; userName: string; ip: string | null },
): Promise<Outcome<{ pickup: SupplierPickup }>> {
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

/** How many requests wait for the supplier to accept: the number on its menu. */
export async function pickupsWaiting(db: Db, supplierId: string): Promise<number> {
  const rows = await db.query(
    `SELECT count(*)::int AS n FROM public.carres_pickup_requests WHERE supplier_id = $1::uuid AND status = 'REQUESTED'`,
    [supplierId],
  );
  return int(rows[0]?.n);
}
