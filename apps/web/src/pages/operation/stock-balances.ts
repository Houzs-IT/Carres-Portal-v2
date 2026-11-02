import { inventoryStatusOf, isCurrentUnit, isHeldUnit, type StockRegisterUnit } from "@carres/shared";

/** The quantities one product has, or one product has at one Site. */
export type BalanceQty = {
  stock: number;
  consignment: number;
  incoming: number;
  reserved: number;
  available: number;
  cannotSell: number;
};

export type StockBalance = BalanceQty & {
  sku: string;
  description: string;
  category: string | null;
  /** The oldest Goods Received Date among the goods held; null when none is known. */
  oldestReceived: string | null;
  sites: (BalanceQty & { siteName: string })[];
  incomingPos: { poNo: string; expectedArrival: string | null; qty: number }[];
  reservedSos: { ref: string; orderId: string | null; qty: number }[];
};

const emptyQty = (): BalanceQty => ({ stock: 0, consignment: 0, incoming: 0, reserved: 0, available: 0, cannotSell: 0 });

function addUnit(q: BalanceQty, u: StockRegisterUnit) {
  if (u.availability === "incoming") {
    q.incoming += u.qty;
    return;
  }
  if (u.ownership === "supplier_consignment") q.consignment += u.qty;
  else q.stock += u.qty;
  // The same words the Unit list prints, so a total always ties to its Units.
  const word = inventoryStatusOf(u);
  if (word === "Reserved") q.reserved += u.qty;
  else if (word === "Available") q.available += u.qty;
  else if (word === "Cannot sell") q.cannotSell += u.qty;
}

/** One row per product, read only from the Unit register (Houzs Inventory.tsx Balances tab). */
export function stockBalances(units: readonly StockRegisterUnit[]): StockBalance[] {
  const bySku = new Map<string, StockBalance>();
  for (const u of units) {
    if (!isCurrentUnit(u)) continue;
    let row = bySku.get(u.sku);
    if (!row) {
      row = { ...emptyQty(), sku: u.sku, description: u.productName ?? u.sku, category: u.category ?? null, oldestReceived: null, sites: [], incomingPos: [], reservedSos: [] };
      bySku.set(u.sku, row);
    }
    addUnit(row, u);

    const siteName = u.siteName ?? "Not recorded";
    let site = row.sites.find((s) => s.siteName === siteName);
    if (!site) row.sites.push((site = { ...emptyQty(), siteName }));
    addUnit(site, u);

    if (isHeldUnit(u) && u.goodsReceivedDate && (!row.oldestReceived || u.goodsReceivedDate < row.oldestReceived)) {
      row.oldestReceived = u.goodsReceivedDate;
    }
    if (u.availability === "incoming") {
      const poNo = u.poNo ?? "Not recorded";
      const po = row.incomingPos.find((p) => p.poNo === poNo);
      if (po) po.qty += u.qty;
      else row.incomingPos.push({ poNo, expectedArrival: u.expectedArrival ?? null, qty: u.qty });
    } else if (inventoryStatusOf(u) === "Reserved") {
      const ref = u.reservedRef ?? "No SO";
      const so = row.reservedSos.find((s) => s.ref === ref);
      if (so) so.qty += u.qty;
      else row.reservedSos.push({ ref, orderId: u.soldOrderId ?? null, qty: u.qty });
    }
  }
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Days since the goods came in, as Houzs prints its Age column. */
export function ageWord(received: string | null, now: Date): string {
  if (!received) return "";
  const days = Math.floor((now.getTime() - new Date(received).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "";
  return days === 0 ? "today" : `${days}d`;
}
