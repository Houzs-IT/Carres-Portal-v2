import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { deliveryAttemptRecordInputSchema, stockEtaImportInput, matchStockRows, aggregateStorageFeesByRef, aggregateBalancesByRef, appendMissingLinesInput, detectMissingLines, type AppendOrderRef, type AppendMissingLinesResult, type MissingLineCandidate, type OrderLineRef, type StockEtaImportResult, type BalancePayStatus, unitIdOf } from "@carres/shared";
import { fail } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * ops_order_control overlay — the editable "Master Sheet, live" fields for an
 * order (migration 0159; P2 of project-orders-control-spec).
 *
 *   GET /api/operation/orders/:id/control   — read the overlay (null if none)
 *   PUT /api/operation/orders/:id/control   — sparse upsert
 *
 * Plain-table CRUD via PostgREST (no RPC): the row is a 1:1 overlay keyed by
 * order_id, created lazily on first edit. RLS (migration 0159) is the security
 * boundary — read = any internal HQ role, write = operation/principal — so we
 * forward the user JWT and let RLS enforce; the inline role gate here is just
 * defence-in-depth + a clean 403 message.
 *
 * Mount via `api.route("/operation/orders", orderControlRouter)` in
 * apps/api/src/index.ts so the paths above are absolute. Mirrors the sibling
 * deliveryChainRouter mounting + inline-guard pattern.
 */
const orderControlRouter = new Hono<AppEnv>();

const ORDER_ID = z.string().uuid();

function requireOperationOrPrincipal(
  role: string,
): asserts role is "operation" | "principal" {
  if (role !== "operation" && role !== "principal") {
    throw new HTTPException(403, { message: "Operation or principal only" });
  }
}

/**
 * CARD 5 (0344) — record a PARTIAL or FAILED delivery attempt. A full success
 * walks the existing gated delivery door, which mints its own attempt. The
 * RPC is the one writer: attempt + exception (Reason Library key + where the
 * goods are) + the unit moves (deliver = reserved-to-this-SO → sold; return =
 * release or the customer-return inspection hold) in one transaction. The
 * order STATUS is untouched — partial stays Scheduled; the Work engine
 * derives what happens next from the facts.
 */
orderControlRouter.post("/:id/delivery-attempt", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);

  const idCheck = ORDER_ID.safeParse(c.req.param("id"));
  if (!idCheck.success) throw new HTTPException(404, { message: "Order not found" });

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be valid JSON" });
  }
  const parsed = deliveryAttemptRecordInputSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return c.json(
      {
        error: "invalid_input",
        code: "invalid_param",
        message: `Invalid delivery-attempt input at ${path}: ${issue?.message ?? "validation failed"}`,
      },
      422,
    );
  }

  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("delivery_attempt_record", {
    p_order_id: idCheck.data,
    p_result: parsed.data.result,
    p_reason_key: parsed.data.reasonKey ?? null,
    p_where_goods: parsed.data.whereGoods ?? null,
    p_note: parsed.data.note ?? null,
    p_delivered_item_ids: parsed.data.deliveredItemIds,
    p_returned: parsed.data.returned.map((r) => ({
      item_id: r.itemId,
      action: r.action,
      note: r.note ?? null,
    })),
    // 0491 — the Delivery scope: a Journey leg records its own result.
    p_leg: parsed.data.leg,
  });
  if (error) return fail(c, error);
  return c.json(data, 201);
});

