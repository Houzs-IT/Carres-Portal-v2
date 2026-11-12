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
      /* Houzs's Finance group after Supply Chain (owner, 11 Nov 2026). */
      {
        head: "row:Finance",
        blocks: [
          "To do",
          "Money today",
          "Money in: Receipts · Invoices · Debtor maintenance · Credit / debit notes · Outstanding · Not yet billed",
          "Money out: Payment vouchers · Payment listing · Payment requests · Supplier bills · Supplier maintenance · Official invoices owed · Supplier & other creditor CN / DN",
          "Bank & cards: Merchant reports · Bank statements · Daily Bank · Unmatched Payments",
          "Books: Journal entries · General ledger · Trial balance · Self-check · Stock close",
          "Reports",
          "Setup: Chart of accounts · Opening balance · Item groups · Recon setup · Currencies · Deposit invoices · To do rules",
        ],
      },
      /* Houzs's SYSTEM group after Supply Chain (owner, 11 Nov 2026); the Carres bottom group is gone. */
      {
        head: "System",
        blocks: [
          "Team: Directory · Org Chart · Departments · Mailboxes · Roles & Permissions",
          "Mail Center",
          "Announcements",
          "IT: System Health · AI Usage",
          "Change Log",
          "Assistant",
          "Agent Console",
          "IT Support",
          "OCR",
        ],
      },
    ]);
  });

  it("hr sees only the System group (and Payment Requests by grant)", () => {
    expect(menuGroups(OPERATIONS, "hr").map((g) => g.label)).toEqual(["System"]);
    expect(menuGroups(OPERATIONS, "hr", new Set(["payment-requester"] as const)).map((g) => g.label)).toEqual(["Workspace", "System"]);
  });

  it("the System rows open Houzs's own pages at their own addresses", () => {
    const rows: Array<[string, string]> = [
      ["team-directory", "/team?tab=directory"],
      ["team-org-chart", "/team?tab=orgchart2"],
      ["team-departments", "/team?tab=departments2"],
      ["team-mailboxes", "/team?tab=mail2"],
      ["team-roles", "/team?tab=permissions"],
      ["mail-center", "/mail-center"],
      ["announcements", "/announcements"],
      ["system-health", "/system-health"],
      ["ai-usage", "/ai-usage"],
      ["change-log", "/change-log"],
      ["assistant", "/assistant"],
      ["agent-console", "/agents"],
      ["it-support", "/it-support"],
      ["ocr", "/ocr"],
    ];
    for (const [key, page] of rows) {
      const item = OPERATIONS.items.find((i) => i.key === key)!;
      expect(navItemHref(OPERATIONS, item), key).toBe(`/operation/sc/${key}`);
      expect(engineFor(`/operation/sc/${key}`), key).toBe(page);
    }
    // The Team module row opens Houzs's Team hub; the Settings gear opens Houzs's Settings.
    expect(engineFor("/operation/sc/hub-team")).toBe("/team?tab=hub");
    expect(engineFor("/operation/sc/settings")).toBe("/settings");
  });

  it("old HR, Issue Tracker, report and Settings addresses open their new rows", () => {
    expect(retiredRedirect("/hr", "")).toBe("/operation/sc/hub-team");
    expect(retiredRedirect("/hr", "?tab=commission")).toBe("/operation/sc/hub-team");
    expect(retiredRedirect("/hr/people/1", "")).toBe("/operation/sc/hub-team");
    expect(retiredRedirect("/hrx", "")).toBeNull();
    expect(retiredRedirect("/operation/issues", "")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation/issues/reports", "?month=2026-10")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation", "?tab=sales-invoice-lines")).toBe("/operation/sc/orders");
    expect(retiredRedirect("/operation/settings/purchasing", "")).toBe("/operation/sc/settings");
    expect(retiredRedirect("/operation/settings", "")).toBe("/operation/sc/settings");
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
