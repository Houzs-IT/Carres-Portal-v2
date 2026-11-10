import { describe, expect, it } from "vitest";
import { carresNavOnly, isCarresHiddenPath } from "./navOnly";

describe("carresNavOnly", () => {
  it("keeps only the Carres areas and drops switched-off children", () => {
    const tabs = [
      { label: "Overview", to: "/" },
      { label: "Supply Chain", to: "/scm", children: [{ label: "Consignment", to: "/scm/consignment" }, { label: "Forecast", to: "/scm/forecast" }] },
      { label: "HR", to: "/scm/hr" },
      { label: "Service Cases", to: "/service-cases" },
      { label: "Projects", to: "/projects?view=hub" },
    ];
    expect(carresNavOnly(tabs)).toEqual([
      { label: "Supply Chain", to: "/scm", children: [{ label: "Consignment", to: "/scm/consignment" }] },
      { label: "Service Cases", to: "/service-cases" },
      { label: "Projects", to: "/projects?view=hub" },
    ]);
  });
  it("matches whole path segments only", () => {
    expect(isCarresHiddenPath("/scm/hr/payroll?x=1")).toBe(true);
    expect(isCarresHiddenPath("/scm/hrx")).toBe(false);
  });
});
