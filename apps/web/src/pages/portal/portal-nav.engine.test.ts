import { describe, expect, it } from "vitest";
import { engineFor } from "./portal-nav";

describe("engineFor: the replaced rows' addresses open the engine page", () => {
  it("maps a row's own address, path or tab, to its engine page", () => {
    expect(engineFor("/operation/orders", "")).toBe("/scm/sales-orders");
    expect(engineFor("/operation", "?tab=suppliers")).toBe("/scm/suppliers");
    expect(engineFor("/operation", "?tab=service-notes")).toBe("/assr?view=cases");
    expect(engineFor("/operation", "?tab=service-notes&mine=1")).toBe("/my-cases");
  });
  it("tells apart rows that share a page by their view", () => {
    expect(engineFor("/operation", "?tab=warehouses")).toBe("/scm/warehouses");
    expect(engineFor("/operation", "?tab=warehouses&view=bins")).toBe("/scm/warehouses/racks");
  });
  it("leaves record pages and rows with no engine page alone", () => {
    expect(engineFor("/operation/orders/so/123", "")).toBeNull();
    expect(engineFor("/operation", "?tab=supplier-items")).toBeNull();
    expect(engineFor("/operation", "?tab=guarantees")).toBeNull();
    expect(engineFor("/operation", "")).toBeNull();
  });
});
