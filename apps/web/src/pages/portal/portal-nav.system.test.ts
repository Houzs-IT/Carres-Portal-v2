import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ENGINE_PAGES,
  OPERATION_MENU_GROUPS,
  PORTAL_MODULES,
  PORTAL_NAV,
  engineAddressFor,
  engineFor,
  engineRowFor,
  menuGroups,
  navItemHref,
  roleMayOpenEngineRow,
} from "./portal-nav";

/**
 * Every Houzs menu entry the engine keeps has a portal row (owner: the menu is the same as Houzs's, except the
 * modules the owner removed). Before 12 Nov 2026 Announcements, the IT group (System Health, AI Usage), Change Log,
 * Assistant, Agent Console and OCR were served and allowed by the engine but had no row, so nobody could reach them.
 */

const OPERATIONS = PORTAL_NAV.find((g) => g.area === "operation")!;
const here = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = join(here, "..", "..", "..", "..", "..", "engine", "frontend", "src");

/** The top-level Houzs entries the Carres engine keeps (engine/frontend/src/carres/navOnly.ts KEEP). */
function engineKeep(): string[] {
  const src = readFileSync(join(ENGINE_SRC, "carres", "navOnly.ts"), "utf8");
  const body = /const KEEP = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const NEW_ROWS: Array<[key: string, label: string, page: string]> = [
  ["announcements", "Announcements", "/announcements"],
  ["system-health", "System Health", "/system-health"],
  ["ai-usage", "AI Usage", "/ai-usage"],
  ["change-log", "Change Log", "/change-log"],
  ["assistant", "Assistant", "/assistant"],
  ["agent-console", "Agent Console", "/agents"],
  ["ocr", "OCR", "/ocr"],
];

describe("the Houzs System rows the engine keeps", () => {
  it("every top-level entry in the engine's KEEP list has a place in the portal menu", () => {
    const keep = engineKeep();
    expect(keep.length).toBeGreaterThan(10);
    const places = new Set<string>([
      ...OPERATIONS.items.map((i) => i.label),
      ...PORTAL_MODULES.map((m) => m.label),
      ...OPERATION_MENU_GROUPS.flatMap((g) => (g.row ? [g.row.label] : [])),
      // The Settings gear at the bottom of the menu opens Houzs's Settings (ENGINE_SETTINGS_HREF).
      "Settings",
    ]);
    for (const label of keep) expect(places.has(label), label).toBe(true);
  });

  it("each new row has Houzs's word, links to its own address and resolves to its engine page", () => {
    for (const [key, label, page] of NEW_ROWS) {
      const item = OPERATIONS.items.find((i) => i.key === key);
      expect(item?.label, key).toBe(label);
      expect(navItemHref(OPERATIONS, item!), key).toBe(`/operation/sc/${key}`);
      expect(engineFor(`/operation/sc/${key}`), key).toBe(page);
      expect(engineRowFor(page), key).toBe(key);
      expect(engineAddressFor(page), key).toBe(`/operation/sc/${key}`);
    }
  });

  it("a page under a new row (a record, a sub-route) lights that row and keeps the page in ?at=", () => {
    for (const [key, , page] of NEW_ROWS) {
      const sub = `${page}/sub-1?x=1`;
      expect(engineRowFor(sub), key).toBe(key);
      expect(engineAddressFor(sub), key).toBe(`/operation/sc/${key}?at=${encodeURIComponent(sub)}`);
      expect(engineFor(`/operation/sc/${key}`, `?at=${encodeURIComponent(sub)}`), key).toBe(sub);
    }
    // Whole segments only: /ocr-something is not under /ocr.
    expect(engineRowFor("/ocrx")).toBeNull();
  });

  it("the IT module carries System Health and AI Usage, as Houzs's IT group does, and only opens and shuts", () => {
    const it_ = PORTAL_MODULES.find((m) => m.section === "IT");
    expect(it_?.label).toBe("IT");
    expect(it_?.handleOnly).toBe(true);
    const system = menuGroups(OPERATIONS, "principal").find((g) => g.label === "System")!;
    const itBlock = system.blocks.find((b) => b.kind === "module" && b.module.section === "IT");
    expect(itBlock && itBlock.kind === "module" && itBlock.pages.map((p) => p.key)).toEqual(["system-health", "ai-usage"]);
  });

  it("the roles that open the System rows open the new rows; Houzs's own gates stay inside the engine", () => {
    for (const [key] of NEW_ROWS) {
      for (const role of ["operation", "principal", "hr"] as const) expect(roleMayOpenEngineRow(role, key), `${role} ${key}`).toBe(true);
      expect(roleMayOpenEngineRow("finance", key), key).toBe(false);
      expect(roleMayOpenEngineRow("dealer", key), key).toBe(false);
    }
  });

  it("the modules the owner removed stay out: HR, AutoCount Sync, POS Admin, Venture Portal Feed", () => {
    const labels = OPERATIONS.items.map((i) => i.label);
    for (const label of ["HR", "Employees & Attendance", "Commission", "HR Settings", "AutoCount Sync", "POS Admin", "Venture Portal Feed"]) {
      expect(labels, label).not.toContain(label);
    }
    const pages = Object.values(ENGINE_PAGES).map((p) => p.split("?")[0]);
    for (const removed of ["/hr/employees", "/scm/hr", "/scm/hr/commission", "/autocount-sync", "/pos-admin", "/venture-portal-feed"]) {
      expect(pages, removed).not.toContain(removed);
    }
    // No row of their own (an `/scm/hr` address falls under the Supply Chain hub, and the engine sends it home).
    for (const removed of ["/hr/employees", "/autocount-sync", "/pos-admin", "/venture-portal-feed"]) {
      expect(engineRowFor(removed), removed).toBeNull();
    }
    expect(engineRowFor("/scm/hr/commission")).toBe("hub-scm");
    // Houzs's Sales Entries (/sales) is commented out of Houzs's own menu, so it has no row here either.
    expect(engineRowFor("/sales")).toBeNull();
  });
});
