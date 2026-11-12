import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireOperationOrPrincipal } from "../../lib/auth-guards";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * Service Notes (SN) — migration 0140.
 * Every SN is a case in the Operation Issue Tracker.
 * SNs with section_a/b/c can be printed as a PDF that travels with the product.
 *
 * Routes:
 *   GET    /ready      — list (filter by status, month)
 *   POST   /           — create (auto-generates SN number via next_sn_no() RPC)
 *   GET    /:id        — full detail (includes items array)
 *   PATCH  /:id        — update (header fields, sections, status)
 *   DELETE /:id        — delete (only ongoing SNs; principal only in prod)
 */

const snRouter = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id — detail (with items)
// ─────────────────────────────────────────────────────────────────────────────
snRouter.get("/:id", requireOperationOrPrincipal, async (c) => {
  const id = c.req.param("id");
  const sb = userClient(c.env, c.var.auth.jwt);

  const [{ data: row, error: rowErr }, { data: itemRows, error: itemsErr }] =
    await Promise.all([
      sb.from("service_notes").select("*").eq("id", id).single(),
      sb.from("service_note_items").select("*").eq("sn_id", id).order("no"),
    ]);

  if (rowErr || !row)  throw new HTTPException(404, { message: "Service note not found" });
  if (itemsErr) throw new HTTPException(500, { message: itemsErr.message });

  return c.json({ ...shapeRow(row), items: (itemRows ?? []).map(shapeItem) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RawSn {
  id: string;
  sn_no: string;
  customer_name: string;
  customer_phone: string | null;
  ref_no: string | null;
  customer_address: string | null;
  order_id: string | null;
  category: string | null;
  type: string | null;
  request_date: string;
  deadline: string | null;
  delivered_date: string | null;
  what_happened: string | null;
  section_a: unknown;
  section_b: unknown;
  section_c: unknown;
  photos: string[];
  status: "ongoing" | "closed";
  current_stage: "collected" | "with_supplier" | "supplier_done" | "scheduled";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RawItem {
  id: string;
  sn_id: string;
  no: number;
  item: string;
  po_no: string | null;
  qty: number;
  remark: string | null;
}

function shapeRow(r: RawSn) {
  return {
    id:              r.id,
    snNo:            r.sn_no,
    customerName:    r.customer_name,
    customerPhone:   r.customer_phone,
    refNo:           r.ref_no,
    customerAddress: r.customer_address,
    orderId:         r.order_id,
    category:        r.category,
    type:            r.type,
    requestDate:     r.request_date,
    deadline:        r.deadline,
    deliveredDate:   r.delivered_date,
    whatHappened:    r.what_happened,
    sectionA:        r.section_a ?? null,
    sectionB:        r.section_b ?? null,
    sectionC:        r.section_c ?? null,
    photos:          r.photos ?? [],
    status:          r.status,
    currentStage:    r.current_stage ?? "collected",
    createdBy:       r.created_by,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

function shapeItem(r: RawItem) {
  return {
    id:     r.id,
    no:     r.no,
    item:   r.item,
    poNo:   r.po_no,
    qty:    r.qty,
    remark: r.remark,
  };
}

export default snRouter;
