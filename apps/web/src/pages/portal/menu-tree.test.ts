import { describe, it, expect } from "vitest";
import {
  PORTAL_NAV,
  PORTAL_MODULES,
  WAREHOUSE_LANDING_KEY,
  PAYMENTS_LANDING_KEY,
  navItemHref,
  type PortalNavItem,
} from "./portal-nav";
import {
  PAGE_GROUPS,
  PURCHASING_LANDING_KEY,
  moduleChildBlocks,
  activePageGroup,
  isPageGroupOpen,
} from "./menu-tree";

/**
 * PROCUREMENT AND TRANSPORTATION IN THE HOUZS TREE (Weisiang, WhatsApp
 * 2026-11-01). Procurement is one flat list of sixteen pages with no groups;
 * the only page group left is Transportation's `Maintenance`. This file owns
 * the grouping rules and the Procurement page list: words and order, the live
 * addresses byte-for-byte, and the rows that may never return.
 */

const operation = PORTAL_NAV[0];
const purchasing = operation.items.filter((item) => item.section === "Purchasing");
const delivery = operation.items.filter((item) => item.section === "Delivery");
const label = (item: PortalNavItem) => item.label;

/** The rows the owner deleted on 2026-08-22. A row that comes back here is a
 *  destination nobody approved — the assertion is the whole point. */
const RETIRED = [
  "purchasing-home",
  "purchasing-work",
  "new-supplier-requests",
  "new-sku-requests",
  "purchase-demands",
  "consignment-overview",
  "consignment-receipts",
  "purchasing-report",
];

describe("the page groups", () => {
  it("is Maintenance, the only group, under Transportation", () => {
    expect(PAGE_GROUPS.map((group) => group.label)).toEqual(["Maintenance"]);
    expect(PAGE_GROUPS.map((group) => group.key)).toEqual(["transportation-maintenance"]);
  });

  it("every group key is unique and every grouped page attaches to a real group", () => {
    const keys = PAGE_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of operation.items.filter((i) => i.pageGroup)) {
      expect(keys, item.key).toContain(item.pageGroup);
    }
  });

  it("Procurement names no group: BUY · RECEIVE · PROBLEMS · SHOWROOM are gone", () => {
    for (const item of purchasing) expect(item.pageGroup, item.key).toBeUndefined();
    expect(moduleChildBlocks(purchasing).every((b) => b.kind === "page")).toBe(true);
  });
});

describe("the approved hierarchy", () => {
  it("Procurement draws sixteen direct rows, in the Houzs order", () => {
    expect(moduleChildBlocks(purchasing).map((b) => (b.kind === "page" ? b.item.label : b.group.label))).toEqual([
      "Procurement Overview",
      "Products & Maintenance",
      "Suppliers",
      "Supplier items",
      "MRP · Stock Status",
      "SO Batch Purchase",
      "Forecast Purchase",
      "Manual Purchase Request",
      "Purchase Orders",
      "PO Amendments",
      "Cancellation Requests",
      "Goods Receipt",
      "Purchase Invoices",
      "Purchase Returns",
      "Supplier Claims",
      "Repair Orders",
    ]);
  });

  it("Transportation draws its eight direct rows, then the one Maintenance group", () => {
    const blocks = moduleChildBlocks(delivery);
    expect(blocks.map((b) => (b.kind === "page" ? b.item.label : b.group.label))).toEqual([
      "Logistic Overview",
      "Monitor",
      "Delivery Planning",
      "Last Mile Delivery (Driver)",
      "DP Orders",
      "Last Mile Delivery",
      "Crew Leave",
      "Load Scan",
      "Maintenance",
    ]);
    const group = blocks.find((b) => b.kind === "group");
    expect(group?.kind === "group" ? group.pages.map(label) : []).toEqual([
      "Coverage & Fleet",
      "Delivery Zones",
      "Carriers & Rates",
      "Fleet Health",
    ]);
  });

  it("is exactly sixteen pages", () => {
    expect(purchasing).toHaveLength(16);
  });

  it("no row carries a hairline — Reports are central, not a Purchasing row", () => {
    for (const item of purchasing) {
      expect(item.dividerAbove, item.key).toBeUndefined();
    }
  });

  it("every retired row is gone from the module, not hidden behind a flag", () => {
    for (const key of RETIRED) {
      expect(
        purchasing.find((item) => item.key === key),
        key,
      ).toBeUndefined();
    }
    for (const word of [
      "Purchasing Home",
      "My Purchasing Work",
      "New Supplier Requests",
      "New SKU Requests",
      "Purchase Demands",
      "Consignment Overview",
      "Consignment Receipts",
      /* The PLURAL stays banned as a NAVIGATION label; the singular
         `Manual Purchase Request` is the row's own word since 2026-09-23. */
      "Manual Purchase Requests",
      "Report",
    ]) {
      expect(purchasing.map(label), word).not.toContain(word);
    }
  });

  it("the old group words are not in the registry", () => {
    const labels = PAGE_GROUPS.map((g) => g.label);
    for (const word of ["BUY", "RECEIVE", "PROBLEMS", "SHOWROOM", "REQUESTS", "CONSIGNMENT"]) {
      expect(labels).not.toContain(word);
    }
  });
});

