/**
 * Finance → Not Yet Billed: delivered orders against their live Sales Invoices.
 * Follows Houzs backend/src/scm/routes/unbilled-deliveries.ts, at ORDER level:
 * Carres has no per-DO-line link to an invoice (0712 keeps an office invoice's
 * lines in its issue snapshot, keyed by order line).
 *
 * Read only. An issued system invoice bills the whole order (0738). An issued
 * office invoice bills its own snapshot lines, and the order's add-ons ride on
 * its first office invoice (0712). A draft or voided invoice bills nothing.
 */
export interface NotYetBilledOrder {
  id: string;
  so: number;
  customer_name: string;
  customer_phone?: string | null;
  delivered_at: string | null;
  salespersons?: { name: string | null } | null;
  order_lines: Array<{ id: string; qty: number | string; unit_price: number | string | null }>;
  order_addons: Array<{ qty: number | string; unit_price: number | string | null }>;
  invoices: Array<{
    kind: string;
    status: string;
    snapshot_from?: string | null;
    snapshot_lines?: Array<{ order_line_id?: string; qty: number | string }> | null;
  }>;
  ops_delivery_orders: Array<{ do_number: string | null; voided_at: string | null }>;
}

export interface NotYetBilledRow {
  order_id: string;
  so: number;
  customer_name: string;
  customer_phone: string | null;
  salesperson: string | null;
  do_numbers: string[];
  delivered_at: string | null;
  delivered_value: number;
  already_billed: number;
  not_billed: number;
}

const sen = (qty: number | string, price: number | string | null) =>
  Math.round(Number(qty) * Number(price ?? 0) * 100);

/** The order's row, or null when nothing is left to bill. */
export function notYetBilled(order: NotYetBilledOrder): NotYetBilledRow | null {
  const issued = order.invoices.filter((i) => i.kind === "sales" && i.status === "issued");
  if (issued.some((i) => i.snapshot_from !== "office")) return null;

  const billedQty = new Map<string, number>();
  for (const i of issued) {
    for (const l of i.snapshot_lines ?? []) {
      if (l.order_line_id) billedQty.set(l.order_line_id, (billedQty.get(l.order_line_id) ?? 0) + Number(l.qty));
    }
  }
  const addonsSen = order.order_addons.reduce((s, a) => s + sen(a.qty, a.unit_price), 0);
  const valueSen = order.order_lines.reduce((s, l) => s + sen(l.qty, l.unit_price), 0) + addonsSen;
  const notBilledSen = order.order_lines.reduce((s, l) => {
    const left = Math.max(0, Number(l.qty) - (billedQty.get(l.id) ?? 0));
    return s + sen(left, l.unit_price);
  }, issued.length > 0 ? 0 : addonsSen);
  if (notBilledSen <= 0) return null;

  return {
    order_id: order.id,
    so: order.so,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone ?? null,
    salesperson: order.salespersons?.name ?? null,
    do_numbers: order.ops_delivery_orders
      .filter((d) => !d.voided_at && d.do_number)
      .map((d) => d.do_number as string),
    delivered_at: order.delivered_at,
    delivered_value: valueSen / 100,
    already_billed: (valueSen - notBilledSen) / 100,
    not_billed: notBilledSen / 100,
  };
}
