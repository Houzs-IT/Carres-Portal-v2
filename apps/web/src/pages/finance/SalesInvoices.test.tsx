import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SalesInvoices from "./SalesInvoices";

const state = vi.hoisted(() => ({ data: [] as unknown[] | undefined, isSuccess: true, isError: false, refetch: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useInvoiceRegister: () => state }));
vi.mock("@/pages/operation/components/ModuleHeader", () => ({ default: () => null }));
vi.mock("./NewSalesInvoiceDialog", () => ({ default: () => <button>New Sales Invoice</button> }));

const order = { id: "o1", so: 123, customer_name: "Customer One", source_ref: ["REF-1"], status: "open", paid: 40,
  delivery_date: null, delivery_date_tbd: true, delivered_at: null };
const invoice = (over: object) => ({ id: "i1", invoice_no: "INV-1", status: "issued", kind: "sales", amount: 100, tax_amount: 6,
  issued_at: "2026-10-01T02:00:00Z", voided_at: null, void_reason: null, replaces_invoice_id: null,
  created_at: "2026-10-01T02:00:00Z", order_id: "o1", orders: order, ...over });

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}
const show = () => render(<MemoryRouter initialEntries={["/finance/sales-invoices"]}><SalesInvoices /><Where /></MemoryRouter>);

describe("Sales Invoices list", () => {
  it("starts with the document number and lists sales invoices only", () => {
    state.data = [invoice({}), invoice({ id: "s1", invoice_no: "STO-1", kind: "storage" })];
    show();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "").filter((t) => t.trim());
    expect(headers[0]).toContain("SI No.");
    expect(screen.getByText("INV-1")).toBeInTheDocument();
    expect(screen.queryByText("STO-1")).toBeNull();
    expect(screen.getByTestId("sales-invoices-summary")).toHaveTextContent("1 sales invoice");
  });

  it("From DO lists the order's live DOs, and Source PO the POs it names", () => {
    state.data = [invoice({ orders: { ...invoice({}).orders, source_pos: ["PO-7"],
      ops_delivery_orders: [{ do_number: "DO-1", voided_at: null }, { do_number: "DO-VOID", voided_at: "2026-10-01" }] } })];
    show();
    expect(screen.getByText("DO-1")).toBeInTheDocument();
    expect(screen.queryByText(/DO-VOID/)).toBeNull();
    expect(screen.getByText("PO-7")).toBeInTheDocument();
  });

  it("a row opens the quick view and the SI No opens the Monitor", () => {
    state.data = [invoice({})];
    show();
    fireEvent.click(screen.getByText("Customer One"));
    expect(screen.getByText("Invoice info")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: /INV-1|Open on Monitor/ })[0]!);
    expect(screen.getByTestId("where")).toHaveTextContent("/finance/monitor?invoice=i1");
  });

  it("the tiles count an order's money once, and a voided invoice bills nothing", () => {
    state.data = [invoice({}), invoice({ id: "i2", invoice_no: "INV-2" }), invoice({ id: "i3", invoice_no: "INV-3", status: "voided" })];
    show();
    expect(screen.getByTestId("si-kpi-count")).toHaveTextContent("3");
    expect(screen.getByTestId("si-kpi-billed")).toHaveTextContent("212");
    expect(screen.getByTestId("si-kpi-paid")).toHaveTextContent("40");
    expect(screen.getByTestId("si-kpi-paid")).not.toHaveTextContent("80");
  });

  it("the status tabs narrow the list", () => {
    state.data = [invoice({}), invoice({ id: "i2", invoice_no: "INV-2", status: "voided" })];
    show();
    expect(screen.getByText("INV-1")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Cancelled/ }));
    expect(screen.queryByText("INV-1")).toBeNull();
    expect(screen.getByText("INV-2")).toBeInTheDocument();
  });

  it("names a draft and a voided invoice instead of failing on them", () => {
    state.data = [invoice({ invoice_no: null, status: "draft", issued_at: null }), invoice({ id: "i2", invoice_no: "INV-2", status: "voided" })];
    show();
    expect(screen.getByText("Draft, no number yet")).toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("says so when the list cannot load, never an empty list", () => {
    Object.assign(state, { data: undefined, isError: true, isSuccess: false });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Sales Invoices could not be loaded");
    Object.assign(state, { data: [], isError: false, isSuccess: true });
  });
});
