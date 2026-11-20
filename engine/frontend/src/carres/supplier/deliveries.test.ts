import { describe, expect, it } from "vitest";
import { normalizeMe, PERMS, type DeliveryJob } from "./api";
import { roleLabel, tabsFor } from "./Shell";
import { deliveryBadge, stockBadge } from "./DeliveriesPage";

const meOf = (logistics: boolean) => normalizeMe({
  user: { id: 1, name: "A", email: "a@x.test", canOperation: true, canFinance: false, perms: { operation: [...PERMS.operation], finance: [] } },
  supplier: { name: "AL Transport", code: "405-A001", logistics }, badges: { pickupsToAccept: 0 },
});

const base: DeliveryJob = {
  kind: "do", key: "x", soDocNo: "CR-SO-1", doNo: "CR-DO-1", customer: "TEST", address: "", phone: null, customerDate: null,
  plannedDate: null, exemptionDate: null, balanceSen: null, status: "CONFIRMED", lorry: null, driver: null, helpers: [], departedAt: null, arrivedAt: null,
  deliveredAt: null, proof: false, done: false, items: [],
};

describe("a 3PL company on the Supplier Platform (owner, 19 Nov 2026)", () => {
  it("sees only its Deliveries: never Sales Orders, Forecast or Pickup Requests", () => {
    expect(tabsFor(meOf(true)).map((t) => t.label)).toEqual(["Deliveries"]);
  });

  it("a 3PL's people read their department as Logistics, never Warehouse and Operation", () => {
    expect(roleLabel("operation", true)).toBe("Logistics");
    expect(roleLabel("operation", false)).toBe("Warehouse and Operation");
    expect(roleLabel("finance", true)).toBe("Finance");
  });

  it("a supplier that is not a 3PL never sees a Deliveries tab", () => {
    expect(tabsFor(meOf(false)).map((t) => t.label)).not.toContain("Deliveries");
  });

  it("an older server that does not say `logistics` reads as not a 3PL", () => {
    const me = normalizeMe({ user: { id: 1, name: "A", email: "a@x.test", canOperation: true, canFinance: false } });
    expect(me.supplier.logistics).toBe(false);
  });

  it("Last Mile reads the driver's steps in order", () => {
    expect(deliveryBadge({ ...base, kind: "so" }).label).toBe("Waiting for Delivery Order");
    expect(deliveryBadge(base).label).toBe("Planned");
    expect(deliveryBadge({ ...base, departedAt: "2026-11-19 09:00" }).label).toBe("On the way");
    expect(deliveryBadge({ ...base, departedAt: "2026-11-19 09:00", arrivedAt: "2026-11-19 10:00" }).label).toBe("Arrived");
    expect(deliveryBadge({ ...base, done: true }).label).toBe("Delivered");
  });

  it("Stock says whether the job can go out, and when the goods are due (owner, 20 Nov 2026)", () => {
    const item = (stock: "READY" | "PARTIAL" | "PENDING", poEta: string | null = null) => ({
      code: "X", description: "X", description2: null, qty: 1, uom: "UNIT", category: "mattress", variant: null, stock, poEta, poNos: null });
    const job = (items: ReturnType<typeof item>[]) => ({ ...base, items });
    expect(stockBadge(job([item("READY"), item("READY")])).label).toBe("Ready to deliver");
    expect(stockBadge(job([item("READY"), item("PENDING", "2026-11-25"), item("PARTIAL", "2026-11-28")])).label).toBe("Goods due 2026/11/28");
    expect(stockBadge(job([item("PENDING")])).label).toBe("Not in stock yet");
    expect(stockBadge(job([])).label).toBe("No goods listed");
  });
});
