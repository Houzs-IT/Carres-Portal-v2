import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PORTAL_MODULES, PORTAL_NAV, navBlocks, navItemHref, visibleItems } from "./portal-nav";

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

const FINANCE = PORTAL_NAV.find((g) => g.area === "finance")!;

const shape = (role: "finance" | "principal") =>
  navBlocks(FINANCE, role).map((b) =>
    b.kind === "module"
      ? `${b.module.label}: ${b.pages.map((p) => p.label).join(" · ")}`
      : b.item.label,
  );

describe("the Finance modules (Chew, 2026-10-03)", () => {
  it("draws the approved shape, in order", () => {
    expect(shape("finance")).toEqual([
      "Dashboard",
      "Money in: Monitor · Payment Records · Sales Invoices · Other receipts · Other Debtors · Outstanding · Not Yet Billed · Customer Credit Notes · Cancelled orders holding money",
      "Money out: Payment Vouchers · AP Invoices · Payment Requests · Supplier Maintenance · Credit Notes · Debit Notes · Notes to follow up · AP · Payables",
      "Bank & cards: Daily Bank · Merchant Recon · Card money waiting · Money moves",
      "Books: Journal Entries · General Ledger · Trial Balance · Self-check",
      "Reports: P&L · Balance Sheet · Cash Flow · AR Aging · AP Aging · Collection · Merchant charges · Dealer commission · Stock value · Stock drops · Corrections · Payment",
      "Forecast P&L",
      "Opening Balance",
      "Rental Approver",
      "Subscriptions",
      "Dealers",
    ]);
  });

  it("the principal sees the same Finance rail", () => {
    expect(shape("principal")).toEqual(shape("finance"));
  });

  it("uses the approved module words", () => {
    const label = (section: string) => PORTAL_MODULES.find((m) => m.section === section)?.label;
    expect(["Receivables", "Payables", "Bank & Cards", "Ledger", "Reports"].map(label)).toEqual([
      "Money in",
      "Money out",
      "Bank & cards",
      "Books",
      "Reports",
    ]);
    // Forecast and Setup have one page each, so they have no module row.
    expect(PORTAL_MODULES.some((m) => m.section === "Forecast" || m.section === "Setup")).toBe(false);
  });

  /* Grouping moved no address: every bookmark and in-page link still lands.
     The Profit and Loss and the Balance Sheet each have their own now. */
  it("every Finance page keeps its address, and every report has its own", () => {
    const hrefs = Object.fromEntries(FINANCE.items.map((it) => [it.key, navItemHref(FINANCE, it)]));
    expect(hrefs).toEqual({
      dashboard: "/finance/dashboard",
      "not-yet-billed": "/finance/not-yet-billed",
      corrections: "/finance/corrections",
      ap: "/finance/ap-outstanding",
      ar: "/finance/ar",
      bills: "/finance/bills",
      "payment-vouchers": "/finance/payment-vouchers",
      "payment-requests": "/finance/payment-requests",
      "credit-notes": "/finance/credit-notes",
      "debit-notes": "/finance/debit-notes",
      "notes-to-follow-up": "/finance/notes-to-follow-up",
      "supplier-finance": "/finance/suppliers",
      payments: "/finance/monitor",
      "payment-records": "/finance/payments",
      "sales-invoices": "/finance/sales-invoices",
      "rental-approver": "/finance/rental-approver",
      subscriptions: "/finance/subscriptions",
      "other-debtors": "/finance/other-debtors",
      "other-receipts": "/finance/other-receipts",
      "daily-bank": "/finance/daily-bank",
      "card-settlement": "/finance/card-settlement",
      "card-money-waiting": "/finance/card-money-waiting",
      "money-moves": "/finance/money-moves",
      dealers: "/finance/dealers",
      ledger: "/finance/ledger",
      "opening-balances": "/finance/ledger/opening-balances",
      "general-ledger": "/finance/ledger/general-ledger",
      "trial-balance": "/finance/ledger/trial-balance",
      "self-check": "/finance/ledger/self-check",
      "profit-and-loss": "/finance/reports/profit-and-loss",
      "balance-sheet": "/finance/reports/balance-sheet",
      "cash-flow": "/finance/reports/cash-flow",
      "ap-aging": "/finance/reports/ap-aging",
      "ar-aging": "/finance/reports/ar-aging",
      collection: "/finance/reports/collection",
      "customer-credit-notes": "/finance/customer-credit-notes",
      "cancelled-money": "/finance/cancelled-money",
      "card-charges": "/finance/reports/card-charges",
      "dealer-commission": "/finance/reports/dealer-commission",
      "stock-value": "/finance/reports/stock-value",
      "stock-drops": "/finance/reports/stock-drops",
      "payment-report": "/finance/reports/payment",
      forecast: "/finance/reports/forecast",
    });
  });

  /* A row whose address no route answers would land on the area's first page
     without a word, so each one is checked against the routes FinanceApp declares. */
  it("every Finance row opens a page FinanceApp routes", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(join(here, "..", "finance", "FinanceApp.tsx"), "utf8");
    for (const item of FINANCE.items) {
      const path = navItemHref(FINANCE, item).replace(/^\/finance\//, "").split("?")[0]!;
      expect(routes.includes(`path="${path}"`) || routes.includes(`path="${path}/*"`), item.key).toBe(true);
    }
  });

  it("no other area has a page in a Finance module", () => {
    /* `Reports` left this set on 2026-10-08: the owner gave Operations its own
       Reports module under DATA (Layout Standard §2). The modules stay apart —
       it holds only the Operations report pages, none of them Finance's. */
    const financeSections = new Set(["Payables", "Receivables", "Bank & Cards", "Ledger", "Forecast", "Setup"]);
    const elsewhere = PORTAL_NAV.filter((g) => g.area !== "finance").flatMap((g) =>
      g.items.filter((it) => it.section && financeSections.has(it.section)).map((it) => `${g.area}:${it.key}`),
    );
    expect(elsewhere).toEqual([]);
    const opsReports = PORTAL_NAV.filter((g) => g.area !== "finance").flatMap((g) =>
      g.items.filter((it) => it.section === "Reports").map((it) => `${g.area}:${it.key}`),
    );
    expect(opsReports).toEqual([
      "operation:purchasing-report",
      "operation:receiving-report",
      "operation:delivery-report",
      "operation:delivery-return-lines",
      "operation:sales-order-lines",
      "operation:delivery-order-lines",
      "operation:sales-invoice-lines",
    ]);
    const financeKeys = new Set(FINANCE.items.map((it) => it.key));
    for (const key of opsReports) expect(financeKeys.has(key.split(":")[1]!), key).toBe(false);
  });
});

