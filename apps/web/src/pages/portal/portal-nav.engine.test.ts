import { describe, expect, it } from "vitest";
import { engineFor, retiredRedirect } from "./portal-nav";

describe("engineFor: an engine row's own address opens its engine page", () => {
  it("maps a row's own `/operation/sc/<row>` address to its engine page", () => {
    expect(engineFor("/operation/sc/orders", "")).toBe("/scm/sales-orders");
    expect(engineFor("/operation/sc/orders-shortcut", "")).toBe("/scm/sales-orders");
    expect(engineFor("/operation/sc/overview", "")).toBe("/");
    expect(engineFor("/operation/sc/product-request", "")).toBe("/scm/product-requests");
    expect(engineFor("/operation/sc/sales-invoices", "")).toBe("/scm/sales-invoices");
    expect(engineFor("/operation/sc/suppliers", "")).toBe("/scm/suppliers");
    expect(engineFor("/operation/sc/service-notes", "")).toBe("/assr?view=cases");
    expect(engineFor("/operation/sc/service-mine", "")).toBe("/my-cases");
    expect(engineFor("/operation/sc/suppliers/", "")).toBe("/scm/suppliers");
  });
  it("tells apart rows that share an engine page by their view", () => {
    expect(engineFor("/operation/sc/wh-warehouses", "")).toBe("/scm/warehouses");
    expect(engineFor("/operation/sc/wh-racks", "")).toBe("/scm/warehouses/racks");
    expect(engineFor("/operation/sc/service-quality", "")).toBe("/assr?view=metrics");
    expect(engineFor("/operation/sc/service-maintenance", "")).toBe("/assr?view=settings");
  });
  it("leaves record pages, old addresses and rows with no engine page alone", () => {
    expect(engineFor("/operation/orders/so/123", "")).toBeNull();
    expect(engineFor("/operation/sc/orders/123", "")).toBeNull();
    expect(engineFor("/operation/sc/supplier-items", "")).toBeNull();
    expect(engineFor("/operation", "?tab=suppliers")).toBeNull();
    expect(engineFor("/operation", "?tab=guarantees")).toBeNull();
    expect(engineFor("/operation", "")).toBeNull();
  });
  it("sends an old Carres address, record and search links included, to the engine row's address", () => {
    expect(engineFor("/operation/procurement", "?po=PO-1")).toBeNull();
    expect(retiredRedirect("/operation/procurement", "?po=PO-1")).toBe("/operation/sc/purchase-orders");
    expect(retiredRedirect("/operation/orders", "?search=SO-1")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation/orders/so/123", "")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation", "?tab=warehouses")).toBe("/operation/sc/wh-warehouses");
    expect(retiredRedirect("/operation", "?tab=guarantees")).toBe("/operation/sc/service-notes");
    expect(retiredRedirect("/operation", "")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation/orders-archive", "")).toBeNull();
    expect(retiredRedirect("/operation", "?tab=work")).toBeNull();
  });
});
