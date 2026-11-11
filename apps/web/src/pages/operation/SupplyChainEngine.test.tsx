import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";
import { resetEngineSessionForTests } from "@/lib/engine-session";
import SupplyChainEngine, { FRAME_READY_TIMEOUT_MS, engineFrameSrc, enginePath } from "./SupplyChainEngine";

beforeEach(() => {
  sessionStorage.clear();
  resetEngineSessionForTests();
});

describe("engineFrameSrc", () => {
  it("puts the session in the fragment, never the query", () => {
    const src = engineFrameSrc({ site: "https://scm.test", token: "tok", sessionPass: null }, "/scm");
    expect(src.startsWith("https://scm.test/#carres=")).toBe(true);
    const json = atob(src.split("#carres=")[1].replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(json)).toEqual({ t: "tok", p: "/scm" });
  });
});

describe("enginePath", () => {
  it("takes an engine address and refuses anything that could leave the engine", () => {
    expect(enginePath("/scm/purchase-orders")).toBe("/scm/purchase-orders");
    expect(enginePath("//evil.example")).toBe("/scm/sales-orders");
    expect(enginePath("https://evil.example")).toBe("/scm/sales-orders");
    expect(enginePath(null)).toBe("/scm/sales-orders");
  });
});

describe("the frame's location report", () => {
  const site = "https://scm.test";
  const report = (path: string) =>
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: site, data: { type: "carres:location", path } })); });

  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(apiFetch).mockResolvedValue({ site, token: "tok", sessionPass: null });
    // The Supply Chain row, not the Consignment row: both open /scm/product-requests.
    window.history.replaceState(null, "", "/operation/sc/product-request");
  });

  async function open() {
    const view = render(<SupplyChainEngine path="/scm/product-requests" />);
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
  }

  it("keeps the clicked row's address when the frame reports the page that address already shows", async () => {
    await open();
    report("/scm/product-requests");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("follows the frame when it moves to a different page", async () => {
    await open();
    report("/scm/product-requests/123");
    expect(navigate).toHaveBeenCalledWith(
      `/operation/sc/product-requests?at=${encodeURIComponent("/scm/product-requests/123")}`,
      { replace: true },
    );
  });
});

describe("one loading state, and the session kept for the tab", () => {
  const site = "https://scm.test";
  const say = (type: string) =>
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: site, data: { type } })); });
  let n = 0;

  beforeEach(() => {
    n = 0;
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async () => ({ site, token: `tok${++n}`, sessionPass: null }));
  });
  afterEach(() => { vi.useRealTimers(); });

  const frameOf = (c: HTMLElement) => c.querySelector("iframe");
  const skeletonOf = (c: HTMLElement) => c.querySelector('[data-testid="kit-loading-skeleton"]');
  // The frame is on screen, and its effects (message listener, timeout) are in place.
  const opened = async (c: HTMLElement) => {
    await waitFor(() => expect(frameOf(c)).not.toBeNull());
    await act(async () => {});
  };
  const tokenIn = (src: string) =>
    JSON.parse(atob(src.split("#carres=")[1].replace(/-/g, "+").replace(/_/g, "/"))).t as string;

  it("keeps the skeleton over the loading frame until the engine says its first page is drawn", async () => {
    const view = render(<SupplyChainEngine path="/scm/sales-orders" />);
    await opened(view.container);
    expect(skeletonOf(view.container)).not.toBeNull();
    expect(frameOf(view.container)!.className).toContain("opacity-0");
    expect(frameOf(view.container)!.getAttribute("aria-hidden")).toBe("true");

    // Only the engine's own origin can say it is ready.
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: { type: "carres:ready" } })); });
    expect(skeletonOf(view.container)).not.toBeNull();

    say("carres:ready");
    expect(skeletonOf(view.container)).toBeNull();
    expect(frameOf(view.container)!.className).not.toContain("opacity-0");
    expect(frameOf(view.container)!.getAttribute("aria-hidden")).toBeNull();
  });

  it("shows the frame anyway when the engine never says it is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = render(<SupplyChainEngine path="/scm/sales-orders" />);
    await opened(view.container);
    act(() => { vi.advanceTimersByTime(FRAME_READY_TIMEOUT_MS - 100); });
    expect(skeletonOf(view.container)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(skeletonOf(view.container)).toBeNull();
    expect(FRAME_READY_TIMEOUT_MS).toBe(15_000);
  });

  it("opens the frame straight away from the session already in hand, with no second request", async () => {
    const first = render(<SupplyChainEngine path="/scm/sales-orders" />);
    await opened(first.container);
    first.unmount();
    const again = render(<SupplyChainEngine path="/scm/purchase-orders" />);
    expect(frameOf(again.container)).not.toBeNull(); // first render, nothing awaited
    expect(tokenIn(frameOf(again.container)!.src)).toBe("tok1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("asks for one new session when the engine refuses the one in hand, then shows the failure", async () => {
    const view = render(<SupplyChainEngine path="/scm/sales-orders" />);
    await opened(view.container);
    expect(tokenIn(frameOf(view.container)!.src)).toBe("tok1");

    say("carres:signed-out");
    await waitFor(() => expect(tokenIn(frameOf(view.container)!.src)).toBe("tok2"));
    await act(async () => {});
    expect(skeletonOf(view.container)).not.toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(2);

    say("carres:signed-out");
    await waitFor(() => expect(view.getByText("Supply Chain could not be opened. Try again.")).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes again after a later refusal once the frame had been ready", async () => {
    const view = render(<SupplyChainEngine path="/scm/sales-orders" />);
    await opened(view.container);
    say("carres:signed-out");
    await waitFor(() => expect(tokenIn(frameOf(view.container)!.src)).toBe("tok2"));
    await act(async () => {});
    say("carres:ready");
    say("carres:signed-out");
    await waitFor(() => expect(tokenIn(frameOf(view.container)!.src)).toBe("tok3"));
  });
});
