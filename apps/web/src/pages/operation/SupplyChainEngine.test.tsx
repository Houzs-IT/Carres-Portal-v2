import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";
import SupplyChainEngine, { engineFrameSrc, enginePath } from "./SupplyChainEngine";

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