/** THE ROUTE TRUTH — the Card's own minimum assertion. Words moved; no address did. */
describe("the live destinations keep their exact current addresses", () => {
  it("sixteen live pages, at their unchanged addresses", () => {
    expect(
      purchasing
        .filter((item) => !item.soon)
        .map((item) => [item.label, navItemHref(operation, item)]),
    ).toEqual([
      ["Procurement Overview", "/operation?tab=procurement-overview"],
      ["Products & Maintenance", "/operation?tab=op-catalog"],
      ["Suppliers", "/operation?tab=suppliers"],
      ["Supplier items", "/operation?tab=supplier-items"],
      ["MRP · Stock Status", "/operation?tab=mrp"],
      ["SO Batch Purchase", "/operation?tab=purchase"],
      /* Forecast Purchase · Outright opened 13 Oct 2026; no other address moved. */
      ["Forecast Purchase", "/operation?tab=forecast-purchase"],
      ["Manual Purchase Request", "/operation?tab=manual-purchase"],
      ["Purchase Orders", "/operation/procurement"],
      /* 0717 · Weisiang's decision (Mr Lim, WhatsApp 2026-10-22; Jess was not part of this decision). */
      ["PO Amendments", "/operation?tab=po-amendments"],
      ["Cancellation Requests", "/operation?tab=po-cancellation-requests"],
      ["Goods Receipt", "/operation?tab=receiving"],
      ["Purchase Invoices", "/operation?tab=purchase-invoices"],
      /* §9.6 — Purchase Returns opened 2026-09-19 (migration 0548). */
      ["Purchase Returns", "/operation?tab=purchase-returns"],
      ["Supplier Claims", "/operation?tab=claims"],
      /* §9.7 — Repair Orders opened with slice A (migration 0602). */
      ["Repair Orders", "/operation?tab=repair-orders"],
    ]);
  });

  it("`Manual Purchase Request` kept its key and its address — only the word changed", () => {
    const item = purchasing.find((i) => i.key === "manual-purchase");
    expect(item?.label).toBe("Manual Purchase Request");
    expect(navItemHref(operation, item as PortalNavItem)).toBe(
      "/operation?tab=manual-purchase",
    );
  });

  it("`Goods Receipt` kept the key and address `receiving` had", () => {
    const item = purchasing.find((i) => i.key === "receiving");
    expect(item?.label).toBe("Goods Receipt");
    expect(navItemHref(operation, item as PortalNavItem)).toBe("/operation?tab=receiving");
  });

  it("SO Batch Purchase answers to BOTH its entrances, and links to one", () => {
    const item = purchasing.find((i) => i.key === "purchase");
    expect(item?.activeFor).toEqual(["tab:purchase", "path:/operation/to-order"]);
    expect(navItemHref(operation, item as PortalNavItem)).toBe("/operation?tab=purchase");
  });

  it("Procurement has no unbuilt page; Display Requests (still soon) sits in Consignment, with no route", () => {
    expect(purchasing.filter((i) => i.soon)).toEqual([]);
    const display = operation.items.find((i) => i.key === "display-requests");
    expect(display?.section).toBe("Consignment");
    expect(display?.soon).toBe(true);
    expect(display?.path).toBeUndefined();
    expect(display?.badge).toBeUndefined();
    expect(display?.tab).toBeUndefined();
  });

  it("the named landing page is permanent, and it is SO Batch Purchase", () => {
    expect(PURCHASING_LANDING_KEY).toBe("purchase");
    const landing = purchasing.find((i) => i.key === PURCHASING_LANDING_KEY);
    expect(landing?.label).toBe("SO Batch Purchase");
    expect(landing?.soon).toBeUndefined();
  });
});

