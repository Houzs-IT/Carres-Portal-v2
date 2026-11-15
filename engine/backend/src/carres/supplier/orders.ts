// Carres only (not part of Houzs's code): the Sales Orders a supplier may read.
//
// WHAT LEAVES. Only the columns of public.carres_supplier_scope_orders / _scope_items (migration 2012) and the
// supplier's own pickup requests. Those two functions decide WHICH orders and lines (Settings › Supplier Access)
// and name every column; this file never selects from scm.mfg_sales_orders or its lines by itself, so a price,
// cost, phone, payment or remark cannot be added to an answer by an edit here. The stage history reads only a
// status and its time: never the note, the changed fields or the staff name beside them.
import type { Db, Row } from "./db";
import { first, int, jsonList, str, strOrNull } from "./db";

export type OrderView = "all" | "incoming" | "processing" | "delivered";
export const ORDER_VIEWS: readonly OrderView[] = ["all", "incoming", "processing", "delivered"];

/** Not yet processed: Submitted, with no Processing Date (the engine moves an order on the day it gets one). */
export const INCOMING_STATUSES = ["CONFIRMED"] as const;
export const PROCESSING_STATUSES = ["IN_PRODUCTION", "READY_TO_SHIP"] as const;
export const DELIVERED_STATUSES = ["SHIPPED", "DELIVERED", "INVOICED", "CLOSED"] as const;
/** Orders whose goods the supplier may still have to hand over: the forecast counts these. */
export const OPEN_DEMAND_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD"] as const;

const VIEW_STATUSES: Record<Exclude<OrderView, "all">, readonly string[]> = {
  incoming: INCOMING_STATUSES,
  processing: PROCESSING_STATUSES,
  delivered: DELIVERED_STATUSES,
};

export type PickupState = "none" | "requested" | "accepted" | "part_collected" | "collected";

export interface PickupCounts { lines: number; requested: number; accepted: number; collected: number }

/** One word for where an order's shared lines stand with pickup. */
export function orderPickupState(c: PickupCounts): PickupState {
  if (c.lines > 0 && c.collected >= c.lines) return "collected";
  if (c.collected > 0) return "part_collected";
  if (c.requested + c.accepted === 0) return "none";
  if (c.requested === 0 && c.accepted >= c.lines) return "accepted";
  return "requested";
}

export interface OrderLine {
  soItemId: string;
  lineNo: number;
  itemCode: string;
  description: string;
  spec: string | null;
  category: string;
  modelName: string | null;
  uom: string;
  qty: number;
  pickup: { state: "none" | "requested" | "accepted" | "collected"; requestId: string | null; requestNo: string | null; expectedDate: string | null };
}

export interface OrderRow {
  docNo: string;
  soDate: string | null;
  status: string;
  saleType: string;
  processingDate: string | null;
  deliveryDate: string | null;
  customerName: string;
  addressLines: string[];
  receivedAt: string | null;
  lineCount: number;
  unitCount: number;
  pickupState: PickupState;
  lines: OrderLine[];
}

/** The customer's address as the supplier sees it: the two street lines, then one "postcode city state" line. */
export function addressLines(r: { address1?: unknown; address2?: unknown; postcode?: unknown; city?: unknown; customer_state?: unknown }): string[] {
  const clean = (v: unknown) => str(v).replace(/\s+/g, " ").trim();
  const street = [clean(r.address1), clean(r.address2)].filter(Boolean);
  const hay = street.join(" ").toLowerCase();
  const locality: string[] = [];
  for (const part of [clean(r.postcode), clean(r.city), clean(r.customer_state)]) {
    if (!part) continue;
    if (hay.includes(part.toLowerCase())) continue;
    if (locality.some((p) => p.toLowerCase() === part.toLowerCase())) continue;
    locality.push(part);
  }
  return locality.length ? [...street, locality.join(" ")] : street;
}

const ORDER_COLUMNS = `
  o.doc_no, o.so_date::text AS so_date, o.status, o.sale_type, o.processing_date::text AS processing_date,
  o.customer_delivery_date::text AS customer_delivery_date, o.customer_name, o.address1, o.address2, o.postcode,
  o.city, o.customer_state,
  to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  o.line_count, o.unit_count`;

/** This supplier's live pickup line for each shared order line. Another supplier's request is never read. */
const LINE_SELECT = `
  SELECT it.so_item_id::text AS so_item_id, it.doc_no, it.line_no, it.item_code, it.description, it.spec, it.category,
         it.model_name, it.uom, it.qty,
         pr.id::text AS request_id, pr.request_no, pr.status AS request_status, pr.expected_date::text AS expected_date
    FROM public.carres_supplier_scope_items($1::uuid) it
    LEFT JOIN public.carres_pickup_request_lines pl ON pl.so_item_id = it.so_item_id AND pl.open
    LEFT JOIN public.carres_pickup_requests pr ON pr.id = pl.request_id AND pr.supplier_id = $1::uuid`;

