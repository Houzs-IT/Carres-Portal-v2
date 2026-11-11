// Carres only (not part of Houzs's code): the Carres menu trim keeps Houzs's menu except the removed modules.
import { describe, expect, it } from "vitest";
import { ALL_NAV_TABS, NAV_TABS } from "../components/Sidebar";
import { CARRES_EXTRAS, isCarresHiddenPath } from "./navOnly";

/** Houzs top-level entries the Carres engine leaves out, and why (navOnly.ts KEEP). */
const LEFT_OUT = new Set(["HR", "AutoCount Sync", "POS Admin", "Venture Portal Feed"]);

describe("Carres menu = Houzs menu minus the removed modules", () => {
  it("every Houzs top-level entry is either kept or named as left out, so a new Houzs entry forces a decision", () => {
    const kept = new Set(NAV_TABS.map((t) => t.label));
    for (const t of ALL_NAV_TABS) {
      expect(kept.has(t.label) || LEFT_OUT.has(t.label), `Houzs menu entry "${t.label}" is neither kept nor left out`).toBe(true);
    }
    for (const label of LEFT_OUT) expect(kept.has(label)).toBe(false);
  });

  it("keeps Finance (the portal's Houzs Finance menu and the report list read it)", () => {
    expect(NAV_TABS.some((t) => t.label === "Finance")).toBe(true);
  });

  it("opens forecast and the finance dashboard; HR, AutoCount and POS admin stay closed", () => {
    expect(isCarresHiddenPath("/scm/forecast")).toBe(false);
    expect(isCarresHiddenPath("/scm/finance-dashboard")).toBe(false);
    for (const p of ["/scm/hr", "/scm/hr/payroll", "/autocount-sync", "/pos-admin"]) expect(isCarresHiddenPath(p)).toBe(true);
  });

  it("shows the assistant button, as Houzs does", () => {
    expect(CARRES_EXTRAS).toBe(true);
  });
});