// POST /import-stock-eta — bulk-fill per-line Stock ETA from Jess's Master "Ops"
// sheet. AutoCount orders never carried Stock ETA, so the detail's ETA box was
// blank; this joins each sheet row to an order line by PO (order_lines.source_po)
// + product name (fuzzy, colour-code tolerant) and merges the ETA into
// ops_order_control.line_etas. `dryRun` computes the match rate + writes nothing
// (the client shows it as a preview before committing). Operation/principal only;
// userClient/RLS is the security boundary.
orderControlRouter.post("/import-stock-eta", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be valid JSON" });
  }
  const parsed = stockEtaImportInput.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return c.json(
      {
        error: "invalid_input",
        code: "invalid_param",
        message: `Invalid stock-eta import at ${path}: ${issue?.message ?? "validation failed"}`,
      },
      422,
    );
  }
  const { rows, storageFees, balances, dryRun = false } = parsed.data;

  const sb = userClient(c.env, auth.jwt);

  // All order lines that carry a source PO — the join universe.
  const { data: lineData, error: lineErr } = await sb
    .from("order_lines")
    .select("order_id, sku, source_po")
    .not("source_po", "is", null);
  if (lineErr) return fail(c, lineErr);
  const lines: OrderLineRef[] = (lineData ?? []).map((l) => ({
    orderId: l.order_id as string,
    sku: l.sku as string,
    sourcePo: (l.source_po as string | null) ?? null,
  }));

  const { matched, unmatched } = matchStockRows(rows, lines);

  // Group by order → the ETA and/or the readiness STATUS for each matched line,
  // keyed by the exact order_lines.sku (the line_etas / line_stock_status key).
  const etaByOrder = new Map<string, Record<string, string>>();
  const statusByOrder = new Map<string, Record<string, string>>();
  const touchedOrders = new Set<string>();
  for (const m of matched) {
    touchedOrders.add(m.orderId);
    if (m.eta) {
      const cur = etaByOrder.get(m.orderId) ?? {};
      cur[m.sku] = m.eta;
      etaByOrder.set(m.orderId, cur);
    }
    if (m.stockStatus) {
      const cur = statusByOrder.get(m.orderId) ?? {};
      cur[m.sku] = m.stockStatus;
      statusByOrder.set(m.orderId, cur);
    }
  }

  // Storage fees (per-ORDER, by Ref) — migration 0207. Resolve each Master
  // storage-fee row's Ref to an order id (orders.source_ref is a text[]), so it
  // can be written to ops_order_control.storage_fee_msbf / _sof. Aggregated
  // server-side too (defence — a Master repeats an order's fee across its lines).
  const storageAgg = aggregateStorageFeesByRef(storageFees ?? []);
  const balanceAgg = aggregateBalancesByRef(balances ?? []);
  const feeByOrder = new Map<string, { msbf?: number; sof?: number }>();
  const balanceByOrder = new Map<
    string,
    { owing?: number; payStatus?: BalancePayStatus }
  >();
  let storageUnmatched = 0;
  let balanceUnmatched = 0;
  // Storage fees + balance/payment-status both join by Ref (per-order) — resolve
  // the ref→order map ONCE and drive both (orders.source_ref is a text[]).
  if (storageAgg.length > 0 || balanceAgg.length > 0) {
    const { data: orderData, error: ordErr } = await sb
      .from("orders")
      .select("id, source_ref");
    if (ordErr) return fail(c, ordErr);
    const orderByRef = new Map<string, string>();
    for (const o of orderData ?? []) {
      for (const ref of (o.source_ref as string[] | null) ?? []) {
        orderByRef.set(String(ref).trim().toUpperCase(), o.id as string);
      }
    }
    // Combined-ref aware resolver for balances: a Master "Ref" may be a combined
    // string ("CR1127 + TCF0477" — one physical order under several AutoCount refs).
    // Split into tokens and pick the order whose source_ref set best matches (most
    // shared tokens, then closest cardinality) so a combined-ref row lands on ITS
    // own order, not a same-token standalone order.
    const ordersForMatch = (orderData ?? []).map((o) => ({
      id: o.id as string,
      refs: ((o.source_ref as string[] | null) ?? []).map((r) =>
        String(r).trim().toUpperCase(),
      ),
    }));
    const bestOrderForRef = (ref: string): string | undefined => {
      const tokens = ref
        .split(/[+\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      if (tokens.length === 0) return undefined;
      let best: { id: string; overlap: number; card: number } | undefined;
      for (const o of ordersForMatch) {
        const overlap = o.refs.filter((r) => tokens.includes(r)).length;
        if (overlap === 0) continue;
        const card = Math.abs(o.refs.length - tokens.length);
        if (
          !best ||
          overlap > best.overlap ||
          (overlap === best.overlap && card < best.card)
        ) {
          best = { id: o.id, overlap, card };
        }
      }
      return best?.id;
    };
    for (const f of storageAgg) {
      const orderId = orderByRef.get(f.ref.trim().toUpperCase());
      if (!orderId) {
        storageUnmatched += 1;
        continue;
      }
      const cur = feeByOrder.get(orderId) ?? {};
      if (f.msbf !== undefined) cur.msbf = f.msbf;
      if (f.sof !== undefined) cur.sof = f.sof;
      feeByOrder.set(orderId, cur);
    }
    for (const b of balanceAgg) {
      const orderId = bestOrderForRef(b.ref);
      if (!orderId) {
        balanceUnmatched += 1;
        continue;
      }
      const cur = balanceByOrder.get(orderId) ?? {};
      // SUM when two distinct Master refs resolve to ONE physical order (e.g. two
      // combined-ref rows for the same customer) — both are money owed on that order.
      if (b.owing !== undefined) cur.owing = (cur.owing ?? 0) + b.owing;
      if (b.payStatus) cur.payStatus = b.payStatus;
      balanceByOrder.set(orderId, cur);
    }
  }

  const result: StockEtaImportResult = {
    matched: matched.length,
    unmatched: unmatched.length,
    orders: touchedOrders.size,
    written: 0,
    storageOrders: feeByOrder.size,
    storageWritten: 0,
    storageUnmatched,
    balanceOrders: balanceByOrder.size,
    balanceWritten: 0,
    balanceUnmatched,
    sampleUnmatched: unmatched.slice(0, 20),
    dryRun,
  };

  if (
    dryRun ||
    (touchedOrders.size === 0 && feeByOrder.size === 0 && balanceByOrder.size === 0)
  ) {
    return c.json({ result });
  }

  // Merge stock ETA/status into each order's existing line_etas + line_stock_status
  // (never clobber other lines).
  if (touchedOrders.size > 0) {
    const orderIds = [...touchedOrders];
    const { data: existing, error: exErr } = await sb
      .from("ops_order_control")
      .select("order_id, line_etas, line_stock_status")
      .in("order_id", orderIds);
    if (exErr) return fail(c, exErr);
    const existingEtas = new Map<string, Record<string, string>>();
    const existingStatus = new Map<string, Record<string, string>>();
    for (const row of existing ?? []) {
      existingEtas.set(
        row.order_id as string,
        (row.line_etas as Record<string, string> | null) ?? {},
      );
      existingStatus.set(
        row.order_id as string,
        (row.line_stock_status as Record<string, string> | null) ?? {},
      );
    }

    let written = 0;
    const upsertRows = orderIds.map((orderId) => {
      const eta = etaByOrder.get(orderId);
      const status = statusByOrder.get(orderId);
      written += Object.keys({ ...eta, ...status }).length;
      const row: {
        order_id: string;
        updated_by: string;
        line_etas?: Record<string, string>;
        line_stock_status?: Record<string, string>;
      } = { order_id: orderId, updated_by: auth.id };
      if (eta) row.line_etas = { ...(existingEtas.get(orderId) ?? {}), ...eta };
      if (status)
        row.line_stock_status = { ...(existingStatus.get(orderId) ?? {}), ...status };
      return row;
    });

    const { error: upErr } = await sb
      .from("ops_order_control")
      .upsert(upsertRows, { onConflict: "order_id" });
    if (upErr) return fail(c, upErr);
    result.written = written;
  }

  // Write the per-order storage fees (only the columns present; nulls left as-is
  // so a MS/BF-only order keeps sof null). Overwrites the import columns; never
  // touches storage_fee_override (the operator's manual value).
  if (feeByOrder.size > 0) {
    const feeRows = [...feeByOrder.entries()].map(([orderId, fee]) => {
      const row: {
        order_id: string;
        updated_by: string;
        storage_fee_msbf?: number;
        storage_fee_sof?: number;
      } = { order_id: orderId, updated_by: auth.id };
      if (fee.msbf !== undefined) row.storage_fee_msbf = fee.msbf;
      if (fee.sof !== undefined) row.storage_fee_sof = fee.sof;
      return row;
    });
    const { error: feeErr } = await sb
      .from("ops_order_control")
      .upsert(feeRows, { onConflict: "order_id" });
    if (feeErr) return fail(c, feeErr);
    result.storageWritten = feeByOrder.size;
  }

  // Write the per-order balance (owing) + payment status from the Master's
  // "Balance" + "Payment Status" columns. No migration — both columns exist.
  if (balanceByOrder.size > 0) {
    const balRows = [...balanceByOrder.entries()].map(([orderId, b]) => {
      const row: {
        order_id: string;
        updated_by: string;
        balance?: number;
        payment_status?: string;
      } = { order_id: orderId, updated_by: auth.id };
      if (b.owing !== undefined) row.balance = b.owing;
      if (b.payStatus) row.payment_status = b.payStatus;
      return row;
    });
    const { error: balErr } = await sb
      .from("ops_order_control")
      .upsert(balRows, { onConflict: "order_id" });
    if (balErr) return fail(c, balErr);
    result.balanceWritten = balanceByOrder.size;
  }

  return c.json({ result });
});

