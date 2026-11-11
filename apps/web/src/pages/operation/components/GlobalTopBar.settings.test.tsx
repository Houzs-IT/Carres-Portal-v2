import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("@/lib/queries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");
  return { ...actual, useOperationOrders: () => ({ data: { orders: [] } }) };
});
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ tasks: [] }) }));
vi.mock("./JumpTo", () => ({ default: () => null }));

import { TopBarIcons } from "./GlobalTopBar";

/**
 * The top bar's Settings launcher. The Carres Settings workspace is removed (owner, 11 Nov 2026): on an
 * Operations page it offers only All System Settings, which opens Houzs's own Settings; a Finance page keeps
 * Finance Settings first.
 */
function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={qc}>
        <TopBarIcons />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the Settings launcher", () => {
  it.each(["/operation?tab=work", "/operation/sc/orders", "/operation/orders"])("offers only All System Settings on %s", (entry) => {
    renderAt(entry);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const menu = screen.getByTestId("settings-launcher");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["All System Settings"]);
  });

  it("All System Settings opens Houzs's own Settings", () => {
    renderAt("/operation?tab=work");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "All System Settings" }));
    expect(navigate).toHaveBeenCalledWith("/operation/sc/settings");
  });

  it("offers Finance Settings on a Finance page, and it opens the money accounts", () => {
    renderAt("/finance/payment-vouchers");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Finance Settings" }));
    expect(navigate).toHaveBeenCalledWith("/finance/settings");
  });
});
