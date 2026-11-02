/**
 * OVERTURNED 2026-10-22 by Weisiang (Mr Lim): office staff may create Sales
 * Orders (Houzs way). The office page feeds the SAME engine the Sales Portal
 * uses — `POST /api/orders` → `create_order_from_sales_portal` — so the body it
 * builds must pass the Sales Portal's own `createOrderInputSchema`.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createOrderInputSchema } from "@carres/shared";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", async () => ({
  ...(await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries")),
  useOutlets: () => ({ data: { outlets: [] }, isPending: false }),
  useSalespersons: () => ({ data: { salespersons: [] }, isPending: false }),
  useCatalog: () => ({ data: undefined, isPending: false }),
  useCreateOrder: () => ({ mutateAsync: mutate, isPending: false }),
}));
import OperationNewSalesOrder, { buildOfficeOrder, copyOfficeForm, emptyOfficeForm, type OfficeForm } from "./OperationNewSalesOrder";

const DEALER = "00000000-0000-4000-8000-0000000000d1";
const OUTLET = "00000000-0000-4000-8000-0000000000a1";
const SP = "00000000-0000-4000-8000-0000000000c1";

function filled(): OfficeForm {
  return {
    ...emptyOfficeForm(),
    outletId: OUTLET,
    salespersonId: SP,
    name: "TEST Customer",
    phone: "012-3456789",
    emergencyName: "TEST Kin",
    emergencyPhone: "019-8765432",
    line1: "1 Jalan Test",
    city: "Petaling Jaya",
    postcode: "47400",
    state: "Selangor",
    buildingType: "Condo",
    floor: "3",
    hasLift: "yes",
    deliveryDate: "2026-11-20",
    proceedDate: "2026-11-01",
    lines: [{ key: "a", sku: "TEST-SKU", qty: "2", unitPrice: "1500" }],
    paymentMethod: "cash",
    paid: "500",
    termsAccepted: true,
  };
}

describe("buildOfficeOrder", () => {
  it("builds a body the Sales Portal engine accepts, placed under the outlet's dealer", () => {
    const body = buildOfficeOrder(filled(), { dealerId: DEALER, signaturePath: `orders-attachments/${DEALER}/s/signature.png` });
    const parsed = createOrderInputSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.dealerId).toBe(DEALER);
    expect(body.customer.address).toBe("1 Jalan Test, Petaling Jaya 47400, Selangor");
    expect(body.customer.emergency).toBe("TEST Kin · 019-8765432");
    expect(body.delivery).toMatchObject({ date: "2026-11-20", proceedDate: "2026-11-01", dateTbd: false, floor: 3, hasLift: true });
    expect(body.lines).toEqual([{ sku: "TEST-SKU", qty: 2, attrs: null, unitPrice: 1500 }]);
    expect(body.entryData?.fields?.building_type).toBe("Condo");
    expect(body.depositPct).toBe(17);
    expect(body.installmentMonths).toBeNull();
  });

  it("an installment order carries its term, so the engine accepts it", () => {
    const f = { ...filled(), paymentMethod: "installment", approvalCode: "APP123", installmentMonths: "12" };
    const body = buildOfficeOrder(f, { dealerId: DEALER, signaturePath: `orders-attachments/${DEALER}/s/signature.png` });
    expect(body.installmentMonths).toBe(12);
    expect(createOrderInputSchema.safeParse(body).success).toBe(true);
    expect(buildOfficeOrder({ ...f, paymentMethod: "cash" }, { dealerId: DEALER, signaturePath: "x" }).installmentMonths).toBeNull();
  });

  it("an empty form is refused by the same engine rules", () => {
    const body = buildOfficeOrder(emptyOfficeForm(), { dealerId: DEALER, signaturePath: "" });
    expect(createOrderInputSchema.safeParse(body).success).toBe(false);
  });
});

describe("OperationNewSalesOrder", () => {
  it("refuses an incomplete order before anything is uploaded or sent", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <OperationNewSalesOrder />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create order" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("Copy as new", () => {
  const source = {
    order: {
      so: 1375, outlet_id: "o1", salesperson_id: "s1", customer_name: "Tan", customer_phone: "0123",
      customer_emergency: "Lim · 0456 · Wife", customer_address_line1: "1 Jalan", customer_address_line2: "Taman",
      customer_address_city: "KL", customer_address_postcode: "50000", customer_address_state: "Selangor",
      entry_data: { fields: { building_type: "Condo" } }, delivery_floor: 3, delivery_has_lift: true,
      delivery_date: "2026-11-01", paid: 500, payment_method: "cash",
    },
    lines: [
      { id: "1", sku: "PLAIN", qty: 2, unit_price: 100, attrs: null },
      { id: "2", sku: "SOFA", qty: 1, unit_price: 900, attrs: { fabric: "F1" } },
      { id: "3", sku: "GONE", qty: 1, unit_price: 50, attrs: null },
    ],
    addons: [{ addon_key: "stair_carry", qty: 1, unit_price: 20 }],
  } as unknown as Parameters<typeof copyOfficeForm>[0];

  it("copies the customer and plain lines, never the dates, money or signature", () => {
    const { form } = copyOfficeForm(source, new Set(["PLAIN", "SOFA"]));
    expect(form).toMatchObject({
      outletId: "o1", name: "Tan", emergencyName: "Lim", emergencyPhone: "0456", line1: "1 Jalan, Taman",
      buildingType: "Condo", floor: "3", hasLift: "yes",
      deliveryDate: null, proceedDate: null, paymentMethod: "", paid: "0", signature: null, termsAccepted: false,
    });
    expect(form.lines.map((l) => [l.sku, l.qty, l.unitPrice])).toEqual([["PLAIN", "2", "100"]]);
  });
  it("names what it could not carry: a configured line, a SKU off sale, an add-on", () => {
    expect(copyOfficeForm(source, new Set(["PLAIN", "SOFA"])).leftOut).toEqual(["SOFA", "GONE", "stair_carry"]);
  });
});
