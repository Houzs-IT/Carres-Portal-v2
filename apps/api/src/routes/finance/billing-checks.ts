import { Hono } from "hono";
import { notYetBilled, type NotYetBilledOrder, type NotYetBilledRow } from "@carres/shared/not-yet-billed";
import { resolveActorNames } from "../../lib/actor-names";
import { requireFinance } from "../../lib/auth-guards";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * Finance · two read-only pages, mounted above the `/finance` catch-all:
 *   /api/finance/not-yet-billed   delivered orders against their live invoices
 *   /api/finance/corrections      allocation corrections (0450) and voids (0513)
 * No write route: each read is what the existing tables already say.
 */
export const financeNotYetBilledRouter = new Hono<AppEnv>();
export const financeCorrectionsRouter = new Hono<AppEnv>();

const PAGE = 1000;
const NOT_YET_BILLED_SELECT =
  "id,so,customer_name,customer_phone,delivered_at,salespersons(name),order_lines(id,qty,unit_price),order_addons(qty,unit_price)," +
  "invoices(kind,status,snapshot_from:snapshot->>issued_from,snapshot_lines:snapshot->lines)," +
  "ops_delivery_orders(do_number,voided_at)";

financeNotYetBilledRouter.get("/", requireFinance, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const rows: NotYetBilledRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("orders")
      .select(NOT_YET_BILLED_SELECT)
      .eq("operation_stage", "delivered")
      .neq("status", "cancelled")
      // An AutoCount import was billed in AutoCount (0738).
      .or("source_system.is.null,source_system.neq.autocount")
      .order("so", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) return c.json({ message: "Not Yet Billed could not be loaded. Try again." }, 500);
    for (const o of data as unknown as NotYetBilledOrder[]) {
      const row = notYetBilled(o);
      if (row) rows.push(row);
    }
    if (data.length < PAGE) return c.json({ rows });
  }
});

export interface CorrectionRow {
  id: string;
  kind: "allocation" | "void";
  at: string;
  by: string | null;
  order_id: string | null;
  so: number | null;
  customer_name: string | null;
  receipt_no: string | null;
  what: string;
  reason: string | null;
  recorded_by: string | null;
  recorded_on: string | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (n: unknown) =>
  `RM ${Number(n ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const IN_CHUNK = 100; // A long id list must not outgrow the request URL.
const chunks = <T,>(all: T[]) => {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += IN_CHUNK) out.push(all.slice(i, i + IN_CHUNK));
  return out;
};

type Allocation = { order_id: string; amount: number | string };

financeCorrectionsRouter.get("/", requireFinance, async (c) => {
  const month = c.req.query("month") ?? "";
  if (!MONTH.test(month)) return c.json({ message: "Choose a valid month." }, 422);
  const start = `${month}-01T00:00:00+08:00`;
  const end = `${nextMonth(month)}-01T00:00:00+08:00`;
  const failed = () => c.json({ message: "Corrections could not be loaded. Try again." }, 500);

  const sb = userClient(c.env, c.var.auth.jwt);
  const [moved, voided] = await Promise.all([
    sb.from("payment_allocation_corrections").select("id,payment_id,before,after,reason,corrected_by,corrected_at")
      .gte("corrected_at", start).lt("corrected_at", end).order("corrected_at", { ascending: false }),
    sb.from("ops_activity_log").select("id,order_id,actor_id,detail,occurred_at")
      .eq("action", "payment.voided")
      .gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: false }),
  ]);
  if (moved.error || voided.error) return failed();
  const moves = (moved.data ?? []) as Array<{ id: string; payment_id: string; before: Allocation[] | null; after: Allocation[] | null; reason: string; corrected_by: string | null; corrected_at: string }>;
  const voids = (voided.data ?? []) as Array<{ id: string; order_id: string | null; actor_id: string | null; occurred_at: string; detail: { amount?: unknown; payment_id?: string; reason?: string } | null }>;

  const paymentIds = [...new Set([...moves.map((m) => m.payment_id), ...voids.map((v) => v.detail?.payment_id).filter((id): id is string => !!id)])];
  const paymentReads = await Promise.all(chunks(paymentIds).map((ids) =>
    sb.from("order_payments").select("id,order_id,receipt_no,recorded_by,created_at").in("id", ids)));
  if (paymentReads.some((r) => r.error)) return failed();
  const payments = new Map(paymentReads.flatMap((r) => (r.data ?? []) as Array<{ id: string; order_id: string; receipt_no: string | null; recorded_by: string | null; created_at: string }>).map((p) => [p.id, p]));

  const orderIds = [...new Set([
    ...[...payments.values()].map((p) => p.order_id),
    ...voids.map((v) => v.order_id),
    ...moves.flatMap((m) => [...(m.before ?? []), ...(m.after ?? [])].map((a) => a.order_id)),
  ].filter((id): id is string => !!id))];
  const orderReads = await Promise.all(chunks(orderIds).map((ids) =>
    sb.from("orders").select("id,so,customer_name").in("id", ids)));
  if (orderReads.some((r) => r.error)) return failed();
  const orders = new Map(orderReads.flatMap((r) => (r.data ?? []) as Array<{ id: string; so: number; customer_name: string }>).map((o) => [o.id, o]));

  const names = await resolveActorNames(sb, [
    ...moves.map((m) => m.corrected_by), ...voids.map((v) => v.actor_id),
    ...[...payments.values()].map((p) => p.recorded_by),
  ]);
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? null : null);
  const allocationWords = (list: Allocation[] | null) =>
    (list ?? []).map((a) => `${orders.has(a.order_id) ? `SO-${orders.get(a.order_id)!.so}` : "Unknown order"} ${money(a.amount)}`).join(", ") || "Nothing";

  const rows: CorrectionRow[] = [
    ...moves.map((m): CorrectionRow => {
      const p = payments.get(m.payment_id);
      const o = p ? orders.get(p.order_id) : undefined;
      return {
        id: m.id, kind: "allocation", at: m.corrected_at, by: nameOf(m.corrected_by),
        order_id: p?.order_id ?? null, so: o?.so ?? null, customer_name: o?.customer_name ?? null,
        receipt_no: p?.receipt_no ?? null,
        what: `Allocation changed: ${allocationWords(m.before)} → ${allocationWords(m.after)}`,
        reason: m.reason, recorded_by: nameOf(p?.recorded_by), recorded_on: p?.created_at ?? null,
      };
    }),
    ...voids.map((v): CorrectionRow => {
      const p = v.detail?.payment_id ? payments.get(v.detail.payment_id) : undefined;
      const o = v.order_id ? orders.get(v.order_id) : undefined;
      return {
        id: v.id, kind: "void", at: v.occurred_at, by: nameOf(v.actor_id),
        order_id: v.order_id, so: o?.so ?? null, customer_name: o?.customer_name ?? null,
        receipt_no: p?.receipt_no ?? null,
        what: `Payment voided: ${money(v.detail?.amount)}`,
        reason: v.detail?.reason ?? null, recorded_by: nameOf(p?.recorded_by), recorded_on: p?.created_at ?? null,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return c.json({ rows });
});