// POST /append-missing-lines — Master reconcile append (Jess Option A,
// 2026-07-18; migration 0237). After a Master import, a sheet row whose PO
// exists on NO line of its (existing, AutoCount) order is a line the portal is
// missing — 0214 made re-import create-only, so nothing else can add it. dryRun
// detects + returns the candidates (the import result screen renders them as a
// tick-list; `clean` drives the default tick); the commit call receives ONLY
// the ticked rows, RE-detects server-side (never trust the client's diff — a
// line added between preview and commit must not duplicate), then appends via
// the append_autocount_order_lines RPC (raw sku, unit_price 0, items_edited
// flip + order_history/audit inside the RPC). Operation/principal only.
orderControlRouter.post("/append-missing-lines", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be valid JSON" });
  }
  const parsed = appendMissingLinesInput.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return c.json(
      {
        error: "invalid_input",
        code: "invalid_param",
        message: `Invalid append input at ${path}: ${issue?.message ?? "validation failed"}`,
      },
      422,
    );
  }
  const { rows, dryRun = false } = parsed.data;

  const sb = userClient(c.env, auth.jwt);

  // The append universe: AutoCount orders + ALL their lines (PO-less lines
  // included — they count as divergence in the clean check).
  const { data: orderData, error: ordErr } = await sb
    .from("orders")
    .select("id, so, source_ref")
    .eq("source_system", "autocount");
  if (ordErr) return fail(c, ordErr);
  const orderIds = new Set((orderData ?? []).map((o) => o.id as string));
  const { data: lineData, error: lineErr } = await sb
    .from("order_lines")
    .select("order_id, sku, source_po");
  if (lineErr) return fail(c, lineErr);
  const linesByOrder = new Map<string, { sku: string; sourcePo: string | null }[]>();
  for (const l of lineData ?? []) {
    const oid = l.order_id as string;
    if (!orderIds.has(oid)) continue;
    const arr = linesByOrder.get(oid) ?? [];
    arr.push({ sku: l.sku as string, sourcePo: (l.source_po as string | null) ?? null });
    linesByOrder.set(oid, arr);
  }
  const orders: AppendOrderRef[] = (orderData ?? []).map((o) => ({
    id: o.id as string,
    so: o.so as number,
    sourceRef: ((o.source_ref as string[] | null) ?? []).map((r) => String(r)),
    lines: linesByOrder.get(o.id as string) ?? [],
  }));

  const candidates = detectMissingLines(rows, orders);

  const result: AppendMissingLinesResult = {
    candidates,
    appended: 0,
    orders: 0,
    dryRun,
  };
  if (dryRun || candidates.length === 0) return c.json({ result });

  // Group per order → one RPC call each (the RPC stamps history/audit once per
  // order, matching how the operator thinks about the action).
  const byOrder = new Map<string, MissingLineCandidate[]>();
  for (const cand of candidates) {
    (byOrder.get(cand.orderId) ?? byOrder.set(cand.orderId, []).get(cand.orderId)!).push(
      cand,
    );
  }
  for (const [orderId, cands] of byOrder) {
    const { data, error } = await sb.rpc("append_autocount_order_lines", {
      p_order_id: orderId,
      p_lines: cands.map((cand) => ({
        sku: cand.detail,
        qty: cand.qty,
        source_po: cand.po || null,
        attrs: cand.itemGroup ? { item_group: cand.itemGroup } : {},
      })),
    });
    if (error) return fail(c, error);
    result.appended += Number((data as { appended?: number } | null)?.appended ?? 0);
    result.orders += 1;
  }

  return c.json({ result });
});

