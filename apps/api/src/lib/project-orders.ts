import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectSalesOrder } from "@carres/shared/projects";
import { orderMoney } from "@carres/shared/order-money";

/* ── Sales Orders at a project (0753, Houzs SO project_id) ──
 * Money comes from the shared orderMoney, which reads orders.paid; order_payments is
 * not summed because the raw-create door writes a deposit into both (order-money.ts:22-28). */
type Row = Record<string, unknown>;
type MoneyLine = { qty: number; unit_price: number | null };
const sumLines = (ls: MoneyLine[] | null | undefined) => (ls ?? []).reduce((s, l) => s + Number(l.qty) * Number(l.unit_price ?? 0), 0);

export async function readProjectOrders(sb: SupabaseClient, projectId: string) {
  const { data, error } = await sb
    .from("orders")
    .select("id, so, status, customer_name, placed_at, paid, credited, order_lines(qty, unit_price), order_addons(qty, unit_price), ops_order_control(balance)")
    .eq("project_id", projectId)
    .order("placed_at", { ascending: false });
  if (error) return { error, orders: [] as ProjectSalesOrder[] };
  const orders: ProjectSalesOrder[] = ((data ?? []) as Row[]).map((o) => {
    const ctrl = (Array.isArray(o.ops_order_control) ? o.ops_order_control[0] : o.ops_order_control) as { balance?: number | null } | null;
    const m = orderMoney({
      lineSum: sumLines(o.order_lines as MoneyLine[]), addonSum: sumLines(o.order_addons as MoneyLine[]),
      paid: o.paid as number | null, credited: o.credited as number | null, controlBalance: ctrl?.balance ?? null,
    });
    return {
      id: String(o.id), so: String(o.so ?? ""), status: String(o.status), customerName: (o.customer_name as string | null) ?? null,
      placedAt: (o.placed_at as string | null) ?? null, total: m.total, paid: m.paid, balance: m.goodsOwing,
    };
  });
  return { error: null, orders };
}
