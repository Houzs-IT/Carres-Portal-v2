// Carres only (not part of Houzs's code).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

/* Inside the portal, Houzs's own top bar is the one top row (owner, 11 Nov 2026): tabs, search, Refresh,
   presence and the bell, as in Houzs; the company switcher and profile menu stay out. */
describe("Houzs's top bar inside the Carres portal", () => {
  it("Layout draws the top bar when embedded, telling it so", () => {
    const layout = read("components/Layout.tsx");
    expect(layout).toContain("<TopNavbar embedded={CARRES_EMBEDDED} />");
    expect(layout).not.toContain("!CARRES_EMBEDDED && <TopNavbar");
  });

  it("the embedded bar keeps tabs, search, Refresh, presence and the bell, and leaves out company and profile", () => {
    const bar = read("components/TopNavbar.tsx");
    for (const kept of ["<WorkspaceTabs />", "<GlobalSearchTrigger", "<RefreshButton />", "<PresenceButton />", "<NotificationBell"]) {
      expect(bar).toContain(kept);
    }
    expect(bar).toContain("{!embedded && <CompanySwitcher />}");
    expect(bar).toMatch(/\{!embedded && \(\s*<>\s*<span[^>]*\/>\s*<ProfileMenu \/>/);
  });
});
