import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OperationServiceCases from "./OperationServiceCases";
import type { ServiceCase } from "@carres/shared";
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  useAuth: () => ({ user: { id: "me" } }),
}));
import { caseAgeDays, stageCounts } from "./OperationServiceCases";
import { caseTimeline, customerHistory } from "./components/ServiceCaseDetail";
import { casesCsv, caseStageDescription, caseUrgency } from "./components/serviceCaseViews";
import { caseCopyRows } from "@/pages/print/ServiceCasePrintPage";

/**
 * The Deadline column counts against TODAY IN MALAYSIA, not the browser's
 * zone. Worked example from service-case-sla.test.ts: reported Mon 6 Jul 2026,
 * due Wed 22 Jul 2026. At 07:30 KL on the due day (23:30Z the night before)
 * the row must read "Due today" — a UTC browser would still say tomorrow.
 */

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
import { apiFetch } from "@/lib/api";

const row = {
  id: "c1",
  caseNo: "SC-1",
  orderId: null,
  so: null,
  priority: null,
  caseTypeLabel: null,
  customerName: "Ali",
  supplierName: null,
  refNo: null,
  whatHappened: "Hinge broke",
  statusLabel: "Open",
  statusIsClosed: false,
  openedAt: "2026-07-06",
  slaEvents: [],
  customerWants: [],
  progress: [],
} as unknown as ServiceCase;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><OperationServiceCases /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Deadline column — today is the Malaysian date", () => {
  const tz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-21T23:30:00Z")); // 22 Jul 07:30 KL
    vi.mocked(apiFetch).mockResolvedValue({ items: [row], total: 1 });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("reads Due today at 07:30 KL on the due date, whatever zone the browser is in", async () => {
    mount();
    expect(await screen.findByText("Due today")).toBeInTheDocument();
    expect(screen.queryByText("1 working day left")).toBeNull();
  });
});

/**
 * 0711 — Weisiang's decision (Mr Lim, WhatsApp 2026-10-22), Houzs way: one card
 * per stage with its count (click to filter, click again to clear), a My cases
 * switch that asks the server for my team's cases, and the owner on each row.
 */
describe("Service Cases — stage cards, My cases and the owner", () => {
  afterEach(() => { document.title = "Carres Portal"; });
  const OWNER = "55555555-5555-5555-5555-555555555555";
  const cases = [
    { ...row, id: "a", caseNo: "SC-A", statusId: "s1", statusLabel: "Pending", ownerUserId: OWNER },
    { ...row, id: "b", caseNo: "SC-B", statusId: "s1", statusLabel: "Pending", ownerUserId: null },
    { ...row, id: "c", caseNo: "SC-C", statusId: "s2", statusLabel: "In Progress", ownerUserId: null },
  ];
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.startsWith("/api/operation/staff")) return { staff: [{ user_id: OWNER, name: "Shasha" }], myDuties: [] };
      return { items: cases, total: cases.length };
    });
  });

  it("counts each stage on its card and filters the list when a card is pressed", async () => {
    mount();
    const pending = await screen.findByTestId("case-stage-card-s1");
    expect(pending).toHaveTextContent("Pending");
    expect(pending).toHaveTextContent("2");
    expect(screen.getByTestId("case-stage-card-s2")).toHaveTextContent("1");

    fireEvent.click(pending);
    expect(screen.getByText("SC-A")).toBeInTheDocument();
    expect(screen.queryByText("SC-C")).toBeNull();
    fireEvent.click(pending);
    expect(screen.getByText("SC-C")).toBeInTheDocument();
  });

  it("names the browser tab", async () => {
    mount();
    expect(document.title).toBe("Service Cases · Carres");
    expect(await screen.findByText("SC-A")).toBeInTheDocument();
  });

  it("names the case owner on the row", async () => {
    mount();
    expect(await screen.findByText("Shasha")).toBeInTheDocument();
  });

  it("asks the server for my team's cases when My cases is ticked", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText("My cases"));
    await waitFor(() =>
      expect(vi.mocked(apiFetch).mock.calls.some(([u]) => String(u).includes("mine=1"))).toBe(true),
    );
  });
});

