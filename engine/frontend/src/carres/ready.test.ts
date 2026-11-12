// Carres only (not part of Houzs's code).
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstPageDrawn, reportCarresReady } from "./ready";

const PORTAL = "https://carres-portal.pages.dev";

describe("firstPageDrawn", () => {
  it("waits for <main> to hold a page that is not the route's loading shape", () => {
    const root = document.createElement("div");
    expect(firstPageDrawn(root)).toBe(false);
    root.innerHTML = "<main></main>";
    expect(firstPageDrawn(root)).toBe(false);
    root.innerHTML = '<main><div aria-busy="true" aria-label="Loading page"></div></main>';
    expect(firstPageDrawn(root)).toBe(false);
    root.innerHTML = "<main><h1>Sales Orders</h1></main>";
    expect(firstPageDrawn(root)).toBe(true);
  });
});

describe("reportCarresReady", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ""; });

  it("tells the portal once, after the first page replaces the loading shape", async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const root = document.createElement("div");
    document.body.appendChild(root);
    reportCarresReady(root, PORTAL);
    root.innerHTML = '<main><div aria-label="Loading page"></div></main>';
    await Promise.resolve();
    vi.runAllTimers();
    expect(post).not.toHaveBeenCalled();

    root.innerHTML = "<main><h1>Sales Orders</h1></main>";
    await Promise.resolve();
    vi.runAllTimers();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "carres:ready" }, PORTAL);

    root.innerHTML = "<main><h1>Another page</h1></main>";
    await Promise.resolve();
    vi.runAllTimers();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside the portal", () => {
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const root = document.createElement("div");
    root.innerHTML = "<main><h1>Sales Orders</h1></main>";
    reportCarresReady(root, null);
    expect(post).not.toHaveBeenCalled();
  });
});
