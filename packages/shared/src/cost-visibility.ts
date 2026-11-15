import type { CatalogResponse } from "./schemas/catalog";

/* WHO SEES WHAT CARRES PAYS, AND WHO CARRES BUYS FROM (owner, 16 Nov 2026).
 *
 * Three roles: principal, operation, finance. The same three the database's `sees_cost()` names (0780).
 *
 * Nobody who sells does. A store login (dealer, salesperson, showroom) never receives a cost, a supplier, or the
 * supplier's own item code, and neither does bd: it is one of Carres's own roles, but its work is selling and
 * looking after the stores (owner, the same day: "Bd also don't need to view"). A role added later sees none of
 * them until it is named here, so forgetting to decide means "no".
 *
 * Two places enforce it and both follow this rule:
 *   - the API removes these fields from what it sends (below);
 *   - the database answers a role that does not see cost on the product tables only through the API, and on the
 *     buying side (suppliers, purchase orders, receiving, supplier claims, stock units) not at all
 *     (migrations 0778 to 0780), because row-level security chooses rows, never columns.
 */
export const COST_ROLES = ["principal", "operation", "finance"] as const;

export function seesCost(role: string): boolean {
  return (COST_ROLES as readonly string[]).includes(role);
}

/** A rental agreement as a role that does not see cost receives it: without the share of the rent that goes to
 *  the supplier. What the store itself earns on it (`commissionBasePct`) stays. */
export function rentalAgreementWithoutSupplierShare<T extends { supplierRatePct: number }>(
  agreement: T,
): Omit<T, "supplierRatePct"> {
  const copy: Omit<T, "supplierRatePct"> & { supplierRatePct?: number } = { ...agreement };
  delete copy.supplierRatePct;
  return copy;
}

/** The catalogue as a role that does not see cost receives it: every price it sells at, no cost, no supplier.
 *  The fields stay in the shape (as null) so one reader serves every role. */
export function catalogWithoutCost(catalog: CatalogResponse): CatalogResponse {
  return {
    ...catalog,
    skus: catalog.skus.map((sku) => ({ ...sku, cost: null, supplierId: null, supplierCode: null })),
    sofaCombos: catalog.sofaCombos?.map((combo) => ({ ...combo, costByHeight: null })),
    specialAddons: catalog.specialAddons?.map((addon) => ({ ...addon, cost: null })),
    // `stock` holds what Carres pays for a fabric and how much it holds; it is already left out for every role
    // but operation and principal, and is named here so this function alone is enough.
    fabrics: catalog.fabrics?.map((fabric) => ({ ...fabric, cost: null, supplierCode: null, stock: undefined })),
  };
}
