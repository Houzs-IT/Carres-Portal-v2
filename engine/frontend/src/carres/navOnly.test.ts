import { describe, expect, it } from "vitest";
import { carresNavOnly, isCarresHiddenPath } from "./navOnly";

describe("carresNavOnly", () => {
  it("keeps only the Carres areas and drops switched-off children", () => {
    const tabs = [
      { label: "Overview", to: "/" },
      { label: "Supply Chain", to: "/scm", children: [{ label: "Consignment", to: "/scm/consignment" }, { label: "HR payroll", to: "/scm/hr/payroll" }] },
      { label: "HR", to: "/scm/hr" },
      { label: "Service Cases", to: "/service-cases" },
      { label: "Projects", to: "/projects?view=hub" },
      { label: "Finance", to: "/scm/finance", children: [{ label: "To do", to: "/scm/finance" }, { label: "Dashboard", to: "/scm/finance-dashboard" }] },
      { label: "Mail Center", to: "/mail-center" },
    ];
    expect(carresNavOnly(tabs)).toEqual([
      { label: "Overview", to: "/" },
      { label: "Supply Chain", to: "/scm", children: [{ label: "Consignment", to: "/scm/consignment" }] },
      { label: "Service Cases", to: "/service-cases" },
      { label: "Projects", to: "/projects?view=hub" },
      { label: "Finance", to: "/scm/finance", children: [{ label: "To do", to: "/scm/finance" }, { label: "Dashboard", to: "/scm/finance-dashboard" }] },
    ]);
  });
  it("matches whole path segments only", () => {
    expect(isCarresHiddenPath("/scm/hr/payroll?x=1")).toBe(true);
    expect(isCarresHiddenPath("/scm/hrx")).toBe(false);
  });
  it("keeps every Houzs Finance address open (11 Nov 2026), Forecast P&L and the finance Dashboard included", () => {
    for (const p of ["/scm/finance", "/scm/forecast", "/scm/finance-dashboard", "/scm/accounting?tab=pnl", "/scm/receipts", "/scm/daily-bank?view=board"]) {
      expect(isCarresHiddenPath(p)).toBe(false);
    }
  });
});
