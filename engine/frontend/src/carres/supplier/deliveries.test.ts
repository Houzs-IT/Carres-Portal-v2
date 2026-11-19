import { describe, expect, it } from "vitest";
import { normalizeMe, PERMS, type DeliveryJob } from "./api";
import { roleLabel, tabsFor } from "./Shell";
import { deliveryBadge } from "./DeliveriesPage";

const meOf = (logistics: boolean) => normalizeMe({
  user: { id: 1, name: "A", email: "a@x.test", canOperation: true, canFinance: false, perms: { operation: [...PERMS.operation], finance: [] } },
  supplier: { name: "AL Transport", code: "405-A001", logistics }, badges: { pickupsToAccept: 0 },
});

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
    const base: DeliveryJob = {
      kind: "do", key: "x", soDocNo: "CR-SO-1", doNo: "CR-DO-1", customer: "TEST", address: "", phone: null, customerDate: null,
      plannedDate: null, exemptionDate: null, status: "CONFIRMED", lorry: null, driver: null, helpers: [], departedAt: null, arrivedAt: null,
      deliveredAt: null, proof: false, done: false, items: [],
    };
    expect(deliveryBadge({ ...base, kind: "so" }).label).toBe("Waiting for Delivery Order");
    expect(deliveryBadge(base).label).toBe("Planned");
    expect(deliveryBadge({ ...base, departedAt: "2026-11-19 09:00" }).label).toBe("On the way");
    expect(deliveryBadge({ ...base, departedAt: "2026-11-19 09:00", arrivedAt: "2026-11-19 10:00" }).label).toBe("Arrived");
    expect(deliveryBadge({ ...base, done: true }).label).toBe("Delivered");
  });
});
