import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn(async (_p: string, _i?: RequestInit): Promise<unknown> => ({})));
vi.mock("@/lib/api", async () => ({ ...(await vi.importActual<object>("@/lib/api")), apiFetch: (p: string, i?: RequestInit) => api(p, i) }));
vi.mock("@/pages/operation/components/ModuleHeader", () => ({ default: () => null }));

import { StockAdjustments, StockTakes, StockTransfers } from "./WarehouseStockMoves";

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const sites = { sites: [{ id: "s1", name: "Main" }, { id: "s2", name: "Shop" }] };
const unit = (n: number) => ({ id: `u${n}`, unit_code: `U${n}`, sku: "SKU", status: "in_stock", reserved_ref: null, needs_repair: false });
const posts = () => api.mock.calls.filter(([, i]) => i?.method === "POST");

beforeEach(() => api.mockReset());
afterEach(cleanup);

describe("Stock Take", () => {
  const detail = (blind: boolean) => ({
    count: { id: "c1", count_no: "ST1", blind, status: "open", extras: [] },
    units: [1, 2, 3].map((n) => ({ found: null, ops_stock_items: { id: `u${n}`, unit_code: `U${n}`, sku: "SKU" } })),
    foundCodes: [],
  });
  const open = async (blind: boolean) => {
    api.mockImplementation(async (path: unknown) => { const p = String(path); return p.endsWith("/sites") ? sites
      : p.endsWith("/counts") ? { counts: [{ id: "c1", count_no: "ST1", warehouse_id: "s1", blind, note: null, status: "open", created_at: "2026-10-30", posted_at: null, stock_adjustments: [] }] }
      : detail(blind); });
    wrap(<StockTakes />);
    fireEvent.click(await screen.findByText("ST1"));
  };

  it("blind box keeps the Enter a scanner sends", async () => {
    await open(true);
    const box = (await screen.findByLabelText(/Unit IDs counted/)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "U1\n" } });
    expect(box.value).toBe("U1\n");
    fireEvent.change(box, { target: { value: "U1\nU2" } });
    expect(box.value).toBe("U1\nU2");
  });

  it("Post asks first, says how many Units are written off, and writes nothing until confirmed", async () => {
    await open(false);
    fireEvent.click(await screen.findByLabelText(/U1 · SKU/));
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByText(/2 Units will be written off/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Post Stock Take" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it("the Units list is a labelled group", async () => {
    await open(false);
    expect((await screen.findByRole("group", { name: "Units" }))).toBeTruthy();
  });
});

describe("Houzs list and detail parts", () => {
  it("Stock Adjustment shows the Net Qty and opens its Items", async () => {
    const row = { id: "a1", adjustment_no: "ADJ1", warehouse_id: "s1", reason: "Damage", created_at: "2026-10-30", performed_by: "Sara", stock_counts: null,
      stock_adjustment_units: [
        { direction: "minus", ops_stock_items: { unit_code: "U1", sku: "SKU" } },
        { direction: "minus", ops_stock_items: { unit_code: "U2", sku: "SKU" } },
        { direction: "plus", ops_stock_items: { unit_code: "U3", sku: "SKU" } },
      ] };
    api.mockImplementation(async (path: unknown) => (String(path).endsWith("/sites") ? sites : { adjustments: [row] }));
    wrap(<StockAdjustments />);
    fireEvent.click(await screen.findByText("ADJ1"));
    expect(await screen.findByRole("region", { name: "Items (3)" })).toBeTruthy();
    expect(screen.getByText("Net Qty", { selector: "dt" }).nextElementSibling?.textContent).toBe("-1");
  });

  it("Fill all to system ticks every Unit on an open count", async () => {
    api.mockImplementation(async (path: unknown) => { const p = String(path); return p.endsWith("/sites") ? sites
      : p.endsWith("/counts") ? { counts: [{ id: "c1", count_no: "ST1", warehouse_id: "s1", blind: false, note: null, status: "open", created_at: "2026-10-30", posted_at: null, stock_adjustments: [], performed_by: null, lines: 2, counted: 0, variance: 0 }] }
      : { count: { id: "c1", count_no: "ST1", blind: false, status: "open", extras: [] },
          units: [1, 2].map((n) => ({ found: null, ops_stock_items: { id: `u${n}`, unit_code: `U${n}`, sku: "SKU" } })), foundCodes: [] }; });
    wrap(<StockTakes />);
    fireEvent.click(await screen.findByText("ST1"));
    fireEvent.click(await screen.findByRole("button", { name: "Fill all to system" }));
    expect(await screen.findByText("2 Units counted")).toBeTruthy();
    expect(screen.getByText("Untouched", { selector: "dt" }).nextElementSibling?.textContent).toBe("0");
  });

  it("a blind open count hides Lines and Variance on the list", async () => {
    api.mockImplementation(async (path: unknown) => (String(path).endsWith("/sites") ? sites
      : { counts: [{ id: "c1", count_no: "ST1", warehouse_id: "s1", blind: true, note: null, status: "open", created_at: "2026-10-30", posted_at: null, stock_adjustments: [], performed_by: null, lines: null, counted: null, variance: null }] }));
    wrap(<StockTakes />);
    await screen.findByText("ST1");
    expect(screen.getAllByText("Hidden").length).toBe(2);
  });
});

describe("Stock Adjustment", () => {
  it("Save asks first with the Unit count, and writes nothing until confirmed", async () => {
    api.mockImplementation(async (path: unknown) => { const p = String(path); return p.endsWith("/sites") ? sites
      : p.includes("/units") ? { units: [unit(1), unit(2)] } : p.endsWith("/adjustments") ? { adjustments: [] } : {}; });
    wrap(<StockAdjustments />);
    fireEvent.click(await screen.findByRole("button", { name: "New Stock Adjustment" }));
    fireEvent.click(await screen.findByRole("combobox", { name: /Warehouse/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Main" }));
    fireEvent.change(document.getElementById("adj-reason")!, { target: { value: "damaged" } });
    fireEvent.click(await screen.findByLabelText(/U1 · SKU/));
    fireEvent.click(screen.getByLabelText(/U2 · SKU/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/2 Units will be written off/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Write off and save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});

describe("Stock Transfer", () => {
  it("clicking a row opens a read-only view; only the Cancel button starts a cancel", async () => {
    api.mockImplementation(async (path: unknown) => { const p = String(path); return p.endsWith("/sites") ? sites
      : { transfers: [{ id: "t1", transfer_no: "TR1", from_site_id: "s1", to_site_id: "s2", note: null, status: "posted", created_at: "2026-10-30", cancel_reason: null, stock_transfer_units: [] }] }; });
    wrap(<StockTransfers />);
    fireEvent.click(await screen.findByText("TR1"));
    expect(await screen.findByText("Confirmed", { selector: "dd" })).toBeTruthy();
    expect(screen.queryByText("The Units move back to the From Warehouse.")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("The Units move back to the From Warehouse.")).toBeTruthy();
  });
});
