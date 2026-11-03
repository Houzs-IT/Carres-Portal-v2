/**
 * 0746 — a Service Case's pickup leg and delivery-back leg. Follows Houzs
 * backend/src/scm/shared/assr-pickup-tracking.ts (status, item location, PIC
 * length) and frontend/src/components/assr/LogisticsConfirmedNote.tsx (the date
 * Service keys is a request; Logistics confirms it), per Weisiang's ruling
 * (2026-10-22): clear Carres rules, implement Houzs.
 */
export const CASE_LEG_BY_KEYS = ["own", "supplier"] as const;
export const CASE_PICKUP_STATUS_KEYS = ["pending", "scheduled", "completed"] as const;
export const CASE_ITEM_LOCATION_KEYS = ["customer", "warehouse", "supplier"] as const;
export const CASE_PICKUP_PIC_MAX = 120;

const LABELS: Record<string, string> = {
  own: "Own team", supplier: "Supplier",
  pending: "Pending", scheduled: "Scheduled", completed: "Completed",
  customer: "Customer", warehouse: "Warehouse",
};
export const caseLegLabel = (key: string): string => LABELS[key] ?? key;

/** The line under a leg's requested date. `fmt` is the caller's date formatter. */
export function logisticsConfirmedText(
  requested: string | null | undefined,
  confirmed: string | null | undefined,
  fmt: (iso: string) => string,
): string {
  if (confirmed) return `Logistics confirmed ${fmt(confirmed)}.`;
  return requested
    ? "Waiting for Logistics to confirm this date."
    : "Set the date you want; Logistics confirms it.";
}

/** Houzs PickupTrackingFields.tsx:31-58: Pickup PIC options are the case's supplier first, then
 *  the active drivers. A PIC typed before the dropdown stays selectable. */
export function casePickupPicOptions(drivers: string[], supplier: string | null, current: string | null): { value: string; label: string }[] {
  const choices = [...new Set([...(supplier ? [supplier] : []), ...drivers])];
  if (current && !choices.includes(current)) choices.unshift(current);
  return choices.map((v) => ({ value: v, label: v === supplier ? `${v} (Supplier)` : v }));
}

/** Houzs backend/src/scm/lib/assr-arrangement-message.ts:41-46 (ASSR_LEG_CUSTOMER_LABEL). */
export const CASE_LEG_CUSTOMER_LABEL = { pickup: "furniture pickup", delivery: "return delivery" } as const;

/** Houzs assr-arrangement-message.ts:1-19, 131-133: one Service Arrangement message per leg, the
 *  confirmed date first, else the requested one; null when the leg has no date. The customer's
 *  answer is a request; it never moves the date. shortcut: Houzs sends the approved WhatsApp
 *  template hc_service_arrangement through its Connect gateway, which Carres lacks; staff copy
 *  this text or open WhatsApp instead. Swap for a real send once a gateway exists. */
export function caseArrangementMessage(
  c: { caseNo: string; customerName: string },
  leg: keyof typeof CASE_LEG_CUSTOMER_LABEL,
  date: string | null | undefined,
  fmt: (iso: string) => string,
): string | null {
  if (!date) return null;
  return `Hi ${c.customerName}, this is Carres about your service case ${c.caseNo}. `
    + `We have arranged the ${CASE_LEG_CUSTOMER_LABEL[leg]} on ${fmt(date)}. `
    + "Please reply to confirm this date, or tell us another date that suits you.";
}
