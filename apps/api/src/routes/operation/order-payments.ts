import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { recordPaymentInputSchema, refundDecideInputSchema, refundMarkPaidInputSchema, docNumber } from "@carres/shared";
import { parseJsonBody, fail } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * Order payment LEDGER (balance job — Jess 2026-06-26 "complete all the balance
 * job"; migration 0184). The multi-entry replacement for the single
 * ops_order_control.paid_amount stopgap: one `order_payments` row per payment
 * received (goods, deposit, OR a storage-fee collection).
 *
 *   GET    /api/operation/orders/:id/payments       — list the ledger (newest first)
 *   POST   /api/operation/orders/:id/payments       — record one payment
 *   DELETE /api/operation/orders/:id/payments/:pid  — void a wrong entry (principal only)
 *
 * Storage collection + waiver + the delivery gate live in the SAME router
 * (storage collection is just a `kind:'storage'` payment) — see the storage
 * section below. Plain-table CRUD via PostgREST; RLS (migration 0184: internal
 * read, operation/principal write) is the security boundary, the inline role
 * guards are defence-in-depth + clean 403 messages.
 *
 * Mounted at `/operation/orders` in apps/api/src/index.ts (sibling of
 * orderControlRouter), so the paths above are absolute.
 */
const orderPaymentsRouter = new Hono<AppEnv>();

const ORDER_ID = z.string().uuid();
const PAYMENT_ID = z.string().uuid();

function requireOperationOrPrincipal(
  role: string,
): asserts role is "operation" | "principal" {
  if (role !== "operation" && role !== "principal") {
    throw new HTTPException(403, { message: "Operation or principal only" });
  }
}

// POST /:id/payments — record one payment through the ONE writer (CARD 4,
// 0343): the ledger row and the `orders.paid` bump are one transaction, so the
// figure every gate reads moves the moment the desk records the money. The
// receipt number is the LOCKED document scheme (RC-DDMMYY-NNNN, seeded so a
// reprint matches), minted by the one TS helper and handed to the RPC.
orderPaymentsRouter.post("/:id/payments", async (c) => {
  const auth = c.var.auth;
  // Finance records a payment too, an old one with no request. Follows Houzs
  // backend/src/services/backdateRequestNotify.ts:5-8 per Weisiang's ruling
  // (2026-10-22): clear Carres rules, implement Houzs (YH 2026-10-26, Q14).
  // payment_record (0707 part 2a) is the boundary; this only lets finance reach it.
  if (auth.role !== "finance") requireOperationOrPrincipal(auth.role);

  const idCheck = ORDER_ID.safeParse(c.req.param("id"));
  if (!idCheck.success) throw new HTTPException(404, { message: "Order not found" });
  const orderId = idCheck.data;

  const parsed = await parseJsonBody(c, recordPaymentInputSchema);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);

  const sb = userClient(c.env, auth.jwt);
  const { data, error } = await recordPayment(sb, orderId, {
    amount: parsed.data.amount,
    paidOn: parsed.data.paidOn,
    method: parsed.data.method,
    kind: parsed.data.kind,
    reference: parsed.data.reference,
    note: parsed.data.note,
    receiptUrl: parsed.data.receiptUrl,
    idempotencyKey: parsed.data.idempotencyKey,
    duplicateAck: parsed.data.duplicateAck,
  });
  if (error) return fail(c, error);
  if (isWaiting(data)) return c.json({ pendingApproval: true, request: data.request }, 202);
  const out = data as { payment: unknown; orders_paid: number | null };
  return c.json({ payment: out.payment, ordersPaid: out.orders_paid }, 201);
});

/* 0707 — a paid date more than 14 days back is not recorded: payment_record
   answers a waiting request for the Payment Approver instead. Nothing in it
   counts until the approver decides. */
function isWaiting(data: unknown): data is { pending_approval: true; request: unknown } {
  return (data as { pending_approval?: unknown } | null)?.pending_approval === true;
}

