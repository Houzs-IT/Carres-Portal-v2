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
const ASKS = {
  count: 7,
  asks: [
    { id: "p1", requestNo: "CR-PKR-2611-001", supplierName: "RED SOFA", kind: "date", askDate: "2026-11-26", expectedDate: "2026-11-20", askedAt: "2026-11-17T01:00:00Z" },
    { id: "p2", requestNo: "CR-PKR-2611-002", supplierName: "BLUE BED", kind: "cancel", askDate: null, expectedDate: "2026-11-21", askedAt: "2026-11-17T02:00:00Z" },
  ],
};
const apiFetch = vi.fn(async (path: string) => (path === "/api/operation/scm-engine/supplier-asks" ? ASKS : { tasks: [] }));
vi.mock("@/lib/api", () => ({ apiFetch: (path: string) => apiFetch(path) }));
vi.mock("./JumpTo", () => ({ default: () => null }));

import { TopBarIcons } from "./GlobalTopBar";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/fmt-date";

/**
 * A supplier's ask (a new pickup day, or a cancel) changes nothing until Carres approves it in Supplier Pickups, so
 * the people who answer it see it on the Alerts bell (owner, 17 Nov 2026). Each row opens Supplier Pickups on its
 * `Asked by supplier` tab with that request open.
 */
function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/operation/sc/orders"]}>
      <QueryClientProvider client={qc}>
        <TopBarIcons />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the supplier asks on the Alerts bell", () => {
  it("counts every waiting ask on the bell and lists the oldest, each opening its request", async () => {
    useAuth.setState({ role: "operation" });
    renderBell();
    const bell = screen.getByRole("button", { name: "Alerts" });
    expect(await within(bell).findByText("7")).toBeTruthy();
    fireEvent.click(bell);
    expect(screen.getByText("Asked by supplier")).toBeTruthy();
    // The portal's one date format, the way every other date on the portal is written.
    expect(screen.getByText(`Move to ${fmtDate("2026-11-26")}`)).toBeTruthy();
    expect(screen.getByText("Cancel pickup")).toBeTruthy();
    // Seven wait, two are listed here: the rest are counted.
    expect(screen.getByText("+5 more")).toBeTruthy();
    fireEvent.click(screen.getByText("CR-PKR-2611-002"));
    expect(navigate).toHaveBeenCalledWith(
      `/operation/sc/supplier-pickups?at=${encodeURIComponent("/scm/supplier-pickups?tab=asked&open=p2")}`,
    );
  });

  it("is not asked for, and not shown, for a role that does not answer asks", async () => {
    useAuth.setState({ role: "finance" });
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    expect(screen.queryByText("Asked by supplier")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalledWith("/api/operation/scm-engine/supplier-asks");
  });
});
