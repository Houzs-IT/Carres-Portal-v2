/* Carres: the Supplier Platform is a surface of its own, outside the staff sign-in.
 *
 * The owner's rule (15 Nov 2026): a supplier's login must never be a way into Carres's system. On the screen side
 * that means three things, each pinned here:
 *   1. /supplier/* is its own surface, so the staff app, its providers and its sign-in never load for a supplier,
 *      while the staff pages whose address merely starts with the same letters stay staff pages;
 *   2. a supplier's browser never calls a staff route. The supplier pages never import the staff client, the staff
 *      session, the staff menu or the staff table (owner's design of 17 Nov 2026: the supplier pages draw their own
 *      list table). A signed-in walk through every page, with its clicks, proves the browser then asks the
 *      suppliers' own API and nothing else;
 *   3. the supplier's token and the staff token are different keys, and the one-time link's secret is read from the
 *      address fragment and removed from the address at once. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { appSurfaceForPath } from "../../routing/appSurface";
import { normalizeMe, supplierToken } from "./api";
import { SUPPLIER_HOSTS, isSupplierHost } from "./host";
import { clock12, fmtDay, fmtMonth, fmtStamp, money, pickupBadge, stageBadge } from "./ui";
import { SupplierApp } from "./SupplierApp";

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));

describe("the supplier surface", () => {
  it.each([
    ["/supplier", "supplier"],
    ["/supplier/", "supplier"],
    ["/supplier/login", "supplier"],
    ["/supplier/setup", "supplier"],
    ["/supplier/orders/CR-SO-2611-001", "supplier"],
    ["/supplier/collections", "supplier"],
    ["/supplier/finance", "supplier"],
    // Staff pages that only LOOK alike stay staff pages.
    ["/suppliers", "staff"],
    ["/supplier-pickups", "staff"],
    ["/scm/suppliers", "staff"],
    ["/scm/supplier-pickups", "staff"],
    ["/scm/supplier-notes", "staff"],
    // Houzs's own one-case supplier link is untouched.
    ["/portal/supplier/token", "portal"],
  ] as const)("classifies %s as %s", (path, surface) => {
    expect(appSurfaceForPath(path)).toBe(surface);
  });

  it("at the supplier's own address every page is a supplier page: the staff app does not exist there", () => {
    for (const path of ["/", "/login", "/scm/sales-orders", "/scm/suppliers", "/settings", "/reset/token", "/invite/token", "/track", "/supplier/orders"]) {
      expect(appSurfaceForPath(path, "supp.carresofficial.com"), path).toBe("supplier");
      expect(appSurfaceForPath(path, "SUPP.CarresOfficial.com"), path).toBe("supplier");
    }
    for (const host of ["carres-scm.pages.dev", "abc123.carres-scm.pages.dev", "localhost", "supp.carresofficial.com.evil.test", "xsupp.carresofficial.com", ""]) {
      expect(appSurfaceForPath("/", host), host).toBe("staff");
      expect(appSurfaceForPath("/scm/suppliers", host), host).toBe("staff");
      expect(appSurfaceForPath("/supplier/login", host), host).toBe("supplier");
    }
    expect(SUPPLIER_HOSTS).toEqual(["supp.carresofficial.com"]);
    expect(isSupplierHost(null)).toBe(false);
  });

  it("main.tsx mounts it outside AuthProvider and AuthGate", () => {
    const main = readFileSync(resolve(HERE, "../../main.tsx"), "utf8");
    const branch = main.slice(main.indexOf('if (surface === "supplier")'), main.indexOf('if (surface === "survey")'));
    expect(branch).toContain("<SupplierApp />");
    expect(branch).not.toContain("<AuthProvider");
    expect(branch).not.toContain("<AuthGate");
  });

  it("main.tsx draws no supplier page inside a frame", () => {
    const main = readFileSync(resolve(HERE, "../../main.tsx"), "utf8");
    const branch = main.slice(main.indexOf('if (surface === "supplier")'), main.indexOf('if (surface === "survey")'));
    const refusal = branch.indexOf("if (CARRES_EMBEDDED) return null;");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(branch.indexOf("<SupplierApp />"));
    const embed = readFileSync(resolve(HERE, "../embed.ts"), "utf8");
    expect(embed).toContain("try { return window.self !== window.top; } catch { return true; }");
  });

  it("choosing a password through the link signs the person in", () => {
    // Sent back to the sign-in page to type it again, a person whose email is being hammered with wrong tries is
    // locked once more before they get there.
    const app = readFileSync(resolve(HERE, "SupplierApp.tsx"), "utf8");
    const page = app.slice(app.indexOf("function SetPasswordPage"), app.indexOf("// ── The signed-in pages"));
    expect(page).toContain("supplierToken.set(out.token);");
    expect(page).toContain("onSignedIn(out.me);");
    expect(app).toContain('if (path === "/supplier/setup") return <SetPasswordPage onSignedIn={enter} />;');
  });

  it("main.tsx does not offer a supplier the staff app's install prompt", () => {
    const main = readFileSync(resolve(HERE, "../../main.tsx"), "utf8");
    expect(main).toContain('return useAppSurface() === "supplier" ? null : <PwaBanners />;');
    expect(main.match(/<PwaBanners \/>/g)).toHaveLength(1);
    expect(main).toContain("<StaffPwaBanners />");
  });

  it("every page chunk sits in its own crash slot, so a failed chunk leaves the header standing", () => {
    const app = readFileSync(resolve(HERE, "SupplierApp.tsx"), "utf8");
    expect(app).not.toMatch(/<Suspense\b/);
    expect(app).toContain("<LazySlot resetKey={`supplier:${pathname}`}");
  });
});

describe("the supplier pages keep away from the staff app", () => {
  it("has source files to check", () => {
    expect(sources).toEqual(expect.arrayContaining([
      "api.ts", "ui.tsx", "Shell.tsx", "ListTable.tsx", "SupplierApp.tsx", "OrdersPage.tsx", "ForecastPage.tsx", "PickupsPage.tsx", "FinancePage.tsx", "SettingsPage.tsx",
    ]));
  });

  it.each(sources)("%s imports no staff client, session, menu, table or saved layouts", (file) => {
    const text = readFileSync(resolve(HERE, file), "utf8");
    const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const banned of ["api/client", "auth/AuthContext", "auth/AuthGate", "components/Layout", "components/DataTable", "hooks/useQuery", "hooks/useUdf", "lib/tableLayouts", "supplier-staff", "pdf-common"]) {
      expect(imports.filter((i) => i.includes(banned)), `${file} imports ${banned}`).toEqual([]);
    }
  });

  it("every request goes to the suppliers' own API, and nowhere else", () => {
    const api = readFileSync(resolve(HERE, "api.ts"), "utf8");
    expect(api).toContain("`${baseUrl}/api/carres-supplier${path}`");
    expect(api.match(/fetch\(/g)).toHaveLength(1);
    for (const file of sources.filter((f) => f !== "api.ts")) {
      expect(readFileSync(resolve(HERE, file), "utf8"), file).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("the supplier's token", () => {
  beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

  it("is kept for the tab only, under its own key", () => {
    supplierToken.set("abc");
    expect(window.sessionStorage.getItem("carres.supplier.session")).toBe("abc");
    expect(window.localStorage.length).toBe(0);
    expect(supplierToken.get()).toBe("abc");
    supplierToken.clear();
    expect(supplierToken.get()).toBe("");
  });
});

describe("words and numbers", () => {
  it("writes a day and a moment in the engine's one date format, and a missing one as nothing", () => {
    expect(fmtDay("2026-11-20")).toBe("2026/11/20");
    expect(fmtMonth("2026-12")).toBe("2026/12");
    expect(fmtMonth("")).toBe("");
    // 16:30 UTC is 00:30 the next day in Kuala Lumpur.
    expect(fmtStamp("2026-11-20T16:30:00Z")).toBe("2026/11/21 00:30");
    for (const none of [null, undefined, "", "not a date"]) {
      expect(fmtDay(none)).toBe("");
      expect(fmtStamp(none)).toBe("");
    }
  });

  it("writes money the Malaysian way, a pickup time the warehouse's way, and a stage in Carres's words", () => {
    expect(money(1734.6)).toBe("RM 1,734.60");
    expect(clock12("14:00")).toBe("2:00 PM");
    expect(clock12("09:30")).toBe("9:30 AM");
    expect(clock12("00:15")).toBe("12:15 AM");
    expect(stageBadge("CONFIRMED").label).toBe("Submitted");
    expect(stageBadge("SOMETHING_NEW").label).toBe("Something new");
  });

  it("says a pickup's status from the supplier's side, including an ask waiting for Carres", () => {
    expect(pickupBadge({ status: "REQUESTED" }).label).toBe("Waiting for you");
    expect(pickupBadge({ status: "ACCEPTED" }).label).toBe("Accepted");
    expect(pickupBadge({ status: "ACCEPTED", ask: { kind: "date", date: "2026-11-22", askedAt: "", askedByName: "" } }).label).toBe("Waiting for Carres");
    expect(pickupBadge({ status: "CANCELLED" }).label).toBe("Cancelled by Carres");
    expect(pickupBadge({ status: "CANCELLED", cancelledBySupplier: true }).label).toBe("Cancelled by you");
  });

  it("reads a server one step behind as every page of the person's departments", () => {
    // An answer from before the per-person permissions: no perms, no mustChangePassword.
    const me = normalizeMe({ user: { id: 1, name: "A", email: "a@x.test", canOperation: true, canFinance: false }, supplier: { name: "S", code: "1" }, badges: { pickupsToAccept: 0 } });
    expect(me.user.perms.operation).toContain("v_orders");
    expect(me.user.perms.operation).toContain("a_users");
    expect(me.user.perms.finance).toEqual([]);
    expect(me.user.mustChangePassword).toBe(false);
  });
});

// ── A signed-in walk ─────────────────────────────────────────────────────────────────────────────────────────────

const OP_ALL = ["v_orders", "v_forecast", "v_pickups", "a_accept", "a_collect", "a_date", "a_cancel", "a_export", "a_users"];
const FIN_ALL = ["v_coll", "v_month", "d_names", "d_share", "d_bad", "a_export", "a_stmt", "a_users"];
let ME: Record<string, unknown>;
const baseMe = () => ({
  user: { id: 7, name: "Ops Person", email: "ops@supplier.test", canOperation: true, canFinance: true, mustChangePassword: false, perms: { operation: OP_ALL, finance: FIN_ALL } },
  supplier: { name: "Maker", code: "400-X" },
  badges: { pickupsToAccept: 1 },
});
const orderLine = (soItemId: string, qty: number) => ({
  soItemId, lineNo: 1, itemCode: "MAT-Q", description: "Mattress Queen", spec: "183 x 190", category: "mattress", modelName: null, uom: "UNIT", qty,
  pickup: { state: "none", requestId: null, requestNo: null, expectedDate: null },
});
// A customer name that starts like a spreadsheet formula: the file must keep it as text.
const ORDER_1 = {
  docNo: "CR-SO-2611-001", soDate: "2026-11-02", status: "CONFIRMED", saleType: "outright", processingDate: null, deliveryDate: "2026-11-20",
  customerName: '=HYPERLINK("http://x")', addressLines: ["1 Jalan Ujian", "Klang"], receivedAt: "2026-11-02T02:00:00Z",
  lineCount: 1, unitCount: 2, pickupState: "none", lines: [orderLine("i1", 2)],
};
const ORDER_2 = { ...ORDER_1, docNo: "CR-SO-2611-002", customerName: "Tan Ah Kow", unitCount: 1, lines: [orderLine("i2", 1)] };
const PICKUP = {
  id: "p1", requestNo: "CR-PKR-2611-001", supplierName: "Maker", expectedDate: "2099-11-25", expectedTime: "14:00", note: "Bay 2", status: "REQUESTED",
  requestedAt: "2026-11-16T02:00:00Z", acceptedAt: null, acceptedByName: null, collectedAt: null, cancelledAt: null, cancelReason: null,
  soDocNos: ["CR-SO-2611-001"], lineCount: 1, unitCount: 2, ask: null, answer: null, deliveryOrder: null, orders: [{ docNo: "CR-SO-2611-001", customerName: "Lim" }],
  lines: [{ soDocNo: "CR-SO-2611-001", soItemId: "i1", itemCode: "MAT-Q", description: "Mattress Queen", spec: "183 x 190", modelName: null, uom: "UNIT", qty: 2 }],
};
const PICKUP_ACCEPTED = { ...PICKUP, id: "p2", requestNo: "CR-PKR-2611-002", status: "ACCEPTED", acceptedAt: "2026-11-16T03:00:00Z", acceptedByName: "Ops Person" };
const FIN_ORDER = {
  id: "f1", agreementNo: "CR-AG-2611-001", soNo: "CR-SO-2611-001", customerName: "Tan Ah Kow", item: "Mattress Queen", termMonths: 3, monthlyFee: 100,
  ratePct: 20, startDate: "2026-11-01", status: "active", state: "on_time", contractValue: 300, shareTotal: 60, paidCount: 1, collected: 100,
  shareEarned: 20, toCollect: 200, shareToCome: 40, overdueMonths: 0, overdueAmount: 0, overdueShare: 0, nextDueDate: "2026-12-01", lastPaidOn: "2026-11-01",
  schedule: [
    { seq: 1, dueDate: "2026-11-01", state: "paid", amountDue: 100, share: 20, paidOn: "2026-11-01" },
    { seq: 2, dueDate: "2026-12-01", state: "upcoming", amountDue: 100, share: 20, paidOn: null },
    { seq: 3, dueDate: "2027-01-01", state: "upcoming", amountDue: 100, share: 20, paidOn: null },
  ],
};
const PEOPLE = [
  { id: 7, name: "Ops Person", email: "ops@supplier.test", status: "active", self: true, perms: OP_ALL, lastLoginAt: "2026-11-16T01:12:00Z" },
  { id: 8, name: "Wan Store", email: "wan@supplier.test", status: "invited", self: false, perms: ["v_orders", "v_forecast", "v_pickups"], lastLoginAt: null },
];

/** The suppliers' API, as far as these pages ask it. Anything else is answered 404 and fails the walk. */
function supplierServer(path: string, method: string, search: URLSearchParams): unknown {
  if (path === "/api/track/company") return { companyName: "Carres" };
  if (path === "/api/carres-supplier/auth/me") return ME;
  if (path === "/api/carres-supplier/orders") {
    const page = Number(search.get("page") ?? 1);
    return { rows: page === 1 ? [ORDER_1, ORDER_2] : [], total: 2, page, pageSize: Number(search.get("pageSize") ?? 50), counts: { all: 2, incoming: 2, processing: 0, delivered: 0 } };
  }
  if (path === `/api/carres-supplier/orders/${ORDER_1.docNo}` || path === `/api/carres-supplier/orders/${ORDER_2.docNo}`) {
    return { order: { ...ORDER_1, trail: [{ at: "2026-11-02T02:00:00Z", kind: "received", code: "RECEIVED", ref: null, detail: null }], map: [] } };
  }
  if (path === "/api/carres-supplier/forecast") {
    return {
      rows: [{ itemCode: "MAT-Q", description: "Mattress Queen", spec: "183 x 190", modelName: null, category: "mattress", uom: "UNIT", incoming: 3, processing: 0, total: 3, byMonth: { "2026-11": 3 } }],
      months: ["2026-11"], totals: { incoming: 3, processing: 0, total: 3, orders: 2 },
    };
  }
  if (path === "/api/carres-supplier/pickups") return { rows: [PICKUP, PICKUP_ACCEPTED] };
  if (path === "/api/carres-supplier/pickups/accept" && method === "POST") return { pickups: [{ ...PICKUP, status: "ACCEPTED", acceptedAt: "2026-11-16T03:00:00Z", acceptedByName: "Ops Person" }] };
  if (path === "/api/carres-supplier/pickups/p2/ask" && method === "POST") return { pickup: { ...PICKUP_ACCEPTED, ask: { kind: "date", date: "2099-11-26", askedAt: "2026-11-16T04:00:00Z", askedByName: "Ops Person" } } };
  if (path === "/api/carres-supplier/finance/summary") {
    return {
      shared: true, asOf: "2026-11-16", visible: { names: true, share: true, bad: true },
      totals: { orders: 1, contractValue: 300, shareTotal: 60, collected: 100, collectedCount: 1, shareEarned: 20, toCollect: 200, shareToCome: 40, overdueOrders: 0, overdueMonths: 0, overdueAmount: 0, overdueShare: 0, defaultOrders: 0 },
      months: [
        { month: "2026-11", due: 100, dueShare: 20, collected: 100, collectedShare: 20, open: 0, openShare: 0 },
        { month: "2026-12", due: 100, dueShare: 20, collected: 0, collectedShare: 0, open: 100, openShare: 20 },
      ],
      orders: [FIN_ORDER],
    };
  }
  if (path === "/api/carres-supplier/users" && method === "GET") return { users: PEOPLE };
  return null;
}