const REQUEST_ID = z.string().uuid();
const decideBackdateInput = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
  duplicateAck: z.boolean().optional(),
});

// GET /:id/payment-backdate — the order's backdated payment requests, newest first.
orderPaymentsRouter.get("/:id/payment-backdate", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);
  const idCheck = ORDER_ID.safeParse(c.req.param("id"));
  if (!idCheck.success) throw new HTTPException(404, { message: "Order not found" });
  const { data, error } = await userClient(c.env, auth.jwt)
    .from("payment_backdate_requests")
    .select("id, order_id, amount, paid_on, method, kind, reference, receipt_url, status, requested_by, requested_at, decided_by, decided_at, decision_reason, payment_id")
    .eq("order_id", idCheck.data)
    .order("requested_at", { ascending: false });
  if (error) return fail(c, error);
  return c.json({ requests: data ?? [] });
});

// POST /:id/payment-backdate/:rid/decide — the SQL door decides who may
// (Payment Approver duty or principal, never the requester).
orderPaymentsRouter.post("/:id/payment-backdate/:rid/decide", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);
  const ridCheck = REQUEST_ID.safeParse(c.req.param("rid"));
  if (!ridCheck.success) throw new HTTPException(404, { message: "Request not found" });
  const parsed = await parseJsonBody(c, decideBackdateInput);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);
  const { data, error } = await userClient(c.env, auth.jwt).rpc("payment_backdate_decide", {
    p_request_id: ridCheck.data,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
    p_duplicate_ack: parsed.data.duplicateAck ?? false,
  });
  if (error) return fail(c, error);
  return c.json(data);
});

// DELETE /:id/payments/:pid — VOID a mis-keyed entry. 0430: the reason is
// REQUIRED and the authority is the Payment Approver duty (Shared Duty
// Resolver) or principal — the SQL door decides; this route only shapes the
// request. CARD 4 (0343): a void is a STAMP, never a delete — the row
// survives with voided_at/by, and the RPC reverses exactly the orders.paid
// contribution the record made. The wire contract ({ok:true}) is unchanged.
const voidPaymentInput = z.object({
  reason: z.string().trim().min(1, "A reason is required to void a payment.").max(500),
});
orderPaymentsRouter.delete("/:id/payments/:pid", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);

  const idCheck = ORDER_ID.safeParse(c.req.param("id"));
  const pidCheck = PAYMENT_ID.safeParse(c.req.param("pid"));
  if (!idCheck.success || !pidCheck.success) {
    throw new HTTPException(404, { message: "Payment not found" });
  }
  const parsed = await parseJsonBody(c, voidPaymentInput);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);

  const sb = userClient(c.env, auth.jwt);
  const { error } = await sb.rpc("payment_void", {
    p_payment_id: pidCheck.data,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

// ── Refunds (SO V2 CARD 7, 0345) — bilateral money's second direction ────────
// requested → approved | rejected (PRINCIPAL only, the waiver-decide law) →
// paid. An approved, unpaid refund means Carres still owes the customer; the
// payout never touches orders.paid (money IN against goods) — it is its own
// record, and Card 8's derived completion reads it.

const REFUND_ID = z.string().uuid();

// POST /:id/refunds/:rid/decide — THE PRINCIPAL ONLY.
orderPaymentsRouter.post("/:id/refunds/:rid/decide", async (c) => {
  const auth = c.var.auth;
  if (auth.role !== "principal") {
    throw new HTTPException(403, { message: "Only a manager can decide a refund" });
  }
  const ridCheck = REFUND_ID.safeParse(c.req.param("rid"));
  if (!ridCheck.success) throw new HTTPException(404, { message: "Refund not found" });

  const parsed = await parseJsonBody(c, refundDecideInputSchema);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);

  const sb = userClient(c.env, auth.jwt);
  const { data, error } = await sb.rpc("refund_decide", {
    p_refund_id: ridCheck.data,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note ?? null,
  });
  if (error) return fail(c, error);
  return c.json({ refund: data });
});

// POST /:id/refunds/:rid/paid — record the payout (approved → paid).
orderPaymentsRouter.post("/:id/refunds/:rid/paid", async (c) => {
  const auth = c.var.auth;
  requireOperationOrPrincipal(auth.role);
  const ridCheck = REFUND_ID.safeParse(c.req.param("rid"));
  if (!ridCheck.success) throw new HTTPException(404, { message: "Refund not found" });

  const parsed = await parseJsonBody(c, refundMarkPaidInputSchema);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);

  const sb = userClient(c.env, auth.jwt);
  const { data, error } = await sb.rpc("refund_mark_paid", {
    p_refund_id: ridCheck.data,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference ?? null,
  });
  if (error) return fail(c, error);
  return c.json({ refund: data });
});