/** A failed read is never the empty sentence: say it failed and offer a retry. */
describe("Service Cases — failed read", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.startsWith("/api/operation/staff")) return { staff: [] };
      throw new Error("boom");
    });
  });

  it("shows an error with Try again instead of No cases yet, and Try again re-reads the list", async () => {
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Service Cases could not be opened");
    expect(screen.queryByText("No cases yet.")).toBeNull();
    const listCalls = () => vi.mocked(apiFetch).mock.calls.filter(([u]) => String(u).startsWith("/api/ops/service-cases")).length;
    const before = listCalls();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });
});

describe("Service Cases — tabs", () => {
  it("uses real tab roles", async () => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({ items: [row], total: 1 });
    mount();
    expect(screen.getByRole("tablist", { name: "Service Cases view" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Service Cases" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Quality Overview" })).toBeInTheDocument();
    expect(await screen.findByText("SC-1")).toBeInTheDocument();
  });
});

describe("Service Cases — the Houzs helpers", () => {
  const clock = (over: object) => ({ state: "running", workingDaysLeft: 10, ...over }) as never;
  it("buckets the board by the case deadline", () => {
    expect(caseUrgency(clock({ state: "late", workingDaysLeft: -2 }))).toBe("overdue");
    expect(caseUrgency(clock({ workingDaysLeft: 0 }))).toBe("today");
    expect(caseUrgency(clock({ workingDaysLeft: 3 }))).toBe("soon");
    expect(caseUrgency(clock({ workingDaysLeft: 4 }))).toBe("later");
    expect(caseUrgency(clock({ state: "off", workingDaysLeft: null }))).toBe("none");
  });
  it("counts case age in calendar days", () => {
    expect(caseAgeDays("2026-07-06", "2026-07-22")).toBe(16);
  });
  it("finds a customer's other cases by phone, else by name", () => {
    const a = { ...row, id: "a", customerPhone: "012" };
    const b = { ...row, id: "b", customerPhone: "012", customerName: "Other" };
    const c = { ...row, id: "c", customerPhone: "099" };
    expect(customerHistory(a, [a, b, c]).map((r) => r.id)).toEqual(["b"]);
    const n = { ...row, id: "n", customerPhone: null };
    expect(customerHistory(n, [n, { ...row, id: "m", customerPhone: "1" }, { ...row, id: "x", customerName: "Bob" }]).map((r) => r.id)).toEqual(["m"]);
  });
  it("lists what the case recorded, newest first", () => {
    const rows = caseTimeline({ ...row, createdBy: "u1", evidence: [{ slot: "s", path: "p", kind: "photo", at: "2026-07-07T01:00:00Z", by: "u1", byRole: "operation" }] }, () => "Shasha");
    expect(rows.map((r) => r.text)).toEqual(["Photo added", "Case opened"]);
    expect(rows[0].who).toBe("Shasha");
  });
  it("shows each stage move from the 0745 history, leaving out the row written at filing", () => {
    const st = "22222222-2222-4222-8222-222222222222";
    const rows = caseTimeline({
      ...row,
      createdAt: "2026-07-01T00:00:00Z",
      stageHistory: [
        { statusId: null, enteredAt: "2026-07-01T00:00:00Z", exitedAt: "2026-07-03T00:00:00Z", targetDays: null, changedBy: null },
        { statusId: st, enteredAt: "2026-07-03T00:00:00Z", exitedAt: null, targetDays: 2, changedBy: "u1" },
      ],
    }, () => "Shasha", (id) => (id === st ? "In Progress" : ""));
    expect(rows.filter((r) => r.text.startsWith("Moved")).map((r) => [r.text, r.who])).toEqual([["Moved to In Progress", "Shasha"]]);
  });
  it("counts the open cases past their stage's target on each stage card", () => {
    const late = { ...row, id: "l", statusId: "s1", statusLabel: "Review" };
    const fine = { ...row, id: "f", statusId: "s1", statusLabel: "Review" };
    const cards = stageCounts([late, fine], () => false, (r) => r.id === "l");
    expect(cards).toEqual([{ id: "s1", label: "Review", count: 2, overdue: 0, pastTarget: 1 }]);
  });
});

