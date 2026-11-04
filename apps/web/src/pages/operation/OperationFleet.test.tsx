/** Last Mile Delivery draws one card per lorry, each with its stops and their delivery result. */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { FleetDayPage } from "./OperationFleet";

vi.mock("./components/ModuleHeader", () => ({ default: () => null }));
vi.mock("./fleet", async () => {
  const actual = await vi.importActual<typeof import("./fleet")>("./fleet");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const stop = (orderId: string, so: number, status: "delivered" | "scheduled", customerName: string) => ({
    day, vehicleId: "v1", plate: "WXY 1", orderId, leg: 1, so, customerName, customerPhone: null,
    customerAddress: null, confirmedTime: null, expectedArrival: null, revenue: 100, doNumber: `DO-${so}`, status,
  });
  const data = {
    company: { id: "c", name: "Carres Lorries" },
    lorries: [{ id: "v1", plate: "WXY 1", vehicleType: "3 ton", capacity: null, active: true, templateDriverName: null, templateDriverPhone: null,
      puspakomDue: null, roadTaxDue: null, insuranceDue: null, serviceDue: null }],
    crew: [], leave: [], crewDays: [], positions: [],
    stops: [stop("o1", 11, "delivered", "Ali"), stop("o2", 12, "scheduled", "Bala")],
  };
  return {
    ...actual,
    useFleet: () => ({ data, isSuccess: true, isError: false }),
    useFleetWrite: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

describe("FleetDayPage", () => {
  it("shows a lorry card with its stops, their result and the run status", () => {
    render(<FleetDayPage />);
    const card = screen.getByTestId("fleet-card-v1");
    expect(within(card).getByText("Ali")).toBeTruthy();
    expect(within(card).getByText("SO-11 · DO-11")).toBeTruthy();
    expect(within(card).getByText("Out for delivery")).toBeTruthy();
    expect(within(card).getByTestId("fleet-card-v1-progress").textContent).toBe("1 of 2 delivered");
  });

  it("narrows the stops by search", () => {
    render(<FleetDayPage />);
    fireEvent.change(screen.getByPlaceholderText("Customer, SO No, DO No or phone"), { target: { value: "bala" } });
    const card = screen.getByTestId("fleet-card-v1");
    expect(within(card).queryByText("Ali")).toBeNull();
    expect(within(card).getByText("Bala")).toBeTruthy();
  });
});
