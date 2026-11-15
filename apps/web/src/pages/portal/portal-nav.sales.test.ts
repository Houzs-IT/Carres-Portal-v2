import { describe, it, expect } from "vitest";
import {
  PORTAL_MODULES,
  PORTAL_NAV,
  navBlocks,
  navItemHref,
  visibleItems,
} from "./portal-nav";

/**
 * ⭐ THE SALES ORDER MODULE — the Houzs tree (Weisiang, WhatsApp 2026-11-01).
 *
 *     Sales Order                  (inside the Supply Chain row)
 *     ├─ Sales Orders
 *     ├─ Subscription
 *     ├─ Sales Order Amendment
 *     ├─ Delivery Orders
 *     ├─ Sales Invoices
 *     └─ Delivery Returns
 *
 * Sales Orders also has a second door under Workspace (`orders-shortcut`, the
 * same address); `Jump to` offers the place, not the door.
 *
 * This file guards the MODEL — the words, the addresses and the one-place rule
 * — so a later rail refactor cannot quietly re-open a settled ruling.
 * `PortalSidebar.test.tsx` guards how it draws.
 */

const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;

describe("the approved Sales Orders navigation", () => {
  it("the module row is `Sales Order`", () => {
    expect(PORTAL_MODULES.find((m) => m.section === "Sales")?.label).toBe(
      "Sales Order",
    );
  });

  it("holds the Houzs Sales Order rows in Houzs order (no Subscription, owner 16 Nov 2026)", () => {
    const block = navBlocks(OPERATIONS, "operation").find(
      (b) => b.kind === "module" && b.module.section === "Sales",
    );
    expect(block?.kind).toBe("module");
    const pages = block!.kind === "module" ? block!.pages : [];
    expect(pages.map((p) => p.label)).toEqual([
      "Sales Orders",
      "Sales Order Amendment",
      "Payment Backdate Requests",
      "Delivery Orders",
      "Sales Invoices",
      "Delivery Returns",
    ]);
  });

  /* NEITHER ADDRESS MOVED. "Menu removal does not delete orders, history,
     documents or valid existing deep links", and a rename is not a relocation:
     every bookmark, every in-page link and every ⌘K jump still lands. */
  it("keeps both destinations at the addresses they already had", () => {
    const byKey = Object.fromEntries(
      visibleItems(OPERATIONS, "operation").map((i) => [i.key, i]),
    );
    expect(navItemHref(OPERATIONS, byKey.orders)).toBe("/operation/sc/orders");
    expect(byKey.rental).toBeUndefined();
  });

  /* `Purchase` is rejected BY NAME in COPY-STANDARD for this entry — it reads
     as the Purchasing module, which stays separate. */
  it("never calls a Sales Order child `Purchase`", () => {
    const sales = visibleItems(OPERATIONS, "operation").filter(
      (i) => i.section === "Sales",
    );
    expect(sales.map((i) => i.label)).not.toContain("Purchase");
    for (const item of sales) expect(item.label).not.toMatch(/Purchase/);
  });

  it("Service Cases carries its four pages, in order", () => {
    const care = visibleItems(OPERATIONS, "operation").filter(
      (i) => i.section === "Customer Care",
    );
    expect(care.map((i) => i.label)).toEqual([
      "Quality Overview",
      "Service Cases",
      "Service Maintenance",
      "My Cases",
    ]);
  });

  /* THE MENU ROW IS REMOVED; THE PAGE IS NOT. `/operation/old-orders` stays
     mounted (see `OperationApp.test.tsx`) and `CaseOrderLink` still deep-links
     into it. The rail simply no longer offers it. */
  it("no rail row points at the legacy orders page any more", () => {
    for (const group of PORTAL_NAV) {
      for (const item of group.items) {
        expect(item.key).not.toBe("old-orders");
        expect(item.path ?? "").not.toContain("old-orders");
      }
    }
  });

  /* The shared parent is NAVIGATION ONLY. Procurement keeps its own module, and
     nothing about it moves under Sales Order. */
  it("Procurement stays a separate module", () => {
    expect(PORTAL_MODULES.some((m) => m.section === "Purchasing")).toBe(true);
    const sales = visibleItems(OPERATIONS, "operation").filter(
      (i) => i.section === "Sales",
    );
    expect(sales.some((i) => i.pageGroup)).toBe(false);
  });
});