/** The next receipt number, on the LOCKED document scheme (Jess 2026-07-19:
 *  `PREFIX-DDMMYY-NNNN`, tail hashed from a stable seed — `docNumber`, the ONE
 *  helper). Seeded on `{orderId}:{seq}` so each payment of one order gets its
 *  own stable number and a reprint matches the original. `seq` counts EVERY
 *  ledger row including voided ones, so a number is never reused. The payment
 *  MASTER has required this scheme all along; the ledger held zero rows when
 *  the old `R{so}-{n}` spelling was retired (CARD 4, 2026-08-11). */
async function nextReceiptNo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  orderId: string,
  paidOnIso: string,
  bump = 0,
): Promise<string> {
  const { count } = await sb
    .from("order_payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  const seq = (typeof count === "number" ? count : 0) + 1 + bump;
  return docNumber({
    prefix: "RC",
    date: paidOnIso,
    seed: `${orderId}:${seq}`,
    digits: 4,
  });
}

/**
 * Record one payment through the ONE writer, minting its receipt number and
 * RETRYING if that number is already taken (0347).
 *
 * `nextReceiptNo` seeds on `count + 1`, so two payments recorded into one order
 * in the same instant read the same count and mint the SAME number. Nothing
 * stopped that being stored until 0347's unique index — and an index without a
 * retry just converts a silent duplicate into a 500 at the till. The retry
 * bumps the sequence and asks again; three attempts is far past any real
 * collision on a desk where one operator records one payment at a time.
 */
async function recordPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  orderId: string,
  args: {
    amount: number;
    paidOn: string;
    method: string;
    kind: "payment" | "deposit" | "storage";
    reference?: string | null;
    note?: string | null;
    receiptUrl?: string | null;
    idempotencyKey?: string;
    duplicateAck?: boolean;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: any }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let last: { data: any; error: any } = { data: null, error: null };
  // 0707: a caller with no key gets one per request, never the receipt number.
  // The receipt seeds on the order's payment count, which a waiting backdated
  // request does not raise, so a second backdated payment on the same paid
  // date would mint the same number and land on the first request.
  const key = args.idempotencyKey ?? crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const receiptNo = await nextReceiptNo(sb, orderId, args.paidOn, attempt);
    last = await sb.rpc("payment_record", {
      p_order_id: orderId,
      p_amount: args.amount,
      p_paid_on: args.paidOn,
      p_method: args.method,
      p_kind: args.kind,
      p_reference: args.reference ?? null,
      p_note: args.note ?? null,
      p_receipt_url: args.receiptUrl ?? null,
      p_receipt_no: receiptNo,
      p_counts_toward_paid: true,
      p_idempotency_key: key,
      p_duplicate_ack: args.duplicateAck ?? false,
    });
    // 23505 = the receipt number is taken. Anything else is the caller's answer.
    if (!last.error || last.error.code !== "23505") return last;
  }
  return last;
}

export default orderPaymentsRouter;
