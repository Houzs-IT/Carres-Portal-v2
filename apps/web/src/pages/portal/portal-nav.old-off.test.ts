import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTAL_NAV, isOldSupplyChainRow, oldSupplyChainTarget } from "./portal-nav";

const operation = PORTAL_NAV.find((g) => g.area === "operation")!;
const row = (key: string) => operation.items.find((i) => i.key === key)!;

describe("the old supply chain, turned off (owner, 10 Nov 2026)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("hides its rows with no engine page, keeps engine rows, Sales Invoices and the other areas", () => {
    for (const k of ["guarantees", "rental", "customer-consignment-orders", "supplier-items", "claims", "load-scan", "wh-inbound", "showroom"]) {
      expect(isOldSupplyChainRow(row(k)), k).toBe(true);
    }
    for (const k of ["orders", "purchase-orders", "service-notes", "sales-invoices", "payments", "projects", "dashboard", "issue-tracker"]) {
      expect(isOldSupplyChainRow(row(k)), k).toBe(false);
    }
  });

  it("sends its addresses, records included, to the nearest engine page", () => {
    expect(oldSupplyChainTarget("/operation/orders/so/abc", "")).toBe("/scm/sales-orders");
    expect(oldSupplyChainTarget("/operation/procurement", "?po=PO-1")).toBe("/scm/purchase-orders");
    expect(oldSupplyChainTarget("/operation/purchase-invoices/x/edit", "")).toBe("/scm/purchase-invoices");
    expect(oldSupplyChainTarget("/operation/delivery-orders/do-1", "")).toBe("/scm/delivery-orders");
    expect(oldSupplyChainTarget("/operation", "?tab=claims")).toBe("/scm/purchase-orders");
    expect(oldSupplyChainTarget("/operation", "?tab=guarantees")).toBe("/assr?view=cases");
  });

  it("leaves every other address alone", () => {
    expect(oldSupplyChainTarget("/operation/settings/staff", "")).toBeNull();
    expect(oldSupplyChainTarget("/operation/issues", "")).toBeNull();
    expect(oldSupplyChainTarget("/operation", "?tab=projects")).toBeNull();
    expect(oldSupplyChainTarget("/operation", "?tab=payments")).toBeNull();
    expect(oldSupplyChainTarget("/operation/ordersx", "")).toBeNull();
  });

  it("with the production switch off, the menu drops those rows", async () => {
    vi.stubEnv("VITE_OLD_SUPPLY_CHAIN", "off");
    vi.resetModules();
    const nav = await import("./portal-nav");
    const op = nav.PORTAL_NAV.find((g) => g.area === "operation")!;
    const keys = nav.visibleItems(op, "operation").map((i) => i.key);
    expect(keys).not.toContain("claims");
    expect(keys).not.toContain("showroom");
    expect(keys).toContain("orders");
    expect(keys).toContain("sales-invoices");
  });
});