/**
 * 0492 (Delivery MASTER §14.2, Card 15) — the loan OFFER and the customer's
 * answer, recorded on the Sales Order beside the loan itself. Orders owns the
 * record; Logistics never makes the commercial offer.
 *
 *   GET  /:id/loan-offers   the whole history, newest first
 *   POST /:id/loan-offers   one record through the governed door
 */
orderControlRouter.get("/:id/loan-offers", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);
  const idCheck = ORDER_ID.safeParse(c.req.param("id"));
  if (!idCheck.success) throw new HTTPException(404, { message: "Order not found" });
  const sb = userClient(c.env, auth.jwt);
  const { data, error } = await sb
    .from("ops_loan_offers")
    .select("id, seq, order_id, event, item_id, label, reason, recorded_by, recorded_at, ops_stock_items(unit_code, identity_scope)")
    .eq("order_id", idCheck.data)
    .order("seq", { ascending: false });
  if (error) return fail(c, error);
  const offers = (data ?? []).map((r) => {
    const row = r as Record<string, unknown> & {
      ops_stock_items?: { unit_code?: string | null; identity_scope?: string | null } | null;
    };
    const unit = Array.isArray(row.ops_stock_items) ? row.ops_stock_items[0] : row.ops_stock_items;
    return {
      id: row.id,
      seq: row.seq,
      order_id: row.order_id,
      event: row.event,
      item_id: row.item_id ?? null,
      label: row.label ?? null,
      reason: row.reason ?? null,
      recorded_by: row.recorded_by ?? null,
      recorded_at: row.recorded_at,
      unit_id: unitIdOf({ unitCode: unit?.unit_code ?? null, identityScope: unit?.identity_scope ?? null }),
    };
  });
  return c.json({ offers });
});

export default orderControlRouter;
