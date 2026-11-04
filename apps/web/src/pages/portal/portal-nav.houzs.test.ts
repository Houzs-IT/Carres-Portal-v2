import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PORTAL_NAV, menuGroups, navItemHref, rowMatchesTab } from "./portal-nav";

/**
 * The Operations rail follows the Houzs tree (Houzs-ERP
 * frontend/src/components/Sidebar.tsx; Weisiang, WhatsApp 2026-11-01). Rows with
 * no Carres page are left out; `Carres-only` comments in `portal-nav.ts` mark
 * the rows Houzs does not have.
 */

const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;

const tree = () =>
  menuGroups(OPERATIONS, "operation").map((g) => ({
    head: g.row ? `row:${g.row.label}` : g.label,
    blocks: g.blocks.map((b) =>
      b.kind === "module" ? `${b.module.label}: ${b.pages.map((p) => p.label).join(" · ")}` : b.item.label,
    ),
  }));

describe("the Houzs tree", () => {
  it("draws Workspace, then Operations with Supply Chain inside it", () => {
    expect(tree()).toEqual([
      { head: "Workspace", blocks: ["Overview", "Sales Orders", "Workspace", "Leave"] },
      {
        head: "Operations",
        blocks: ["Service Cases: Quality Overview · Service Cases · Service Maintenance · My Cases · Guarantees", "Project List"],
      },
      {
        head: "row:Supply Chain",
        blocks: [
          "Sales Order: Sales Orders · Subscription · Sales Order Amendment · Delivery Orders · Sales Invoices · Delivery Returns",
          "Consignment: Consignment Order · Consignment Note · Consignment Return · Purchase Consignment Receive · Purchase Consignment Return · Display Requests",
          "Procurement: Procurement Overview · Products & Maintenance · Suppliers · Supplier items · MRP · Stock Status · SO Batch Purchase · Forecast Purchase · Manual Purchase Request · Purchase Orders · PO Amendments · Cancellation Requests · Goods Receipt · Purchase Invoices · Purchase Returns · Supplier Claims · Repair Orders",
          "Transportation: Logistic Overview · Monitor · Delivery Planning · DP Orders · Last Mile Delivery · Lorry Live Map · Lorry Capacity · Crew Leave · Load Scan · Coverage & Fleet · Delivery Zones · Carriers & Rates · Fleet Health",
          "Warehouse: Loading List · Warehouses · Racks & Bins · Inventory · Adjustments · Transfers · Stock Take · Arrival Schedule · Pickup Schedule · Inbound · Outbound",
        ],
      },
      {
        head: null,
        blocks: [
          "Payments: Monitor · Payment Records",
          "Showroom: Carres · Dealer",
          "Issue Tracker",
          "Reports: Purchasing report · Receiving report · Delivery report · Delivery return lines · Sales order lines · Delivery order lines · Sales invoice lines",
        ],
      },
    ]);
  });

  /* A row whose tab no branch answers would land on a blank page without a word. */
  it("every tab row opens a page OperationApp renders", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(join(here, "..", "operation", "OperationApp.tsx"), "utf8");
    for (const item of OPERATIONS.items) {
      if (item.path || item.soon) continue;
      expect(routes.includes(`tab === "${item.tab ?? item.key}"`), item.key).toBe(true);
    }
  });

  it("the moved and renamed rows keep their old addresses", () => {
    const href = (key: string) => navItemHref(OPERATIONS, OPERATIONS.items.find((i) => i.key === key)!);
    expect(href("orders")).toBe("/operation/orders");
    expect(href("delivery-orders")).toBe("/operation/delivery-orders");
    expect(href("delivery-returns")).toBe("/operation?tab=delivery-returns");
    expect(href("receiving")).toBe("/operation?tab=receiving");
    expect(href("suppliers")).toBe("/operation?tab=suppliers");
    expect(href("op-catalog")).toBe("/operation?tab=op-catalog");
    expect(href("fleet-day")).toBe("/operation?tab=fleet-day");
    expect(href("rate-cards")).toBe("/operation?tab=rate-cards");
  });
});

describe("rows that open one view of a page", () => {
  const row = (key: string) => OPERATIONS.items.find((i) => i.key === key)!;
  const lit = (tab: string, search: string) =>
    OPERATIONS.items.filter((i) => !i.path && rowMatchesTab(OPERATIONS, i, tab, search)).map((i) => i.key);

  it("link to their view", () => {
    expect(navItemHref(OPERATIONS, row("wh-loading-list"))).toBe("/operation?tab=warehouses&view=loading");
    expect(navItemHref(OPERATIONS, row("service-mine"))).toBe("/operation?tab=service-notes&mine=1");
  });

  it("light one row, and the plain row keeps every other view", () => {
    expect(lit("warehouses", "?tab=warehouses&view=loading")).toEqual(["wh-loading-list"]);
    expect(lit("warehouses", "?tab=warehouses&view=bins")).toEqual(["wh-racks"]);
    expect(lit("warehouses", "?tab=warehouses")).toEqual(["wh-warehouses"]);
    expect(lit("warehouses", "?tab=warehouses&view=inventory")).toEqual(["wh-warehouses"]);
    expect(lit("service-notes", "?tab=service-notes&view=quality")).toEqual(["service-quality"]);
    expect(lit("service-notes", "?tab=service-notes")).toEqual(["service-notes"]);
  });
});