describe("a signed-in supplier, clicking through every page, asks the suppliers' own API and nothing else", () => {
  const asked: Array<{ method: string; url: string; body: unknown }> = [];
  const allowed = (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    return path.startsWith("/api/carres-supplier/") || path === "/api/track/company";
  };

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    asked.length = 0;
    ME = baseMe();
    supplierToken.set("tok-1");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = null;
      try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = null; }
      asked.push({ method, url, body });
      const u = new URL(url, "http://localhost");
      const answer = supplierServer(u.pathname, method, u.searchParams);
      return Promise.resolve(new Response(JSON.stringify(answer ?? { error: "Not found." }), { status: answer ? 200 : 404, headers: { "content-type": "application/json" } }));
    }));
    vi.stubGlobal("XMLHttpRequest", class { open(_m: string, url: string) { asked.push({ method: "XHR", url: String(url), body: null }); } send() {} setRequestHeader() {} addEventListener() {} abort() {} });
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (url: string) => { asked.push({ method: "BEACON", url: String(url), body: null }); return true; } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "sendBeacon");
    supplierToken.clear();
  });

  const walk = (path: string) => render(<MemoryRouter initialEntries={[path]}><SupplierApp /></MemoryRouter>);
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const strays = () => asked.filter((a) => !allowed(a.url));
  const LOAD = { timeout: 15_000 };
  const rowOf = async (text: string) => (await screen.findAllByText(text, {}, LOAD)).find((el) => el.closest("tbody"))!.closest("tr")!;
  const pill = (name: RegExp) => screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-pressed"))!;
  const bytes = (blob: Blob) => new Promise<ArrayBuffer>((done) => { const r = new FileReader(); r.onload = () => done(r.result as ArrayBuffer); r.readAsArrayBuffer(blob); });

  it("Sales Orders: figure cards, pills, a row opening in place, Columns, Export, Cards and search", { timeout: 40_000 }, async () => {
    const files: Blob[] = [];
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { files.push(b); return "blob:x"; }), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    walk("/supplier/orders");

    expect(await screen.findByRole("heading", { name: "Sales Orders" }, LOAD)).toBeTruthy();
    expect(await screen.findByText("Tan Ah Kow")).toBeTruthy();
    expect(screen.getByText("Total Orders")).toBeTruthy();
    expect(screen.getByText("Pickups to Accept")).toBeTruthy();
    // The pickup tab carries the count waiting.
    expect(screen.getByLabelText("1 waiting")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    expect(await screen.findByText("Delivery Address")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    // A row opens in place, under itself: its facts and the way to its full page.
    fireEvent.click(await rowOf("Tan Ah Kow"));
    expect(await screen.findByText("Open full page")).toBeTruthy();
    expect(screen.getByText("Delivery Address")).toBeTruthy();
    expect(await screen.findByText("Order received")).toBeTruthy();

    // Ticking rows sums them in the dark bar, and Export writes the ticked rows.
    const row = await rowOf("Tan Ah Kow");
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(await screen.findByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export (1)" }));
    await waitFor(() => expect(files.length).toBe(1), { timeout: 10_000 });
    const X = await import("../../lib/xlsx-runtime");
    const book = X.read(new Uint8Array(await bytes(files[0]!)), { type: "array" });
    const rows = X.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 });
    expect(rows[0]!.slice(0, 5)).toEqual(["SO No", "SO Date", "Customer", "Items", "Qty"]);
    expect(rows[1]![2]).toBe("Tan Ah Kow");
    expect(rows[1]![3]).toBe("1 UNIT Mattress Queen (183 x 190)");
    expect(rows).toHaveLength(2);
    click.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    // Every order is read, a page of 200 at a time.
    expect(asked.some((a) => a.url.includes("/api/carres-supplier/orders?") && a.url.includes("pageSize=200"))).toBe(true);

    // Search filters the list in place.
    fireEvent.change(screen.getByPlaceholderText("Search SO No, customer or item"), { target: { value: "Tan" } });
    await waitFor(() => expect(screen.queryByText("CR-SO-2611-001")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(await screen.findAllByText("CR-SO-2611-002")).toBeTruthy();

    await settle();
    expect(strays()).toEqual([]);
  });

  it("an order's own page: history, documents and the pickup it is on", { timeout: 40_000 }, async () => {
    walk("/supplier/orders/CR-SO-2611-001");
    expect(await screen.findByText("Order received", {}, LOAD)).toBeTruthy();
    expect(screen.getByText("Note from Carres")).toBeTruthy();
    expect(screen.getByText("CR-SO-2611-001.pdf")).toBeTruthy();
    expect((await screen.findAllByText("Carres collects on 2099/11/25, 2:00 PM")).length).toBe(2);
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Forecast: an item opens to its orders, and an order opens again in place", { timeout: 40_000 }, async () => {
    walk("/supplier/forecast");
    expect(await screen.findByRole("heading", { name: "Forecast" }, LOAD)).toBeTruthy();
    fireEvent.click(await rowOf("Mattress Queen"));
    expect(await screen.findByText("Sales orders with Mattress Queen")).toBeTruthy();
    fireEvent.click(await screen.findByText("CR-SO-2611-002"));
    expect(await screen.findByText("All items on this order")).toBeTruthy();
    // Still the Forecast: reading an order here leaves nothing.
    expect(screen.getByRole("heading", { name: "Forecast" })).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Pickup Requests: accepting, and asking Carres for another day", { timeout: 40_000 }, async () => {
    walk("/supplier/pickups");
    expect(await screen.findByRole("heading", { name: "Pickup Requests" }, LOAD)).toBeTruthy();
    fireEvent.click(await rowOf("CR-PKR-2611-001"));
    fireEvent.click(await screen.findByRole("button", { name: "Accept pickup" }));
    await waitFor(() => expect(asked.some((a) => a.method === "POST" && a.url.endsWith("/api/carres-supplier/pickups/accept"))).toBe(true));
    expect(asked.find((a) => a.url.endsWith("/pickups/accept"))!.body).toEqual({ ids: ["p1"] });
    expect(await screen.findByText("CR-PKR-2611-001 accepted")).toBeTruthy();

    fireEvent.click(pill(/^Accepted/));
    fireEvent.click(await rowOf("CR-PKR-2611-002"));
    fireEvent.click(await screen.findByRole("button", { name: "Change date" }));
    // Nothing to send until another day is picked; Carres agrees before it changes.
    const send = screen.getByRole("button", { name: "Send to Carres" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText("Carres agrees the new day before it changes.")).toBeTruthy();
    // A day button is named in the engine's one date format, its weekday in front.
    fireEvent.click(screen.getByRole("button", { name: "Thu 2099/11/26" }));
    expect(send.disabled).toBe(false);
    expect(screen.getByText("→ Thu 2099/11/26")).toBeTruthy();
    fireEvent.click(send);
    await waitFor(() => expect(asked.some((a) => a.method === "POST" && a.url.endsWith("/api/carres-supplier/pickups/p2/ask"))).toBe(true));
    expect(asked.find((a) => a.url.endsWith("/pickups/p2/ask"))!.body).toEqual({ kind: "date", date: "2099-11-26" });
    expect(await screen.findByText("Date change sent to Carres")).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Pickup Requests: ticking rows puts the review over the list", { timeout: 40_000 }, async () => {
    walk("/supplier/pickups");
    expect(await screen.findByRole("heading", { name: "Pickup Requests" }, LOAD)).toBeTruthy();
    fireEvent.click(within(await rowOf("CR-PKR-2611-001")).getByRole("checkbox"));
    expect(await screen.findByText("Review before accepting")).toBeTruthy();
    const go = screen.getByRole("button", { name: "Accept 1 pickup" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/These 2 units will be ready on/));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(asked.some((a) => a.method === "POST" && a.url.endsWith("/api/carres-supplier/pickups/accept"))).toBe(true));
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Collections, a row opening in place, By Month and a month's own page", { timeout: 40_000 }, async () => {
    walk("/supplier/finance");
    expect(await screen.findByRole("heading", { name: "Collections" }, LOAD)).toBeTruthy();
    fireEvent.click(await rowOf("Tan Ah Kow"));
    expect(await screen.findByText("Agreement No")).toBeTruthy();
    expect(screen.getByText("Collection · 1 of 3 months")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "By Month" }));
    expect(await screen.findByRole("heading", { name: "By Month" }, LOAD)).toBeTruthy();
    fireEvent.click(await rowOf("2026/12"));
    expect(await screen.findByText("Instalments due in 2026/12")).toBeTruthy();
    fireEvent.click(screen.getByText("All of 2026/12"));
    expect(await screen.findByText("Orders due this month", {}, LOAD)).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Settings: my account, and the people of my department", { timeout: 40_000 }, async () => {
    walk("/supplier/settings");
    expect(await screen.findByRole("heading", { name: "Settings" }, LOAD)).toBeTruthy();
    expect(screen.getByText("Your profile")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Users and access/ }));
    expect(await screen.findByText("Wan Store")).toBeTruthy();
    expect(asked.some((a) => a.url.endsWith("/api/carres-supplier/users?department=operation"))).toBe(true);
    // A person may not take away their own Manage users.
    fireEvent.click(await rowOf("Ops Person"));
    expect(await screen.findByText("Your access")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Manage users" }).getAttribute("aria-disabled")).toBe("true");
    await settle();
    expect(strays()).toEqual([]);
  });

  it("shows only the pages a person's access opens", { timeout: 40_000 }, async () => {
    ME = { ...baseMe(), user: { ...baseMe().user, canFinance: false, perms: { operation: ["v_orders", "v_pickups"], finance: [] } } };
    walk("/supplier/forecast");
    expect(await screen.findByRole("heading", { name: "Sales Orders" }, LOAD)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Forecast" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Collections" })).toBeNull();
    // No Export button without the Export permission.
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("a person given a password by their admin must choose their own first", { timeout: 40_000 }, async () => {
    ME = { ...baseMe(), user: { ...baseMe().user, mustChangePassword: true } };
    walk("/supplier/orders");
    expect(await screen.findByText("Choose your own password before you go on. Your admin set the one you signed in with.", {}, LOAD)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sales Orders" })).toBeNull();
  });
});

