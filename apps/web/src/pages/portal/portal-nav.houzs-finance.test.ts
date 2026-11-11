import { describe, expect, it } from "vitest";
import {
  ENGINE_PAGES,
  PORTAL_NAV,
  engineAddressFor,
  engineFor,
  engineRowFor,
  menuGroups,
  roleMayOpenEngineRow,
  visibleGroups,
} from "./portal-nav";

/** Houzs's whole Finance group in the portal menu (owner, 11 Nov 2026; Houzs Sidebar.tsx:736-873). */
const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;
const FINANCE_ROWS = OPERATIONS.items.filter((it) => it.key.startsWith("fin-"));

describe("Houzs Finance in the portal menu", () => {
  it("has Houzs's 32 Finance rows, each at its own engine row address", () => {
    expect(FINANCE_ROWS).toHaveLength(32);
    for (const row of FINANCE_ROWS) expect(row.path).toBe(`/operation/sc/${row.key}`);
  });

  it("every Finance row resolves to its engine page through engineFor", () => {
    for (const row of FINANCE_ROWS) {
      const page = engineFor(row.path!, "");
      expect(page, row.key).toBe(ENGINE_PAGES[row.key]);
      expect(page, row.key).toMatch(/^\/(scm|reports)\//);
    }
  });

  it("opens the Houzs addresses of Houzs's Finance entries", () => {
    const want: Array<[string, string]> = [
      ["fin-todo", "/scm/finance"],
      ["fin-money-today", "/scm/daily-bank?view=board"],
      ["fin-receipts", "/scm/receipts"],
      ["fin-invoices", "/scm/ar-invoices"],
      ["fin-not-billed", "/scm/unbilled-deliveries"],
      ["fin-supplier-bills", "/scm/ap-invoices"],
      ["fin-journal", "/scm/accounting?tab=je"],
      ["fin-reports", "/scm/accounting?tab=pnl"],
      ["fin-item-groups", "/scm/accounting?tab=groups"],
      ["fin-todo-rules", "/scm/finance/rules"],
    ];
    for (const [key, page] of want) expect(engineFor(`/operation/sc/${key}`, ""), key).toBe(page);
  });

  it("a page the frame moves to lights the Finance row it belongs to", () => {
    expect(engineRowFor("/scm/receipts/official/42")).toBe("fin-receipts");
    expect(engineRowFor("/scm/ar-invoices/sales/7")).toBe("fin-invoices");
    expect(engineRowFor("/scm/payment-vouchers/9")).toBe("fin-payment-vouchers");
    expect(engineRowFor("/scm/ap-invoices/3")).toBe("fin-supplier-bills");
    expect(engineRowFor("/scm/credit-notes/5")).toBe("fin-credit-notes");
    expect(engineRowFor("/scm/supplier-notes/5")).toBe("fin-supplier-notes");
    expect(engineRowFor("/scm/daily-bank")).toBe("fin-daily-bank");
    expect(engineRowFor("/scm/daily-bank?view=board")).toBe("fin-money-today");
    expect(engineRowFor("/scm/finance")).toBe("fin-todo");
    expect(engineRowFor("/scm/finance/deposit-invoices")).toBe("fin-deposit-invoices");
    expect(engineRowFor("/scm/accounting?tab=gl")).toBe("fin-gl");
  });

  it("every report lights the one Reports entry, as in Houzs", () => {
    for (const page of ["/scm/accounting?tab=bs", "/scm/accounting?tab=charges", "/scm/forecast", "/scm/finance-dashboard", "/reports/fair-report"]) {
      expect(engineRowFor(page), page).toBe("fin-reports");
    }
    // A Books page opened from the report list lights Reports, not Books.
    expect(engineRowFor("/scm/accounting?tab=je&in=reports")).toBe("fin-reports");
    expect(engineAddressFor("/scm/accounting?tab=bs")).toBe(`/operation/sc/fin-reports?at=${encodeURIComponent("/scm/accounting?tab=bs")}`);
  });

  it("finance sees the Houzs Finance group in Operations, and only that", () => {
    expect(menuGroups(OPERATIONS, "finance").map((g) => g.row?.key ?? g.label)).toEqual(["finance"]);
    expect(roleMayOpenEngineRow("finance", "fin-receipts")).toBe(true);
    expect(roleMayOpenEngineRow("finance", "orders")).toBe(false);
    expect(roleMayOpenEngineRow("hr", "fin-receipts")).toBe(false);
    expect(roleMayOpenEngineRow("operation", "fin-receipts")).toBe(true);
  });

  it("the old Carres Finance is kept, at the very bottom, as Finance (old)", () => {
    const old = PORTAL_NAV.find((g) => g.area === "finance")!;
    expect(PORTAL_NAV[PORTAL_NAV.length - 1]).toBe(old);
    expect(old.label).toBe("Finance (old)");
    expect(old.items.length).toBeGreaterThan(30);
    expect(visibleGroups("principal").map((g) => g.label)).toEqual(["Operations", "Admin", "Finance (old)"]);
    expect(visibleGroups("finance").map((g) => g.label)).toEqual(["Operations", "Finance (old)"]);
  });
});