describe("the group holding the page you are on", () => {
  it("finds the group of a live destination", () => {
    for (const key of ["coverage-fleet", "delivery-zones", "rate-cards", "fleet-health"]) {
      expect(activePageGroup(delivery, key), key).toBe("transportation-maintenance");
    }
  });

  it("a direct row, a retired key and another module's page belong to no group", () => {
    expect(activePageGroup(delivery, "fleet-day")).toBeNull();
    expect(activePageGroup(delivery, "purchasing-report")).toBeNull();
    expect(activePageGroup(delivery, null)).toBeNull();
    expect(activePageGroup(delivery, "stock")).toBeNull();
    expect(activePageGroup(purchasing, "receiving")).toBeNull();
  });
});

/**
 * WHICH GROUPS ARE OPEN (owner 12 Oct 2026). Nothing is stored: the page
 * decides, and a chevron worked by hand is kept only for that page.
 */
describe("which groups are open", () => {
  it("the group holding the current page is open", () => {
    expect(isPageGroupOpen("transportation-maintenance", "transportation-maintenance", {})).toBe(true);
  });

  it("a module that does not hold the current page shows every group open", () => {
    for (const group of PAGE_GROUPS) {
      expect(isPageGroupOpen(group.key, null, {}), group.key).toBe(true);
    }
  });

  it("a chevron worked by hand wins when no page of the group is current", () => {
    expect(isPageGroupOpen("transportation-maintenance", null, { "transportation-maintenance": false })).toBe(false);
    expect(isPageGroupOpen("transportation-maintenance", null, { "transportation-maintenance": true })).toBe(true);
  });

  it("the group you are standing in never shuts", () => {
    expect(
      isPageGroupOpen("transportation-maintenance", "transportation-maintenance", { "transportation-maintenance": false }),
    ).toBe(true);
  });
});

describe("one rule for every module", () => {
  it("the group words come from one registry", () => {
    for (const item of operation.items.filter((i) => i.pageGroup)) {
      expect(PAGE_GROUPS.map((g) => g.key), item.key).toContain(item.pageGroup);
    }
  });

  it("a module with no groups hangs its pages directly on the tree", () => {
    const sales = operation.items.filter((item) => item.section === "Sales");
    const blocks = moduleChildBlocks(sales);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.kind === "page")).toBe(true);
  });

  it("the landing page and the open-only rule are read from the module's own record", () => {
    const byLabel = (label: string) => PORTAL_MODULES.find((m) => m.label === label)!;
    expect(byLabel("Procurement").landingKey).toBe(PURCHASING_LANDING_KEY);
    expect(byLabel("Procurement").handleOnly).toBe(true);
    expect(byLabel("Warehouse").landingKey).toBe(WAREHOUSE_LANDING_KEY);
    expect(byLabel("Payments").landingKey).toBe(PAYMENTS_LANDING_KEY);
    expect(byLabel("Sales Order").handleOnly).toBeUndefined();
  });
});
