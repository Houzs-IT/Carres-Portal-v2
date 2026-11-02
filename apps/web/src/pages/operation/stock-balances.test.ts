import { describe, expect, it } from "vitest";
import type { StockRegisterUnit } from "@carres/shared";
import { ageWord, stockBalances } from "./stock-balances";

function unit(p: Partial<StockRegisterUnit>): StockRegisterUnit {
  return {
    id: "u", unitCode: "U", identityScope: "unit", sku: "CODY-K", category: "bedframe", productName: "Cody · King",
    warehouseId: "w1", siteName: "Carres Klang", holderPartyId: null, holderName: null, ownership: "carres_owned",
    supplier: null, poNo: null, status: "free", condition: "new", needsRepair: false, holdReason: null, reservedRef: null,
    soldOrderId: null, qty: 1, dateIn: null, goodsReceivedDate: null, lastVerifiedAt: null, availability: "available",
    lifecycleOutcome: "active", lastEventAt: null, lastEvent: null, ...p,
  };
}

describe("stockBalances", () => {
  const rows = stockBalances([
    unit({ goodsReceivedDate: "2026-10-05" }),
    unit({ siteName: "PJ Showroom", goodsReceivedDate: "2026-10-01" }),
    unit({ availability: "reserved", reservedRef: "SO-1", soldOrderId: "o1" }),
    unit({ availability: "not_available", condition: "damaged" }),
    unit({ ownership: "supplier_consignment" }),
    unit({ availability: "incoming", poNo: "PO-1", expectedArrival: "2026-11-20" }),
    unit({ availability: "incoming", poNo: "PO-1" }),
    unit({ availability: "ended", lifecycleOutcome: "delivered" }),
    unit({ sku: "PILLOW", productName: null, identityScope: "quantity", qty: 319 }),
    unit({ sku: "ONLY-COMING", availability: "incoming" }),
  ]);
  const cody = rows.find((r) => r.sku === "CODY-K")!;

  it("keeps own stock and consignment apart, and leaves incoming and ended goods out of both", () => {
    expect(cody).toMatchObject({ stock: 4, consignment: 1, incoming: 2, reserved: 1, available: 3, cannotSell: 1 });
  });

  it("ties what is held to its three statuses", () => {
    expect(cody.stock + cody.consignment).toBe(cody.reserved + cody.available + cody.cannotSell);
  });

  it("adds a counted row by its pieces, not as one record", () => {
    expect(rows.find((r) => r.sku === "PILLOW")).toMatchObject({ stock: 319, available: 319, description: "PILLOW" });
  });

  it("lists a product that has only incoming goods", () => {
    expect(rows.find((r) => r.sku === "ONLY-COMING")).toMatchObject({ stock: 0, incoming: 1 });
  });

  it("splits by Site, and each Site adds up to the product", () => {
    expect(cody.sites.map((s) => [s.siteName, s.stock])).toEqual([["Carres Klang", 3], ["PJ Showroom", 1]]);
  });

  it("names the PO and the SO behind the totals", () => {
    expect(cody.incomingPos).toEqual([{ poNo: "PO-1", expectedArrival: "2026-11-20", qty: 2 }]);
    expect(cody.reservedSos).toEqual([{ ref: "SO-1", orderId: "o1", qty: 1 }]);
  });

  it("dates its age from the oldest goods held", () => {
    expect(cody.oldestReceived).toBe("2026-10-01");
    expect(ageWord("2026-10-01", new Date("2026-10-11T12:00:00Z"))).toBe("10d");
    expect(ageWord("2026-10-11", new Date("2026-10-11T12:00:00Z"))).toBe("today");
    expect(ageWord(null, new Date())).toBe("");
  });
});
