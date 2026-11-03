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

export type CaseBoardCase = {
  pickup_by: string | null; pickup_requested_at: string | null; pickup_confirmed_at: string | null; actual_pickup_at: string | null;
  delivery_by: string | null; delivery_requested_at: string | null; delivery_confirmed_at: string | null;
};
export type CaseBoardLeg = { leg: "pickup" | "delivery"; requested: string | null; confirmed: string | null };

/** Houzs backend/src/scm/lib/assr-board-scope.ts:115-134 (assrBoardLegs): the open legs a case puts
 *  on Delivery Planning. Own-team legs only; a blank choice counts as own once a date is keyed.
 *  The case's date is the request, the board's date is the confirmed one. A picked-up pickup and
 *  every leg of a closed case are done and leave the board (Carres has no Delivered tab). */
export function caseBoardLegs(c: CaseBoardCase, caseClosed: boolean): CaseBoardLeg[] {
  if (caseClosed) return [];
  const legs: CaseBoardLeg[] = [];
  const pickupDated = Boolean(c.pickup_requested_at || c.pickup_confirmed_at);
  if ((c.pickup_by === "own" || (c.pickup_by == null && pickupDated)) && pickupDated && !c.actual_pickup_at) {
    legs.push({ leg: "pickup", requested: c.pickup_requested_at, confirmed: c.pickup_confirmed_at });
  }
  const deliveryDated = Boolean(c.delivery_requested_at || c.delivery_confirmed_at);
  if ((c.delivery_by === "own" || (c.delivery_by == null && deliveryDated)) && deliveryDated) {
    legs.push({ leg: "delivery", requested: c.delivery_requested_at, confirmed: c.delivery_confirmed_at });
  }
  return legs;
}