function toLine(r: Row): OrderLine {
  const status = str(r.request_status);
  const state = status === "COLLECTED" ? "collected" : status === "ACCEPTED" ? "accepted" : status === "REQUESTED" ? "requested" : "none";
  return {
    soItemId: str(r.so_item_id),
    lineNo: int(r.line_no),
    itemCode: str(r.item_code),
    description: str(r.description),
    spec: strOrNull(r.spec),
    category: str(r.category),
    modelName: strOrNull(r.model_name),
    uom: str(r.uom),
    qty: int(r.qty),
    pickup: {
      state,
      requestId: state === "none" ? null : strOrNull(r.request_id),
      requestNo: state === "none" ? null : strOrNull(r.request_no),
      expectedDate: state === "none" ? null : strOrNull(r.expected_date),
    },
  };
}

function toOrder(r: Row, lines: OrderLine[]): OrderRow {
  const counts: PickupCounts = { lines: lines.length, requested: 0, accepted: 0, collected: 0 };
  for (const l of lines) if (l.pickup.state !== "none") counts[l.pickup.state] += 1;
  return {
    docNo: str(r.doc_no),
    soDate: strOrNull(r.so_date),
    status: str(r.status),
    saleType: str(r.sale_type) || "outright",
    processingDate: strOrNull(r.processing_date),
    deliveryDate: strOrNull(r.customer_delivery_date),
    customerName: str(r.customer_name),
    addressLines: addressLines(r),
    receivedAt: strOrNull(r.created_at),
    lineCount: int(r.line_count),
    unitCount: int(r.unit_count),
    pickupState: orderPickupState(counts),
    lines,
  };
}

const SORTS: Record<string, string> = {
  date: "o.so_date",
  docNo: "o.doc_no",
  customer: "o.customer_name",
  status: "o.status",
  processing: "o.processing_date",
  delivery: "o.customer_delivery_date",
  units: "o.unit_count",
};

export interface ListInput { view?: string; q?: string; page?: number; pageSize?: number; sort?: string; dir?: string }

const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export async function listOrders(db: Db, supplierId: string, input: ListInput): Promise<{
  rows: OrderRow[]; total: number; page: number; pageSize: number; counts: Record<OrderView, number>;
}> {
  const view: OrderView = (ORDER_VIEWS as readonly string[]).includes(input.view ?? "") ? (input.view as OrderView) : "all";
  const q = (input.q ?? "").trim().slice(0, 80);
  const pageSize = Math.min(200, Math.max(1, Math.trunc(input.pageSize ?? 50) || 50));
  const page = Math.max(1, Math.trunc(input.page ?? 1) || 1);
  // The order-by text is picked from the fixed list above, never taken from the request.
  const sortColumn = SORTS[input.sort ?? ""] ?? SORTS.date;
  const direction = input.dir === "asc" ? "ASC" : "DESC";
  const statuses = view === "all" ? null : jsonList(VIEW_STATUSES[view]);

  const head = await db.query(
    `WITH o AS (SELECT * FROM public.carres_supplier_scope_orders($1::uuid)),
     f AS (
       SELECT o.* FROM o
        WHERE ($2::text::jsonb IS NULL OR o.status IN (SELECT jsonb_array_elements_text($2::text::jsonb)))
          AND ($3 = '' OR o.doc_no ILIKE $4 ESCAPE '\\' OR o.customer_name ILIKE $4 ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM public.carres_supplier_scope_items($1::uuid) it
                           WHERE it.doc_no = o.doc_no
                             AND (it.item_code ILIKE $4 ESCAPE '\\' OR it.description ILIKE $4 ESCAPE '\\'
                                  OR it.model_name ILIKE $4 ESCAPE '\\')))
     )
     SELECT ${ORDER_COLUMNS}, (SELECT count(*)::int FROM f) AS total
       FROM f o
      ORDER BY ${sortColumn} ${direction} NULLS LAST, o.doc_no DESC
      LIMIT $5 OFFSET $6`,
    [supplierId, statuses, q, likePattern(q), pageSize, (page - 1) * pageSize],
  );

  const countRows = await db.query(
    `SELECT count(*)::int AS all_count,
            count(*) FILTER (WHERE o.status IN (SELECT jsonb_array_elements_text($2::text::jsonb)))::int AS incoming,
            count(*) FILTER (WHERE o.status IN (SELECT jsonb_array_elements_text($3::text::jsonb)))::int AS processing,
            count(*) FILTER (WHERE o.status IN (SELECT jsonb_array_elements_text($4::text::jsonb)))::int AS delivered
       FROM public.carres_supplier_scope_orders($1::uuid) o`,
    [supplierId, jsonList(INCOMING_STATUSES), jsonList(PROCESSING_STATUSES), jsonList(DELIVERED_STATUSES)],
  );

  const docNos = head.map((r) => str(r.doc_no));
  const lineRows = docNos.length
    ? await db.query(
        `${LINE_SELECT}
          WHERE it.doc_no IN (SELECT jsonb_array_elements_text($2::text::jsonb))
          ORDER BY it.doc_no, it.line_no, it.so_item_id`,
        [supplierId, jsonList(docNos)],
      )
    : [];
  const byDoc = new Map<string, OrderLine[]>();
  for (const r of lineRows) {
    const key = str(r.doc_no);
    byDoc.set(key, [...(byDoc.get(key) ?? []), toLine(r)]);
  }

  const c = countRows[0] ?? {};
  return {
    rows: head.map((r) => toOrder(r, byDoc.get(str(r.doc_no)) ?? [])),
    total: int(head[0]?.total),
    page,
    pageSize,
    counts: { all: int(c.all_count), incoming: int(c.incoming), processing: int(c.processing), delivered: int(c.delivered) },
  };
}

