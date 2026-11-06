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
