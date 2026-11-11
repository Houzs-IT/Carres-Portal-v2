import { describe, expect, it } from "vitest";
import { engineAddressFor, engineFor, engineRowFor } from "./portal-nav";

/* The frame tells the portal where it moved; the portal lights that page's row and keeps the page in `?at=`. */
describe("the menu follows a move inside the engine frame", () => {
  it.each([
    ["/scm/purchase-orders", "purchase-orders"],
    ["/scm/purchase-orders/123", "purchase-orders"],
    ["/scm/delivery-orders/DO-1", "delivery-orders"],
    ["/scm/warehouses/racks", "wh-racks"],
    ["/scm/warehouses", "wh-warehouses"],
    ["/assr?view=cases&id=9", "service-notes"],
    ["/projects?view=calendar", "project-calendar"],
    ["/scm/product-requests", "product-requests"],
    ["/scm/sales-orders/new", "orders"],
    ["/", "overview"],
  ])("%s lights %s", (path, key) => {
    expect(engineRowFor(path)).toBe(key);
  });

  it("covers nothing outside the menu", () => {
    expect(engineRowFor("/scm/hr/payroll")).toBeNull();
  });

  it("a row's own page needs no ?at=; a deeper page keeps it, and reopens there", () => {
    expect(engineAddressFor("/scm/purchase-orders")).toBe("/operation/sc/purchase-orders");
    const deep = engineAddressFor("/scm/purchase-orders/123?tab=lines")!;
    expect(deep).toBe("/operation/sc/purchase-orders?at=%2Fscm%2Fpurchase-orders%2F123%3Ftab%3Dlines");
    const url = new URL(deep, "http://portal");
    expect(engineFor(url.pathname, url.search)).toBe("/scm/purchase-orders/123?tab=lines");
  });

  it("refuses an ?at= that is not an engine address", () => {
    expect(engineFor("/operation/sc/orders", "?at=//evil.example")).toBe("/scm/sales-orders");
  });
});