// ── One order: its lines, its stage history and its relationship map ────────────────────────────────────────────

export interface TrailEntry { at: string; kind: "received" | "stage" | "pickup"; code: string; ref: string | null; detail: string | null }

export interface StageRow { at: string; status: string }
export interface PickupEventRow {
  requestNo: string; expectedDate: string | null;
  requestedAt: string | null; acceptedAt: string | null; collectedAt: string | null; cancelledAt: string | null;
}

/**
 * The history a supplier reads: when the order came in, each stage it passed and when, and what happened to its
 * pickup requests. Stages come from two engine records that can both note the same change, so a repeat of the stage
 * just before it is dropped; Draft is Carres's own working state and is never shown.
 */
export function buildTrail(receivedAt: string | null, stages: StageRow[], pickups: PickupEventRow[]): TrailEntry[] {
  const out: TrailEntry[] = [];
  let last = "";
  for (const s of [...stages].sort((a, b) => a.at.localeCompare(b.at))) {
    const status = s.status.trim().toUpperCase();
    if (!status || status === "DRAFT" || status === last) continue;
    last = status;
    out.push({ at: s.at, kind: "stage", code: status, ref: null, detail: null });
  }
  for (const p of pickups) {
    if (p.requestedAt) out.push({ at: p.requestedAt, kind: "pickup", code: "PICKUP_REQUESTED", ref: p.requestNo, detail: p.expectedDate });
    if (p.acceptedAt) out.push({ at: p.acceptedAt, kind: "pickup", code: "PICKUP_ACCEPTED", ref: p.requestNo, detail: null });
    if (p.collectedAt) out.push({ at: p.collectedAt, kind: "pickup", code: "PICKUP_COLLECTED", ref: p.requestNo, detail: null });
    if (p.cancelledAt) out.push({ at: p.cancelledAt, kind: "pickup", code: "PICKUP_CANCELLED", ref: p.requestNo, detail: null });
  }
  // Stable: entries at the same second keep the order above (stages, then pickups).
  const later = out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i).map((x) => x.e);
  // The order coming in is where its history starts, whatever the clocks on the later records say.
  return receivedAt ? [{ at: receivedAt, kind: "received", code: "RECEIVED", ref: null, detail: null }, ...later] : later;
}

export type MapState = "done" | "current" | "pending";
export interface MapNode { type: string; doc: string; meta: string; state: MapState; requestId?: string | null }

const firstAt = (trail: TrailEntry[], codes: string[]): string | null =>
  trail.find((t) => codes.includes(t.code))?.at ?? null;

/** The second line of the Pickup Request tile. A step that has not happened says WHEN it happens, as the engine's
 *  own map does ("After delivery"), never a word that only says it is not done. */
const REQUEST_TILE_WORDS: Record<PickupState, string> = {
  none: "When Carres asks",
  requested: "Waiting for you to accept",
  accepted: "Accepted",
  part_collected: "Part collected",
  collected: "Collected",
};