describe("signing in and the one-time link", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const answer = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const company = () => answer(200, { companyName: "Carres" });

  it("a visitor with no session is shown the sign-in page, whatever address they opened", async () => {
    fetchMock.mockImplementation((url: string) => (String(url).includes("/api/track/company") ? company() : answer(401, { error: "Please sign in." })));
    render(<MemoryRouter initialEntries={["/supplier/finance"]}><SupplierApp /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Your account opens the pages your company's role allows: Warehouse and Operation, or Finance.")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/carres-supplier/"))).toEqual([]);
  });

  it("signs in with the suppliers' API, keeps the token for the tab, and opens the first page the role allows", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/track/company")) return company();
      if (u.endsWith("/api/carres-supplier/auth/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({ email: "fin@supplier.com", password: "correct horse battery" });
        expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
        return answer(200, {
          token: "tok-1", expiresAt: "2026-11-16T00:00:00Z",
          user: { id: 9, name: "Fin", email: "fin@supplier.com", canOperation: false, canFinance: true, mustChangePassword: false, perms: { operation: [], finance: FIN_ALL } },
          supplier: { name: "Maker", code: "400-X" }, badges: { pickupsToAccept: 0 },
        });
      }
      if (u.endsWith("/api/carres-supplier/finance/summary")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
        return answer(200, { shared: false });
      }
      return answer(404, { error: "Not found." });
    });
    render(<MemoryRouter initialEntries={["/supplier/login"]}><SupplierApp /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "fin@supplier.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("No subscription orders are shared with your company.")).toBeTruthy();
    expect(supplierToken.get()).toBe("tok-1");
    expect(screen.queryByRole("link", { name: "Sales Orders" })).toBeNull();
    expect(screen.getByRole("link", { name: "Collections" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "By Month" })).toBeTruthy();
  });

  it("a refused session is dropped and the sign-in page comes back", async () => {
    supplierToken.set("old-token");
    fetchMock.mockImplementation((url: string) => (String(url).includes("/api/track/company") ? company() : answer(401, { error: "Your session has ended. Please sign in again." })));
    render(<MemoryRouter initialEntries={["/supplier/orders"]}><SupplierApp /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(supplierToken.get()).toBe("");
  });

  it("the one-time link's secret is read from the fragment, sent in the body, and removed from the address", async () => {
    window.history.replaceState(null, "", "/supplier/setup#t=secret-link-token");
    const sent: Array<{ url: string; body: unknown }> = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/track/company")) return company();
      sent.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith("/api/carres-supplier/auth/link")) return answer(200, { name: "Ana", email: "ana@supplier.com", purpose: "setup" });
      if (u.endsWith("/api/carres-supplier/auth/link/use")) return answer(200, { ok: true, email: "ana@supplier.com" });
      return answer(404, { error: "Not found." });
    });
    render(<MemoryRouter initialEntries={["/supplier/setup"]}><SupplierApp /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("secret-link-token");
    for (const s of sent) expect(s.url).not.toContain("secret-link-token");
    expect(sent[0]).toEqual({ url: expect.stringMatching(/\/auth\/link$/), body: { token: "secret-link-token" } });

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "correct horse batterx" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("The two passwords are not the same.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(sent.at(-1)).toEqual({ url: expect.stringMatching(/\/auth\/link\/use$/), body: { token: "secret-link-token", password: "correct horse battery" } }));
    expect(await screen.findByText("Your password is set. Sign in with it.")).toBeTruthy();
  });

  it("Forgot password: the email typed on the sign-in page goes along, and the page says the same for every email", async () => {
    const asked: Array<{ body: unknown; authorization: string | undefined }> = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/track/company")) return company();
      if (u.endsWith("/api/carres-supplier/auth/forgot")) {
        asked.push({ body: JSON.parse(String(init?.body)), authorization: (init?.headers as Record<string, string>).Authorization });
        return answer(200, { ok: true });
      }
      return answer(404, { error: "Not found." });
    });
    render(<MemoryRouter initialEntries={["/supplier/login"]}><SupplierApp /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: " Ana@Supplier.com " } });
    fireEvent.click(screen.getByRole("link", { name: "Forgot password?" }));

    expect(await screen.findByRole("heading", { name: "Forgot password" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("Ana@Supplier.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("If that email signs in here, a link is on its way. It works once, for 1 hour. Look in your spam folder too.");
    expect(asked).toEqual([{ body: { email: "Ana@Supplier.com" }, authorization: undefined }]);
    expect(supplierToken.get()).toBe("");

    fireEvent.click(screen.getByRole("link", { name: "Back to sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("Ana@Supplier.com");
  });

  it("Forgot password opens for a visitor with no session, and says when the server could not be reached", async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/track/company")) return company();
      if (u.endsWith("/api/carres-supplier/auth/forgot")) return Promise.reject(new TypeError("network"));
      return answer(404, { error: "Not found." });
    });
    render(<MemoryRouter initialEntries={["/supplier/forgot"]}><SupplierApp /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Forgot password" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send link" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@supplier.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The server could not be reached. Check your connection and try again.");
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
  });

  it("a link that can no longer be used offers the way to ask for the next one", async () => {
    window.history.replaceState(null, "", "/supplier/setup#t=old-link-token");
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/track/company")) return company();
      if (u.endsWith("/api/carres-supplier/auth/link")) return answer(404, { error: "This link is no longer valid. Ask Carres for a new one." });
      return answer(404, { error: "Not found." });
    });
    render(<MemoryRouter initialEntries={["/supplier/setup"]}><SupplierApp /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "This link cannot be used" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Ask for a new link" }));
    expect(await screen.findByRole("heading", { name: "Forgot password" })).toBeTruthy();
  });
});
