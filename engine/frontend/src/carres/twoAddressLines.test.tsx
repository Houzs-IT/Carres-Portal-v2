// Carres: the Sales Order uses Address Line 1 and 2 only, the same as Houzs and the Delivery Order it
// becomes (owner 14 Nov 2026, reversing PR #2301). Lines 3 and 4 stay in the database but have no input,
// line 2 spills nowhere, and the order never prints them, so nothing typed on an order is lost on SO -> DO.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const { detailBody } = vi.hoisted(() => ({ detailBody: { current: null as unknown } }));

vi.mock("../vendor/scm/lib/authed-fetch", async (orig) => ({
  ...(await orig<typeof import("../vendor/scm/lib/authed-fetch")>()),
  authedFetch: vi.fn((path: string) => {
    if (/\/mfg-sales-orders\/[^/?]+\/payments$/.test(path)) return Promise.resolve({ payments: [] });
    if (/\/mfg-sales-orders\/[^/?]+$/.test(path)) return Promise.resolve(detailBody.current);
    return new Promise(() => undefined);
  }),
}));
vi.mock("../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock("../vendor/scm/components/PromptDialog", () => ({ usePrompt: () => vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Owner" }, can: () => true }) }));
vi.mock("../vendor/scm/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../vendor/scm/lib/auth")>()),
  useAuth: () => ({ staff: null, user: null }),
}));

import { SoAddressLines } from "../components/SoAddressLines";
import { MobileNewSO } from "../mobile/MobileNewSO";
import { orderAddressLines, soStreetTail } from "../vendor/scm/lib/order-address";
import { soCopyHeaderSeed } from "../lib/soCopyLines";

afterEach(cleanup);

describe("Carres: the Sales Order form has exactly two address lines", () => {
  it("desktop New / Edit (SoAddressLines): Address Line 1 and 2, no 3 or 4", () => {
    const onChange = vi.fn();
    render(
      <SoAddressLines lines={["No 1", "Taman A", "hidden 3", "hidden 4"]} onChange={onChange}
        fieldClassName="f" labelClassName="l" inputClassName={() => "i"} />,
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText("Address Line 1")).toBeTruthy();
    expect(screen.getByText("Address Line 2")).toBeTruthy();
    expect(screen.queryByText("Address Line 3")).toBeNull();
    expect(screen.queryByText("Address Line 4")).toBeNull();
    expect(screen.queryByDisplayValue("hidden 3")).toBeNull();
  });

  it("a long paste into line 2 does not spill into the hidden line 3", () => {
    const onChange = vi.fn();
    render(
      <SoAddressLines lines={["", "", "", ""]} onChange={onChange}
        fieldClassName="f" labelClassName="l" inputClassName={() => "i"} />,
    );
    // Line 1 still spills into line 2 (the paste reaches the handler) ...
    fireEvent.paste(screen.getAllByRole("textbox")[0]!, { clipboardData: { getData: () => "y".repeat(70) } });
    expect(onChange.mock.calls.some(([line]) => line === 2)).toBe(true);
    // ... but line 2 spills nowhere.
    const line2 = screen.getAllByRole("textbox")[1]!;
    fireEvent.paste(line2, { clipboardData: { getData: () => "x".repeat(70) } });
    expect(onChange.mock.calls.some(([line]) => line === 3 || line === 4)).toBe(false);
  });

  it("phone SO editor: Address Line 1 and 2 only, even when the row holds lines 3 and 4", async () => {
    const DOC = "CR-SO-2611-001";
    detailBody.current = {
      salesOrder: {
        doc_no: DOC, status: "CONFIRMED", so_date: "2026-11-01", debtor_name: "Goh", phone: "+60123456789",
        email: "g@h.c", address1: "268, Lorong Permata 10,", address2: "PERMATA HILL PARK",
        address3: "old line 3", address4: "old line 4",
        customer_state: "Kedah", city: "Sungai Petani", postcode: "08000",
        processing_date: "2026-12-01", customer_delivery_date: "2026-12-15",
        version: 3, currency: "MYR", has_children: false, downstream_fully_frozen: false,
      },
      items: [{
        id: "line-1", doc_no: DOC, item_group: "mattress", item_code: "MT-QUEEN", description: "MT-QUEEN name",
        qty: 1, unit_price_sen: 100000, discount_sen: 0, variants: {}, remark: null, cancelled: false,
        line_delivery_date: "2026-12-15", downstream_frozen: false,
      }],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MobileNewSO mode="edit" docNo={DOC} openAddLine={false} onBack={() => undefined} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("268, Lorong Permata 10,")).toBeTruthy());
    expect(screen.getByDisplayValue("PERMATA HILL PARK")).toBeTruthy();
    expect(screen.queryByText(/Address Line 3/)).toBeNull();
    expect(screen.queryByText(/Address Line 4/)).toBeNull();
    expect(screen.queryByDisplayValue("old line 3")).toBeNull();
  });
});

describe("Carres: an order never prints or copies lines 3 and 4", () => {
  const ROW = {
    address1: "No 1, Jalan A", address2: "Taman B", address3: "Jalan PJU 8/8B", address4: null,
    postcode: "47820", city: "Petaling Jaya", customer_state: "Selangor",
  };

  it("the printed address is line 1, line 2, then the locality", () => {
    expect(soStreetTail(ROW)).toEqual([]);
    expect(orderAddressLines(ROW)).toEqual(["No 1, Jalan A", "Taman B", "47820 Petaling Jaya Selangor"]);
  });

  it("Copy as new carries lines 1 and 2 only", () => {
    const seed = soCopyHeaderSeed({ ...ROW, debtor_name: "Ada" } as Parameters<typeof soCopyHeaderSeed>[0]);
    expect(seed).toMatchObject({ address1: "No 1, Jalan A", address2: "Taman B", address3: "", address4: "" });
  });
});
