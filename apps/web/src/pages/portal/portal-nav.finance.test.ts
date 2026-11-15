import { describe, it, expect } from "vitest";
import { PORTAL_NAV, engineAddressFor, engineFor, navItemHref, roleMayOpenEngineRow, visibleItems } from "./portal-nav";

/**
 * ⭐ THE FINANCE MODULES — the Houzs tree (Weisiang, WhatsApp 2026-11-01;
 * Sidebar.tsx:740-861), over Chew's modules of 2026-10-03
 * (`docs/finance/MASTER.md` §4).
 *
 *     Dashboard
 *     Money in            Monitor · Payment Records · Sales Invoices · Other receipts · Other Debtors ·
 *                         Outstanding · Not Yet Billed · Customer Credit Notes · Cancelled orders holding money
 *     Money out           Payment Vouchers · AP Invoices · Payment Requests · Supplier Maintenance ·
 *                         Credit Notes · Debit Notes · Notes to follow up · AP · Payables
 *     Bank & cards        Daily Bank · Merchant Recon · Card money waiting · Money moves
 *     Books               Journal Entries · General Ledger · Trial Balance · Self-check
 *     Reports             one row per report, Payment's own report last
 *     Forecast P&L        (plain row)
 *     Opening Balance     (plain row)
 *     Rental Approver · Subscriptions · Dealers               (unchanged)
 *
 * Money in sits above Money out, as in Houzs. Grouping is presentation only,
 * so every page keeps its address.
 */


/* The old Carres Finance area is removed (owner, 16 Nov 2026); its rail tests went with it. */
describe("Payment Requests in the Operations rail", () => {
  const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;
  const keys = (caps?: ReadonlySet<"payment-requester">) => visibleItems(OPERATIONS, "operation", caps).map((i) => i.key);

  it("is hidden without the grant, and shows with it", () => {
    expect(keys()).not.toContain("payment-requests");
    expect(keys(new Set(["payment-requester"] as const))).toContain("payment-requests");
  });

  it("opens Houzs's Payment Requests with its count, and sits under Workspace", () => {
    const item = OPERATIONS.items.find((i) => i.key === "payment-requests")!;
    expect(navItemHref(OPERATIONS, item)).toBe("/operation/sc/payment-requests");
    expect(engineFor("/operation/sc/payment-requests")).toBe("/scm/payment-requests");
    expect(engineFor("/operation/sc/payment-requests")).toBe(engineFor("/operation/sc/fin-payment-requests"));
    expect(item.badge).toBe("payment-requests-waiting");
    // Back under Workspace, as in Houzs (Weisiang, 2026-11-01).
    expect(item.section).toBe("Workspace");
    expect(item.needs).toBe("payment-requester");
  });

  it("the grant changes nothing else in the rail", () => {
    const withGrant = keys(new Set(["payment-requester"] as const)).filter((k) => k !== "payment-requests");
    expect(withGrant).toEqual(keys());
  });
});

/**
 * 0687 (Chew 2026-10-12, Finance MASTER §3.3, 「hr & BD 也到能申请」): the HR
 * staff Finance or the boss allows see Payment Requests. The Carres HR area is
 * removed (owner, 11 Nov 2026), so HR finds it in Operations' Workspace, the
 * one other Operations place it stands in beside the System rows.
 */
describe("Payment Requests for HR staff", () => {
  const OPS = PORTAL_NAV.find((g) => g.area === "operation")!;
  const GRANT = new Set(["payment-requester"] as const);
  const keys = (role: "hr" | "principal", caps?: ReadonlySet<"payment-requester">) => visibleItems(OPS, role, caps).map((i) => i.key);

  it("shows to HR staff with the grant, and not without it", () => {
    expect(keys("hr")).not.toContain("payment-requests");
    expect(keys("hr", GRANT)).toContain("payment-requests");
  });

  it("opens Houzs's Payment Requests, which HR may open though it does not see the Houzs Finance rows", () => {
    const item = OPS.items.find((i) => i.key === "payment-requests")!;
    expect(navItemHref(OPS, item)).toBe("/operation/sc/payment-requests");
    expect(roleMayOpenEngineRow("hr", "payment-requests")).toBe(true);
    expect(roleMayOpenEngineRow("hr", "fin-payment-requests")).toBe(false);
  });

  it("a record opened from the Workspace door keeps the door's address, so HR is never sent to the Finance row", () => {
    const record = "/scm/payment-requests/prq-1";
    expect(engineAddressFor(record, "payment-requests")).toBe(`/operation/sc/payment-requests?at=${encodeURIComponent(record)}`);
    expect(engineAddressFor(record, "fin-payment-requests")).toBe(`/operation/sc/fin-payment-requests?at=${encodeURIComponent(record)}`);
    // With no door to keep, the Finance row is the page's row (the door is a shortcut, never lit by a frame move).
    expect(engineAddressFor(record)).toBe(`/operation/sc/fin-payment-requests?at=${encodeURIComponent(record)}`);
    // A module row is not a door: it does not hold another module's page.
    expect(engineAddressFor("/scm/purchase-orders", "hub-scm")).toBe("/operation/sc/purchase-orders");
  });

  it("is the only row HR sees outside the System rows", () => {
    expect(keys("hr", GRANT).filter((k) => k !== "payment-requests")).toEqual(keys("hr"));
    expect(keys("hr")).toEqual([
      "team-directory", "team-org-chart", "team-departments", "team-mailboxes", "team-roles",
      "mail-center", "announcements", "system-health", "ai-usage",
      "change-log", "assistant", "agent-console", "it-support", "ocr",
    ]);
  });
});
