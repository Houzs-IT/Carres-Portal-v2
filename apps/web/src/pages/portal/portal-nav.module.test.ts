import { describe, expect, it } from "vitest";
import { activeNavModule, activeNavTitle } from "./portal-nav";

describe("activeNavModule: the module an IT request is about", () => {
  it("names an Operations page by its rail module", () => {
    expect(activeNavModule("/operation/orders", "")).toBe("Sales Order");
    expect(activeNavModule("/operation", "?tab=suppliers")).toBe("Procurement");
    expect(activeNavModule("/operation", "?tab=consignment-notes")).toBe("Consignment");
  });

  it("carries the area's name outside Operations", () => {
    expect(activeNavModule("/finance/other-receipts", "")).toBe("Finance · Money in");
  });

  it("is empty on a page no row covers", () => {
    expect(activeNavModule("/nowhere", "")).toBe("");
  });

  it("leaves the page header's title as it was", () => {
    expect(activeNavTitle("/operation", "?tab=suppliers")).toEqual({ crumb: "Procurement", title: "Suppliers" });
  });
});