/**
 * ⭐ THE ONE SHARED-MENU ENTRY CHEW APPROVED (2026-10-03, Finance MASTER §3.3):
 * Payment Requests shows to the Operation staff the boss allows — by a grant,
 * not a role — and opens the page in Finance. Nobody else of Operation sees it.
 */
describe("Payment Requests in the Operations rail", () => {
  const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;
  const keys = (caps?: ReadonlySet<"payment-requester">) => visibleItems(OPERATIONS, "operation", caps).map((i) => i.key);

  it("is hidden without the grant, and shows with it", () => {
    expect(keys()).not.toContain("payment-requests");
    expect(keys(new Set(["payment-requester"] as const))).toContain("payment-requests");
  });

  it("opens the Finance page and sits under Workspace", () => {
    const item = OPERATIONS.items.find((i) => i.key === "payment-requests")!;
    expect(navItemHref(OPERATIONS, item)).toBe("/finance/payment-requests");
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
 * staff Finance or the boss allows see Payment Requests on their own rail.
 */
describe("Payment Requests on the HR rail", () => {
  const HR = PORTAL_NAV.find((g) => g.area === "hr")!;
  const GRANT = new Set(["payment-requester"] as const);
  const keys = (role: "hr" | "principal", caps?: ReadonlySet<"payment-requester">) => visibleItems(HR, role, caps).map((i) => i.key);

  it("shows to HR staff with the grant, and to no one else on this rail", () => {
    expect(keys("hr")).not.toContain("payment-requests");
    expect(keys("hr", GRANT)).toContain("payment-requests");
    // The boss already has it under Operations; one row is enough.
    expect(keys("principal", GRANT)).not.toContain("payment-requests");
  });

  it("opens the Finance page, last on the rail", () => {
    const item = HR.items.find((i) => i.key === "payment-requests")!;
    expect(navItemHref(HR, item)).toBe("/finance/payment-requests");
    expect(keys("hr", GRANT).at(-1)).toBe("payment-requests");
    expect(keys("hr", GRANT).filter((k) => k !== "payment-requests")).toEqual(keys("hr"));
  });
});
