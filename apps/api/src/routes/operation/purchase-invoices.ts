import { Hono } from "hono";
import { requireOperationOrPrincipal } from "../../lib/auth-guards";
import { fail } from "../../lib/route-helpers";
import { adminClient, userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * /api/operation/purchase-invoices — the supplier bills, read-only, for
 * Purchasing (migration 0721).
 *
 * Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): purchasing staff see
 * purchase invoices inside the purchasing area, Houzs way. Jess's rule that no
 * finance fields appear in Operations is overturned; Jess was not part of this
 * decision. The bill itself stays Finance's record: this reads Finance's own
 * bills and paid figure and writes nothing. Purchasing ENTERS a bill through
 * Finance's own door, POST /api/finance/payables/bills (Chew, Finance, WhatsApp
 * 2026-10-23, via YH; 0721). Q8 (Chew 2026-10-26, Houzs way): that save posts
 * it. Cancelling and paying a bill remain
 * Finance's doors (finance + principal only in the database).
 */
const purchaseInvoicesRouter = new Hono<AppEnv>();

const BILL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoredBillLine = {
  line_no: number; warehouse_receipt_id: string | null; po_line_id: string | null; sku: string | null;
  description: string | null; qty: number | null; unit_price: number | null; amount: number | null;
};

/**
 * Goods lines that saving split by channel (0683) read as the one line that
 * was typed, the rule purchasing_supplier_bill_draft already has. A line with
 * no GRN stays its own line.
 */
export function billDetailLines(rows: StoredBillLine[], grnNo: Map<string, string | null>) {
  const out = new Map<string, StoredBillLine & { grn_no: string | null }>();
  for (const l of [...rows].sort((a, b) => a.line_no - b.line_no)) {
    const key = l.warehouse_receipt_id
      ? [l.warehouse_receipt_id, l.po_line_id, l.sku, l.description, l.unit_price].join("|")
      : `line-${l.line_no}`;
    const seen = out.get(key);
    if (!seen) {
      out.set(key, { ...l, grn_no: l.warehouse_receipt_id ? grnNo.get(l.warehouse_receipt_id) ?? null : null });
      continue;
    }
    seen.qty = Math.round((Number(seen.qty ?? 0) + Number(l.qty ?? 0)) * 10000) / 10000;
    seen.amount = Math.round((Number(seen.amount ?? 0) + Number(l.amount ?? 0)) * 100) / 100;
  }
  return [...out.values()];
}

purchaseInvoicesRouter.get("/", requireOperationOrPrincipal, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("purchasing_supplier_bill_list");
  if (error) return fail(c, error);
  return c.json({ rows: data ?? [] });
});

// One bill to read, Houzs PurchaseInvoiceDetailV2.tsx. The header is the caller's
// own row of the list above, so the list's database role check decides who gets
// past here. Supplier bill lines have RLS for finance and principal only and no
// function reads them for purchasing, so the lines use the service client, only
// after that check, with no account or department column.
purchaseInvoicesRouter.get("/:id/detail", requireOperationOrPrincipal, async (c) => {
  const id = c.req.param("id");
  if (!BILL_ID.test(id)) {
    return c.json({ error: "bad_request", code: "bad_id", message: "That is not a bill." }, 400);
  }
  const { data: bill, error } = await userClient(c.env, c.var.auth.jwt)
    .rpc("purchasing_supplier_bill_list").eq("id", id).maybeSingle();
  if (error) return fail(c, error);
  if (!bill) return c.json({ error: "not_found", code: "bill_missing", message: "That bill does not exist." }, 404);
  const admin = adminClient(c.env);
  const lines = await admin.from("supplier_bill_lines")
    .select("line_no, warehouse_receipt_id, po_line_id, sku, description, qty, unit_price, amount")
    .eq("bill_id", id);
  if (lines.error) return fail(c, lines.error);
  const rows = (lines.data ?? []) as StoredBillLine[];
  const receiptIds = [...new Set(rows.flatMap((l) => l.warehouse_receipt_id ?? []))];
  const grnNo = new Map<string, string | null>();
  if (receiptIds.length) {
    const receipts = await admin.from("warehouse_receipts").select("id, grn_no").in("id", receiptIds);
    if (receipts.error) return fail(c, receipts.error);
    for (const r of receipts.data ?? []) grnNo.set(r.id as string, r.grn_no as string | null);
  }
  // Line prices stay with the roles the table's RLS admits (gl_may_read, 0461); the list's totals are unchanged.
  const seesPrices = ["finance", "principal"].includes(c.var.auth.role);
  const out = billDetailLines(rows, grnNo);
  return c.json({ bill, lines: seesPrices ? out : out.map((l) => ({ ...l, unit_price: null, amount: null })) });
});

// 2026-10-26 (YH, Houzs): one draft bill for its form. Purchasing reads only
// its own draft (the database returns null otherwise).
purchaseInvoicesRouter.get("/:id", requireOperationOrPrincipal, async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "bad_request", code: "bad_id", message: "That is not a bill." }, 400);
  }
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("purchasing_supplier_bill_draft", { p_bill_id: id });
  if (error) return fail(c, error);
  if (!data) return c.json({ error: "not_found", code: "bill_missing", message: "That draft bill is not yours to change, or is no longer a draft." }, 404);
  return c.json(data);
});

export default purchaseInvoicesRouter;
