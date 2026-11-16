/**
 * A supplier's ask waiting for Carres's answer, as the portal's Alerts bell lists it (owner, 17 Nov 2026).
 *
 * On the Supplier Platform (ERP-ARCHITECTURE §6.6) a supplier may only ASK for a new pickup day or a cancel; nothing
 * changes until Carres approves it in Supplier Pickups. The ask lives in the engine; the portal's server reads the
 * waiting ones over a signed call (apps/api/src/routes/operation/scm-engine.ts → engine
 * src/carres/supplier/portal-asks.ts), and the bell shows them. The bell keeps no copy: an answered ask is gone from
 * the next reading.
 */
export interface SupplierAsk {
  /** The pickup request's id in the engine: the bell opens Supplier Pickups on it. */
  id: string;
  requestNo: string;
  supplierName: string;
  kind: "date" | "cancel";
  /** The day the supplier asks for (a move only), YYYY-MM-DD. */
  askDate: string | null;
  /** The day the pickup is on now, YYYY-MM-DD. */
  expectedDate: string;
  askedAt: string;
}

export interface SupplierAsksResponse {
  /** Every ask waiting, which may be more than the oldest ones listed. */
  count: number;
  asks: SupplierAsk[];
}
