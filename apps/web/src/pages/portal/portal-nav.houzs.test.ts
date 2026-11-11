import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PORTAL_NAV, engineFor, menuGroups, navItemHref, retiredRedirect, rowMatchesTab, type PortalNavGroup } from "./portal-nav";

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
        blocks: ["Service Cases: Quality Overview · Service Cases · Service Maintenance · My Cases", "Projects: Project Overview · Project List · Calendar · Project Maintenance"],
      },
      {
        head: "row:Supply Chain",
        blocks: [
          "Product Request",
          "Sales Order: Sales Orders · Fair Links to Settle · Sales Order Amendment · Payment Backdate Requests · Delivery Orders · Sales Invoices · Delivery Returns · Subscription",
          "Consignment: Consignment Order · Consignment Note · Consignment Return · Purchase Consignment Order · Product Request · Purchase Consignment Receive · Purchase Consignment Return",
          "Procurement: Procurement Overview · Products & Maintenance · Suppliers · MRP · Stock Status · Purchase Orders · PO Amendments · Cancellation Requests · Goods Receipt · Purchase Invoices · Purchase Returns",
          "Transportation: Logistic Overview · Delivery Planning · Last Mile Delivery (Driver) · DP Orders · Last Mile Delivery · Crew Leave · Coverage & Fleet · Delivery Zones · Carriers & Rates · Fleet Health",
          "Warehouse: Loading List · Warehouses · Racks & Bins · Inventory · Adjustments · Transfers · Stock Take",
        ],
      },
      {
        head: "Carres",
        blocks: ["Payments: Monitor · Payment Records", "Issue Tracker", "Sales invoice lines"],
      },
    ]);
  });

  /* A row whose tab no branch answers would land on a blank page without a word. */
  it("every tab row opens a page OperationApp renders", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(join(here, "..", "operation", "OperationApp.tsx"), "utf8");
    for (const item of OPERATIONS.items) {
      if (item.path || item.soon) continue;
      expect(routes.includes(`case "${item.tab ?? item.key}":`), item.key).toBe(true);
    }
  });

  it("every engine row links to its own address, and its old address opens it", () => {
    const href = (key: string) => navItemHref(OPERATIONS, OPERATIONS.items.find((i) => i.key === key)!);
    const old: Array<[string, string, string]> = [
      ["orders", "/operation/orders", ""],
      ["delivery-orders", "/operation/delivery-orders", ""],
      ["delivery-returns", "/operation", "?tab=delivery-returns"],
      ["receiving", "/operation", "?tab=receiving"],
      ["suppliers", "/operation", "?tab=suppliers"],
      ["op-catalog", "/operation", "?tab=op-catalog"],
      ["fleet-day", "/operation", "?tab=fleet-day"],
      ["rate-cards", "/operation", "?tab=rate-cards"],
    ];
    for (const [key, path, search] of old) {
      expect(href(key), key).toBe(`/operation/sc/${key}`);
      expect(retiredRedirect(path, search), key).toBe(`/operation/sc/${key}`);
    }
  });
});

describe("rows that open one view of a page", () => {
  const row = (key: string) => OPERATIONS.items.find((i) => i.key === key)!;

  it("link to their own address, which opens their view of the engine page", () => {
    expect(navItemHref(OPERATIONS, row("wh-loading-list"))).toBe("/operation/sc/wh-loading-list");
    expect(engineFor(navItemHref(OPERATIONS, row("wh-loading-list")))).toBe("/scm/loading-list");
    expect(navItemHref(OPERATIONS, row("service-mine"))).toBe("/operation/sc/service-mine");
    expect(engineFor(navItemHref(OPERATIONS, row("service-mine")))).toBe("/my-cases");
  });

  /* No Operations row carries a `query` now, so the rule is held on a small
     area of its own: tab-driven rows that open one view of a page. */
  it("light one row, and the plain row keeps every other view", () => {
    const icon = row("wh-warehouses").icon;
    const AREA: PortalNavGroup = {
      ...OPERATIONS,
      items: [
        { key: "warehouses", label: "Warehouses", icon },
        { key: "wh-loading", label: "Loading List", icon, tab: "warehouses", query: "view=loading" },
        { key: "wh-bins", label: "Racks & Bins", icon, tab: "warehouses", query: "view=bins" },
      ],
    };
    const lit = (tab: string, search: string) =>
      AREA.items.filter((i) => rowMatchesTab(AREA, i, tab, search)).map((i) => i.key);
    expect(navItemHref(AREA, AREA.items[1])).toBe("/operation?tab=warehouses&view=loading");
    expect(lit("warehouses", "?tab=warehouses&view=loading")).toEqual(["wh-loading"]);
    expect(lit("warehouses", "?tab=warehouses&view=bins")).toEqual(["wh-bins"]);
    expect(lit("warehouses", "?tab=warehouses")).toEqual(["warehouses"]);
    expect(lit("warehouses", "?tab=warehouses&view=inventory")).toEqual(["warehouses"]);
  });
});
