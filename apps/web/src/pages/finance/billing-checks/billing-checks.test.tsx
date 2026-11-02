import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import NotYetBilledPage, { ageDays } from "./NotYetBilledPage";
import CorrectionsPage from "./CorrectionsPage";

const net = vi.hoisted(() => ({ calls: [] as string[], answer: {} as unknown, fail: false }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    net.calls.push(path);
    if (net.fail) throw new Error("boom");
    return net.answer;
  }),
}));
vi.mock("@/pages/operation/components/GlobalTopBar", () => ({ TopBarIcons: () => null }));

function mount(page: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { net.calls = []; net.fail = false; net.answer = { rows: [] }; });

describe("Not Yet Billed", () => {
  const ROW = {
    order_id: "o1", so: 1375, customer_name: "Amy Tan", customer_phone: null, salesperson: "Lee", do_numbers: ["DO2610-6753"],
    delivered_at: "2026-10-30T02:00:00Z", delivered_value: 500, already_billed: 100, not_billed: 400,
  };

  it("counts age in whole days, and says nothing without a date", () => {
    expect(ageDays("2026-10-30T02:00:00Z", "2026-11-02")).toBe(3);
    expect(ageDays(null, "2026-11-02")).toBeNull();
  });

  it("lists the order, its DO and the money left to bill", async () => {
    net.answer = { rows: [ROW] };
    mount(<NotYetBilledPage />);
    expect(await screen.findByRole("link", { name: "SO-1375" })).toHaveAttribute("href", "/operation/orders/so/o1");
    expect(screen.getByText("DO2610-6753")).toBeInTheDocument();
    expect(within(screen.getByTestId("not-yet-billed-summary")).getByText(/1 order/)).toBeInTheDocument();
    expect(document.title).toBe("Not Yet Billed · Carres");
  });

  it("a failed read says so and shows no figures", async () => {
    net.fail = true;
    mount(<NotYetBilledPage />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByTestId("nyb-kpi-not-billed")).not.toBeInTheDocument();
  });
});

describe("Corrections", () => {
  it("reads one month and shows what was done and why", async () => {
    net.answer = { rows: [{
      id: "v1", kind: "void", at: "2026-10-09T02:00:00Z", by: "Chew", order_id: "o1", so: 11, customer_name: "Amy",
      receipt_no: "R-2", what: "Payment voided: RM 1,250.00", reason: "Bounced", recorded_by: "Aina", recorded_on: "2026-10-02T02:00:00Z",
    }] };
    mount(<CorrectionsPage />);
    expect(await screen.findByText("Payment voided: RM 1,250.00")).toBeInTheDocument();
    expect(screen.getByText("Bounced")).toBeInTheDocument();
    expect(net.calls[0]).toMatch(/^\/api\/finance\/corrections\?month=\d{4}-\d{2}$/);
  });
});
