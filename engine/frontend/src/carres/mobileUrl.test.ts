// Carres only (not part of Houzs's code): Houzs's phone app inside the portal keeps the address in step.
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./embed", () => ({ CARRES_EMBEDDED: true }));
import { destinationScreen } from "../mobile/MobileApp";
import { carresScreenPath, carresTabFor, useCarresMobileUrl } from "./mobileUrl";

const destinations = [
  { to: "/scm/sales-orders", label: "Sales Orders" },
  { to: "/scm/purchase-orders", label: "Purchase Orders" },
  { to: "/scm/delivery-planning", label: "Last Mile Delivery" },
  { to: "/projects", label: "Projects" },
  { to: "/team?tab=members", label: "Members" },
];
const path = (tab: Parameters<typeof carresScreenPath>[0], screen: Parameters<typeof carresScreenPath>[1]) =>
  carresScreenPath(tab, screen, destinations, destinationScreen);

describe("carresScreenPath — the address of the screen on show", () => {
  it("gives each bottom tab its Houzs address", () => {
    expect(path("orders", { t: "tab" })).toBe("/scm/sales-orders");
    expect(path("service", { t: "tab" })).toBe("/assr");
    expect(path("calendar", { t: "tab" })).toBe("/projects?view=calendar");
    expect(path("profile", { t: "tab" })).toBe("/profile");
  });

  it("gives a sales order its own address", () => {
    expect(path("orders", { t: "so-detail", docNo: "SO 1/2" })).toBe("/scm/sales-orders/SO%201%2F2");
  });

  it("gives a module's list, record and form the module's address", () => {
    expect(path("orders", { t: "module", key: "mfg-purchase-orders" })).toBe("/scm/purchase-orders");
    expect(path("orders", { t: "module-detail", key: "mfg-purchase-orders" })).toBe("/scm/purchase-orders");
    expect(path("orders", { t: "module-form", key: "members" })).toBe("/team?tab=members");
  });

  it("gives a menu screen its row's address", () => {
    expect(path("orders", { t: "delivery-planning" })).toBe("/scm/delivery-planning");
    expect(path("orders", { t: "pms" })).toBe("/projects");
  });

  it("leaves the address alone for a screen with none of its own", () => {
    expect(path("orders", { t: "scan" })).toBeNull();
    expect(path("orders", { t: "search" })).toBeNull();
    expect(path("orders", { t: "stub" })).toBeNull();
  });
});

describe("carresTabFor", () => {
  it("reads the tab addresses the phone app's own reading opens elsewhere", () => {
    expect(carresTabFor("/projects?view=calendar")).toBe("calendar");
    expect(carresTabFor("/assr?view=cases")).toBe("service");
    expect(carresTabFor("/projects?view=list")).toBeNull();
    expect(carresTabFor("/scm/sales-orders")).toBeNull();
  });
});

describe("useCarresMobileUrl", () => {
  beforeEach(() => window.history.replaceState(null, "", "/scm/sales-orders"));
  afterEach(() => vi.restoreAllMocks());

  it("writes nothing for the first screen, then adds a step for each move", () => {
    const push = vi.spyOn(window.history, "pushState");
    const open = vi.fn();
    const view = renderHook(({ p }) => useCarresMobileUrl(p, open), { initialProps: { p: "/scm/sales-orders" as string | null } });
    expect(push).not.toHaveBeenCalled();
    view.rerender({ p: "/scm/purchase-orders" });
    expect(window.location.pathname).toBe("/scm/purchase-orders");
    expect(push).toHaveBeenCalledTimes(1);
    view.rerender({ p: null });
    expect(window.location.pathname).toBe("/scm/purchase-orders");
  });

  it("opens the address's screen on Back or the portal's menu, and corrects the address in place", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    let p: string | null = "/scm/sales-orders";
    const open = vi.fn(() => { p = "/scm/sales-orders"; });
    const view = renderHook(() => useCarresMobileUrl(p, open));
    p = "/scm/purchase-orders";
    view.rerender();
    push.mockClear();
    window.history.pushState(null, "", "/");
    push.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(open).toHaveBeenCalledWith("/");
    view.rerender();
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith(null, "", "/scm/sales-orders");
  });

  it("reopens the Calendar tab after a refresh on its address", () => {
    window.history.replaceState(null, "", "/projects?view=calendar");
    const open = vi.fn();
    renderHook(() => useCarresMobileUrl("/projects", open));
    expect(open).toHaveBeenCalledWith("/projects?view=calendar");
  });
});
