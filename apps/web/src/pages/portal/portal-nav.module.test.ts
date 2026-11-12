import { describe, expect, it } from "vitest";
import {
  activeNavTitle,
} from "./portal-nav";

describe("activeNavModule: the module an IT request is about", () => {

  it("leaves the page header's title as it was", () => {
    expect(activeNavTitle("/operation/sc/suppliers", "")).toEqual({ crumb: "Procurement", title: "Suppliers" });
  });

  it("matches a row's path on whole segments, and the row, not the Workspace shortcut, is where the URL stands", () => {
    expect(activeNavTitle("/operation/sc/stock", "")).toEqual({ crumb: "Warehouse", title: "Inventory" });
    expect(activeNavTitle("/operation/sc/stock-adjustments", "")).toEqual({ crumb: "Warehouse", title: "Adjustments" });
    expect(activeNavTitle("/operation/sc/orders", "")).toEqual({ crumb: "Sales Order", title: "Sales Orders" });
  });
});