/**
 * The five tiles of the supplier's relationship map, in the engine map's own shape (three across, two below):
 *   Sales Order → Pickup Request → Collected, then Out for Delivery → Delivered.
 * It names only this supplier's own pickup request; Carres's purchase, delivery and invoice documents are not on it.
 */
export function buildMap(order: Pick<OrderRow, "docNo" | "status" | "pickupState" | "lines">, trail: TrailEntry[]): MapNode[] {
  const live = order.lines.filter((l) => l.pickup.state !== "none");
  const requestNos = [...new Set(live.map((l) => l.pickup.requestNo).filter((n): n is string => !!n))];
  const firstLive = first(live);
  const collected = order.pickupState === "collected";
  const shipped = (DELIVERED_STATUSES as readonly string[]).includes(order.status);
  const delivered = ["DELIVERED", "INVOICED", "CLOSED"].includes(order.status);
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  return [
    { type: "Sales Order", doc: order.docNo, meta: order.status, state: "current" },
    {
      type: "Pickup Request",
      doc: requestNos.length === 0 ? "Not requested" : requestNos.length === 1 ? requestNos[0]! : `${requestNos[0]} +${requestNos.length - 1}`,
      meta: requestNos.length === 0 ? "When Carres asks" : REQUEST_TILE_WORDS[order.pickupState],
      state: requestNos.length ? "done" : "pending",
      requestId: firstLive?.pickup.requestId ?? null,
    },
    {
      type: "Collected",
      doc: collected ? "Collected" : order.pickupState === "part_collected" ? "Part collected" : "Not collected",
      meta: day(firstAt(trail, ["PICKUP_COLLECTED"])) || (collected ? "" : "On the pickup day"),
      state: collected ? "done" : "pending",
    },
    {
      type: "Out for Delivery",
      doc: shipped ? "Shipped" : "Not shipped",
      meta: day(firstAt(trail, ["SHIPPED"])) || (shipped ? "" : "After collection"),
      state: shipped ? "done" : "pending",
    },
    {
      type: "Delivered",
      doc: delivered ? "Delivered" : "Not delivered",
      meta: day(firstAt(trail, ["DELIVERED"])) || (delivered ? "" : "After shipping"),
      state: delivered ? "done" : "pending",
    },
  ];
}

export interface OrderDetail extends OrderRow { trail: TrailEntry[]; map: MapNode[] }