describe("Service Cases — the case page and the views", () => {
  const at = (url: string) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><OperationServiceCases /></MemoryRouter>
    </QueryClientProvider>,
  );
  const answer = (rows: object[]) => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.endsWith("/remedy")) return { requests: [], proposals: [], evidence: [], units: [], approver: null, canPropose: false, canDecide: false };
      if (path.endsWith("/config")) return { types: [], statuses: [{ id: "s1", label: "Pending", isClosed: false }, { id: "s2", label: "Resolved", isClosed: true }] };
      if (path.includes("/api/ops/service-cases/")) return rows[0];
      return { items: rows, total: rows.length, staff: [] };
    });
  };

  it("opens ?case= as a page with the Houzs sections and the stage workflow", async () => {
    answer([{ ...row, statusId: "s1", statusLabel: "Pending" }]);
    at("/operation?tab=service-notes&case=c1");
    expect(await screen.findByTestId("service-case-detail")).toBeInTheDocument();
    for (const name of ["Workflow", "Issue", "Product Info", "Resolution", "Customer", "Customer History", "Timeline"])
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Close Case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. Pending" })).toHaveAttribute("aria-current", "step");
  });

  it("shows the pickup and delivery-back legs with Logistics' answer (0746)", async () => {
    answer([{ ...row, statusId: "s1", statusLabel: "Pending", pickupBy: "own", pickupRequestedAt: "2026-11-10", deliveryBy: "supplier" }]);
    at("/operation?tab=service-notes&case=c1");
    const pickup = await screen.findByRole("region", { name: "Pickup / Return" });
    expect(pickup).toHaveTextContent("Waiting for Logistics to confirm this date.");
    expect(screen.getByLabelText("Scheduled Pickup Date (ETA)")).toHaveValue("2026-11-10");
    expect(screen.getByRole("region", { name: "Delivery Back" })).toHaveTextContent("The supplier delivers it back.");
    expect(screen.queryByLabelText("Delivery Date")).not.toBeInTheDocument();
  });

  it("offers the current stage's sub-statuses on the case, and shows the sub-status on the list (0760)", async () => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.endsWith("/remedy")) return { requests: [], proposals: [], evidence: [], units: [], approver: null, canPropose: false, canDecide: false };
      if (path.endsWith("/config")) return {
        types: [], statuses: [{ id: "s1", label: "Pending", isClosed: false }],
        subStatuses: [
          { id: "x1", statusId: "s1", code: "a", label: "Pending Customer Pickup", sortOrder: 10, active: true },
          { id: "x2", statusId: "s9", code: "b", label: "Other stage", sortOrder: 20, active: true },
        ],
      };
      const one = { ...row, statusId: "s1", statusLabel: "Pending", subStatusId: "x1", subStatusLabel: "Pending Customer Pickup" };
      if (path.includes("/api/ops/service-cases/")) return one;
      return { items: [one], total: 1, staff: [] };
    });
    at("/operation?tab=service-notes&case=c1");
    const workflow = await screen.findByRole("region", { name: "Workflow" });
    await waitFor(() => expect(workflow).toHaveTextContent("Pending Customer Pickup"));
    expect(workflow).not.toHaveTextContent("Other stage");
  });

  it("shows the gross margin from the two cost amounts, and a loss without a minus sign (0763)", async () => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.endsWith("/remedy")) return { requests: [], proposals: [], evidence: [], units: [], approver: null, canPropose: false, canDecide: false };
      if (path.endsWith("/config")) return { types: [], statuses: [{ id: "s1", label: "Pending", isClosed: false }] };
      const one = { ...row, statusId: "s1", statusLabel: "Pending", customerAmount: 100, supplierCostAmount: 150, supplierInvoiceRef: "INV-9" };
      if (path.includes("/api/ops/service-cases/")) return one;
      return { items: [one], total: 1, staff: [] };
    });
    at("/operation?tab=service-notes&case=c1");
    const cost = await screen.findByRole("region", { name: "Cost" });
    await waitFor(() => expect(cost).toHaveTextContent("Loss RM 50.00"));
    expect(screen.getByLabelText("Supplier Invoice Ref")).toHaveValue("INV-9");
  });

  it("offers the resolution methods from Service Settings on the case (0761)", async () => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.endsWith("/remedy")) return { requests: [], proposals: [], evidence: [], units: [], approver: null, canPropose: false, canDecide: false };
      if (path.endsWith("/config")) return {
        types: [], statuses: [{ id: "s1", label: "Pending", isClosed: false }],
        resolutionMethods: [{ id: "m1", code: "replace_unit", label: "Replace Unit", sortOrder: 10, active: true }],
      };
      const one = { ...row, statusId: "s1", statusLabel: "Pending", resolutionMethodId: "m1", resolutionMethodLabel: "Replace Unit" };
      if (path.includes("/api/ops/service-cases/")) return one;
      return { items: [one], total: 1, staff: [] };
    });
    at("/operation?tab=service-notes&case=c1");
    const resolution = await screen.findByRole("region", { name: "Resolution" });
    await waitFor(() => expect(resolution).toHaveTextContent("Replace Unit"));
  });

  it("hides closed cases on Hide completed, and shows them again when the closed stage is picked", async () => {
    answer([
      { ...row, id: "a", caseNo: "SC-A", statusId: "s1", statusLabel: "Pending" },
      { ...row, id: "b", caseNo: "SC-B", statusId: "s2", statusLabel: "Resolved", statusIsClosed: true },
    ]);
    at("/operation?tab=service-notes");
    expect(await screen.findByText("SC-B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide completed" }));
    await waitFor(() => expect(screen.queryByText("SC-B")).toBeNull());
    fireEvent.click(screen.getByTestId("case-stage-card-s2"));
    expect(await screen.findByText("SC-B")).toBeInTheDocument();
  });

  it("keeps the module's own tab when Quality Overview is opened", () => {
    answer([]);
    at("/operation?tab=service-notes&view=quality");
    expect(screen.getByRole("tab", { name: "Quality Overview" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Service Cases — the second Houzs round", () => {
  const at = (url: string) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><OperationServiceCases /></MemoryRouter>
    </QueryClientProvider>,
  );
  const answer = (rows: object[]) => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.endsWith("/remedy")) return { requests: [], proposals: [], evidence: [], units: [], approver: null, canPropose: false, canDecide: false };
      if (path.endsWith("/config")) return { types: [], statuses: [] };
      if (path.includes("/api/ops/service-cases/")) return rows[0];
      return { items: rows, total: rows.length, staff: [] };
    });
  };

  it("filters by creditor from the URL and offers each creditor once", async () => {
    answer([
      { ...row, id: "a", caseNo: "SC-A", supplierId: "s1", supplierName: "Hookka" },
      { ...row, id: "b", caseNo: "SC-B", supplierId: "s2", supplierName: "Nice Future" },
      { ...row, id: "c", caseNo: "SC-C", supplierId: "s2", supplierName: "Nice Future" },
    ]);
    at("/operation?tab=service-notes&creditor=s1");
    expect(await screen.findByText("SC-A")).toBeInTheDocument();
    expect(screen.queryByText("SC-B")).toBeNull();
    const creditor = screen.getByRole("combobox", { name: "Creditor" });
    expect(creditor).toHaveValue("s1");
    expect(creditor.querySelectorAll("option")).toHaveLength(3);
  });

  it("saves one field when you leave it, and refuses an empty customer name", async () => {
    answer([{ ...row, statusId: "s1", statusLabel: "Pending" }]);
    at("/operation?tab=service-notes&case=c1");
    const phone = await screen.findByLabelText("Phone");
    fireEvent.change(phone, { target: { value: "0123" } });
    fireEvent.blur(phone);
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([, o]) => (o as RequestInit | undefined)?.body === JSON.stringify({ customerPhone: "0123" }))).toBe(true));
    const name = screen.getByLabelText("Customer Name *");
    const before = vi.mocked(apiFetch).mock.calls.filter(([, o]) => (o as RequestInit | undefined)?.method === "PATCH").length;
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.blur(name);
    expect(await screen.findByText("Customer Name cannot be empty.")).toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.filter(([, o]) => (o as RequestInit | undefined)?.method === "PATCH")).toHaveLength(before);
  });

  it("assigns picked cases to me one by one and names the ones the server refuses", async () => {
    answer([{ ...row, id: "a", caseNo: "SC-A" }, { ...row, id: "b", caseNo: "SC-B" }]);
    const list = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation(async (path: string, o?: RequestInit) => {
      if (o?.method === "PATCH" && path.endsWith("/b")) throw new Error("Only the sales order PIC can pick who owns this case.");
      return o?.method === "PATCH" ? { id: "a" } : list(path, o);
    });
    at("/operation?tab=service-notes");
    await screen.findByText("SC-A");
    for (const box of screen.getAllByRole("checkbox", { name: "Select row" })) fireEvent.click(box);
    fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("1 assigned to you. Not assigned: SC-B.");
    expect(vi.mocked(apiFetch).mock.calls.filter(([, x]) => (x as RequestInit | undefined)?.body === JSON.stringify({ ownerUserId: "me" }))).toHaveLength(2);
  });

  it("archives picked cases, and the Archived filter asks for archived ones and offers Unarchive (0762)", async () => {
    answer([{ ...row, id: "a", caseNo: "SC-A" }]);
    const list = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation(async (path: string, o?: RequestInit) => (o?.method === "PATCH" ? { id: "a" } : list(path, o)));
    at("/operation?tab=service-notes");
    await screen.findByText("SC-A");
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("1 archived.");
    expect(vi.mocked(apiFetch).mock.calls.some(([p, x]) => p === "/api/ops/service-cases/a" && (x as RequestInit | undefined)?.body === JSON.stringify({ archived: true }))).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Archived" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([p]) => p === "/api/ops/service-cases?archived=1")).toBe(true));
    await screen.findByText("SC-A");
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);
    expect(await screen.findByRole("button", { name: "Unarchive" })).toBeInTheDocument();
  });

  it("offers the three print copies on the case page", async () => {
    answer([{ ...row, statusId: "s1", statusLabel: "Pending" }]);
    at("/operation?tab=service-notes&case=c1");
    expect(await screen.findByRole("menuitem", { name: /Supplier Copy/, hidden: true })).toHaveAttribute("href", "/print/service-case/c1?copy=supplier");
    expect(screen.getByRole("menuitem", { name: /Customer Copy/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Office Copy/, hidden: true })).toBeInTheDocument();
  });

  it("keeps each print copy to what its reader may see", () => {
    const c = { ...row, customerPhone: "012", customerAddress: "KL", supplierName: "Hookka", incurredCharges: "RM50" } as ServiceCase;
    const labels = (copy: "customer" | "supplier" | "office") => caseCopyRows(c, copy, "2026-07-22", "").map((r) => r.label);
    expect(labels("customer")).toContain("Phone");
    expect(labels("customer")).not.toContain("Supplier");
    expect(labels("customer")).not.toContain("Incurred charges");
    expect(labels("supplier")).toContain("Deadline");
    expect(labels("supplier")).not.toContain("Phone");
    expect(labels("supplier")).not.toContain("Address");
    expect(labels("office")).toEqual(expect.arrayContaining(["Phone", "Supplier", "Incurred charges"]));
  });

  it("captions the seeded stages and stays silent on one it does not know", () => {
    expect(caseStageDescription("In Progress")).toBe("Inspect and fix the issue");
    expect(caseStageDescription("Warehouse check")).toBe("");
  });

  it("writes a CSV that quotes commas and defuses formulas", () => {
    const csv = casesCsv([{ ...row, customerName: "=HYPERLINK(1)", whatHappened: "torn, stained" } as ServiceCase], () => ({ state: "off", dueIso: null }) as never, () => "");
    expect(csv.split("\r\n")[1]).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"torn, stained"');
  });
});
