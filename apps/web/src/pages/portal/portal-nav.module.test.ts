import { describe, expect, it } from "vitest";
import { activeNavModule, activeNavTitle } from "./portal-nav";

describe("activeNavModule: the module an IT request is about", () => {
  it("names an Operations page by its rail module", () => {
    expect(activeNavModule("/operation/sc/orders", "")).toBe("Sales Order");
    expect(activeNavModule("/operation/sc/suppliers", "")).toBe("Procurement");
    expect(activeNavModule("/operation/sc/consignment-notes", "")).toBe("Consignment");
  });

  it("carries the area's name outside Operations", () => {
    expect(activeNavModule("/finance/other-receipts", "")).toBe("Finance (old) · Money in");
  });

  it("is empty on a page no row covers", () => {
    expect(activeNavModule("/nowhere", "")).toBe("");
  });

  it("leaves the page header's title as it was", () => {
    expect(activeNavTitle("/operation/sc/suppliers", "")).toEqual({ crumb: "Procurement", title: "Suppliers" });
  });

  it("matches a row's path on whole segments, and the row, not the Workspace shortcut, is where the URL stands", () => {
    expect(activeNavTitle("/operation/sc/stock", "")).toEqual({ crumb: "Warehouse", title: "Inventory" });
    expect(activeNavTitle("/operation/sc/stock-adjustments", "")).toEqual({ crumb: "Warehouse", title: "Adjustments" });
    expect(activeNavTitle("/operation/sc/orders", "")).toEqual({ crumb: "Sales Order", title: "Sales Orders" });
  });
});