/** One shared order, or null when it is not shared with this supplier (which reads the same as "does not exist"). */
export async function getOrder(db: Db, supplierId: string, docNo: string): Promise<OrderDetail | null> {
  if (!docNo || docNo.length > 60) return null;
  const head = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM public.carres_supplier_scope_orders($1::uuid) o WHERE o.doc_no = $2`,
    [supplierId, docNo],
  );
  if (!head[0]) return null;
  const lineRows = await db.query(
    `${LINE_SELECT} WHERE it.doc_no = $2 ORDER BY it.line_no, it.so_item_id`,
    [supplierId, docNo],
  );
  const order = toOrder(head[0], lineRows.map(toLine));

  // A status and its time, from the two records the engine keeps of an order's stages. Nothing else is selected.
  const stageRows = await db.query(
    `SELECT to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, c.to_status AS status
       FROM scm.mfg_so_status_changes c WHERE c.doc_no = $1 AND c.to_status IS NOT NULL
     UNION ALL
     SELECT to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), a.status_snapshot
       FROM scm.mfg_so_audit_log a
      WHERE a.so_doc_no = $1 AND a.action IN ('CREATE', 'UPDATE_STATUS') AND a.status_snapshot IS NOT NULL`,
    [docNo],
  );
  const pickupRows = await db.query(
    `SELECT DISTINCT pr.request_no, pr.expected_date::text AS expected_date,
            to_char(pr.requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS requested_at,
            to_char(pr.accepted_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS accepted_at,
            to_char(pr.collected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS collected_at,
            to_char(pr.cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cancelled_at
       FROM public.carres_pickup_request_lines pl
       JOIN public.carres_pickup_requests pr ON pr.id = pl.request_id
      WHERE pl.so_doc_no = $2 AND pr.supplier_id = $1::uuid`,
    [supplierId, docNo],
  );
  const trail = buildTrail(
    order.receivedAt,
    stageRows.map((r) => ({ at: str(r.at), status: str(r.status) })),
    pickupRows.map((r) => ({
      requestNo: str(r.request_no), expectedDate: strOrNull(r.expected_date), requestedAt: strOrNull(r.requested_at),
      acceptedAt: strOrNull(r.accepted_at), collectedAt: strOrNull(r.collected_at), cancelledAt: strOrNull(r.cancelled_at),
    })),
  );
  return { ...order, trail, map: buildMap(order, trail) };
}

// ── Forecast: what the supplier's warehouse may have to hand over ───────────────────────────────────────────────

export interface ForecastRow {
  itemCode: string;
  description: string;
  spec: string | null;
  modelName: string | null;
  category: string;
  uom: string;
  /** Units on orders not yet processed (Submitted). */
  incoming: number;
  /** Units on orders being processed, not yet collected. */
  processing: number;
  total: number;
  /** Units by the month the customer expects delivery ("YYYY-MM"), "" when the order has no date yet. */
  byMonth: Record<string, number>;
}

export interface Forecast { rows: ForecastRow[]; months: string[]; totals: { incoming: number; processing: number; total: number; orders: number } }

/** Fold the per-item, per-month rows into one row an item with its months. Exported for its test. */
export function foldForecast(rows: Array<{ itemCode: string; description: string; spec: string | null; modelName: string | null; category: string; uom: string; month: string; incoming: number; processing: number }>): Pick<Forecast, "rows" | "months"> {
  const byKey = new Map<string, ForecastRow>();
  const months = new Set<string>();
  for (const r of rows) {
    const key = `${r.itemCode}\u0000${r.spec ?? ""}`;
    const row = byKey.get(key) ?? {
      itemCode: r.itemCode, description: r.description, spec: r.spec, modelName: r.modelName, category: r.category,
      uom: r.uom, incoming: 0, processing: 0, total: 0, byMonth: {},
    };
    const qty = r.incoming + r.processing;
    row.incoming += r.incoming;
    row.processing += r.processing;
    row.total += qty;
    row.byMonth[r.month] = (row.byMonth[r.month] ?? 0) + qty;
    months.add(r.month);
    byKey.set(key, row);
  }
  return {
    rows: [...byKey.values()].sort((a, b) => b.total - a.total || a.itemCode.localeCompare(b.itemCode)),
    // Dated months in order, then the undated bucket last.
    months: [...months].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))),
  };
}

export async function getForecast(db: Db, supplierId: string): Promise<Forecast> {
  const rows = await db.query(
    `SELECT it.item_code, max(it.description) AS description, it.spec, max(it.model_name) AS model_name,
            max(it.category) AS category, max(it.uom) AS uom,
            coalesce(to_char(o.customer_delivery_date, 'YYYY-MM'), '') AS month,
            coalesce(sum(it.qty) FILTER (WHERE o.status IN (SELECT jsonb_array_elements_text($3::text::jsonb))), 0)::int AS incoming,
            coalesce(sum(it.qty) FILTER (WHERE o.status NOT IN (SELECT jsonb_array_elements_text($3::text::jsonb))), 0)::int AS processing,
            count(DISTINCT o.doc_no)::int AS orders
       FROM public.carres_supplier_scope_items($1::uuid) it
       JOIN public.carres_supplier_scope_orders($1::uuid) o ON o.doc_no = it.doc_no
      WHERE o.status IN (SELECT jsonb_array_elements_text($2::text::jsonb))
        AND NOT EXISTS (SELECT 1 FROM public.carres_pickup_request_lines pl
                          JOIN public.carres_pickup_requests pr ON pr.id = pl.request_id
                         WHERE pl.so_item_id = it.so_item_id AND pl.open AND pr.status = 'COLLECTED')
      GROUP BY it.item_code, it.spec, coalesce(to_char(o.customer_delivery_date, 'YYYY-MM'), '')`,
    [supplierId, jsonList(OPEN_DEMAND_STATUSES), jsonList(INCOMING_STATUSES)],
  );
  const orderCount = await db.query(
    `SELECT count(DISTINCT o.doc_no)::int AS orders
       FROM public.carres_supplier_scope_orders($1::uuid) o
      WHERE o.status IN (SELECT jsonb_array_elements_text($2::text::jsonb))`,
    [supplierId, jsonList(OPEN_DEMAND_STATUSES)],
  );
  const folded = foldForecast(rows.map((r) => ({
    itemCode: str(r.item_code), description: str(r.description), spec: strOrNull(r.spec), modelName: strOrNull(r.model_name),
    category: str(r.category), uom: str(r.uom), month: str(r.month), incoming: int(r.incoming), processing: int(r.processing),
  })));
  const totals = folded.rows.reduce(
    (a, r) => ({ incoming: a.incoming + r.incoming, processing: a.processing + r.processing, total: a.total + r.total }),
    { incoming: 0, processing: 0, total: 0 },
  );
  return { ...folded, totals: { ...totals, orders: int(orderCount[0]?.orders) } };
}
