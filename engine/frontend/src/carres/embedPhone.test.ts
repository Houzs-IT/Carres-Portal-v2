// Carres only (not part of Houzs's code): the portal's phone flag in the hand-over.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const hand = (o: object) => `#carres=${btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

async function framed() {
  vi.resetModules();
  // Inside a frame: window.top is the portal, not this window.
  Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
  return import("./embed");
}

describe("carresPhone", () => {
  beforeEach(() => sessionStorage.clear());

  it("is true after a hand-over with m: 1, and kept for a reload inside the frame", async () => {
    const embed = await framed();
    window.history.replaceState(null, "", `/${hand({ t: "tok", p: "/scm/sales-orders", m: 1 })}`);
    embed.consumeCarresSignIn();
    expect(window.location.pathname).toBe("/scm/sales-orders");
    expect(embed.carresPhone()).toBe(true);
    expect((await framed()).carresPhone()).toBe(true);
  });

  it("is null after a hand-over without it, so the app picks as Houzs does", async () => {
    sessionStorage.setItem("carres:phone", "1");
    const embed = await framed();
    window.history.replaceState(null, "", `/${hand({ t: "tok", p: "/" })}`);
    embed.consumeCarresSignIn();
    expect(embed.carresPhone()).toBeNull();
  });
});

describe("useIsMobile inside the portal on a phone", () => {
  it("follows the portal's phone shell even on a computer browser", async () => {
    sessionStorage.setItem("carres:phone", "1");
    await framed();
    const { isMobileViewportNow } = await import("../mobile/useIsMobile");
    expect(isMobileViewportNow()).toBe(true);
  });
});
