import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LogisticOverview } from "./LogisticOverview";

const feed = {
  orders: [
    { id: "o1", so: 1, customer_name: "A", customer_phone: null, delivery_date: "2020-01-01", delivery_date_tbd: false, customer_address: null, customer_address_line1: null, customer_address_city: null, customer_address_state: "Selangor", customer_address_postcode: null, entry_data: null, order_lines: [{ qty: 2, unit_price: 50 }], order_addons: [] },
  ],
  arrangements: [], deliveryOrders: [], regions: [], residenceRules: [], companies: [],
};
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: async () => feed };
});
vi.mock("@/lib/queries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");
  return { ...actual, useDeliveryOrdersRegister: () => ({ data: { deliveryOrders: [], attempts: [], handoverEvents: [] }, isError: false, refetch: vi.fn() }) };
});

describe("LogisticOverview", () => {
  it("puts an open order past its date in the due table, with its amount and its missing phone", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><LogisticOverview /></MemoryRouter>
      </QueryClientProvider>,
    );
    const due = await screen.findByTestId("logistic-overview-due");
    const past = await within(due).findByRole("row", { name: /Past delivery date 1/ });
    expect(past.textContent).toMatch(/100/);
    expect(screen.getByTestId("logistic-overview-gaps")).toHaveTextContent("1 of 1");
  });
});
