/* Carres: the Supplier Platform is a surface of its own, outside the staff sign-in.
 *
 * The owner's rule (15 Nov 2026): a supplier's login must never be a way into Carres's system. On the screen side
 * that means three things, each pinned here:
 *   1. /supplier/* is its own surface, so the staff app, its providers and its sign-in never load for a supplier,
 *      while the staff pages whose address merely starts with the same letters stay staff pages;
 *   2. a supplier's browser never calls a staff route. The supplier pages never import the staff client, the staff
 *      session or the staff menu. They do draw the staff list's own parts (owner, 16 Nov 2026: they look exactly like
 *      the staff Sales Orders page), and the staff table stays off the staff routes for them: its saved layouts load
 *      only after the staff sign-in (lib/tableLayouts, started by auth/AuthContext alone), and no supplier table asks
 *      for custom fields, import, shared layouts or the printed letterhead. A signed-in walk through every page, with
 *      its clicks, proves the browser then asks the suppliers' own API and nothing else;
 *   3. the supplier's token and the staff token are different keys, and the one-time link's secret is read from the
 *      address fragment and removed from the address at once. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { appSurfaceForPath } from "../../routing/appSurface";
import { supplierToken } from "./api";
import { SUPPLIER_HOSTS, isSupplierHost } from "./host";
import { fmtDay, fmtMonth, fmtStamp, money, soStatusLabel } from "./ui";
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
    // Every other address is as it was: the engine site, a preview of it, a look-alike name.
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
    // The tags, not the words: the comment in that branch names both to say they are absent.
    expect(branch).not.toContain("<AuthProvider");
    expect(branch).not.toContain("<AuthGate");
  });

  it("main.tsx draws no supplier page inside a frame", () => {
    // The site refuses to send /supplier into a frame, but by the address the document was loaded from: the staff
    // page at "/" may be framed, and the app can then move to /supplier without loading a new document. So the
    // supplier branch refuses by itself, before it draws anything.
    const main = readFileSync(resolve(HERE, "../../main.tsx"), "utf8");
    const branch = main.slice(main.indexOf('if (surface === "supplier")'), main.indexOf('if (surface === "survey")'));
    const refusal = branch.indexOf("if (CARRES_EMBEDDED) return null;");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(branch.indexOf("<SupplierApp />"));
    // And "inside a frame" is asked of the window itself, where a page cannot lie about it.
    const embed = readFileSync(resolve(HERE, "../embed.ts"), "utf8");
    expect(embed).toContain("try { return window.self !== window.top; } catch { return true; }");
  });

  it("choosing a password through the link signs the person in", () => {
    // Sent back to the sign-in page to type it again, a person whose email is being hammered with wrong tries is
    // locked once more before they get there.
    const app = readFileSync(resolve(HERE, "SupplierApp.tsx"), "utf8");
    const page = app.slice(app.indexOf("function SetPasswordPage"), app.indexOf("function AccountPage"));
    expect(page).toContain("supplierToken.set(out.token);");
    expect(page).toContain("onSignedIn({ user: out.user, supplier: out.supplier, badges: out.badges });");
    expect(app).toContain('if (path === "/supplier/setup") return <SetPasswordPage onSignedIn={enter} />;');
  });

  it("main.tsx does not offer a supplier the staff app's install prompt", () => {
    // PwaBanners says "Install Carres · ERP" and asks the staff API for its branding: neither is for a supplier.
    const main = readFileSync(resolve(HERE, "../../main.tsx"), "utf8");
    expect(main).toContain('return useAppSurface() === "supplier" ? null : <PwaBanners />;');
    // It is mounted through that one gate and nowhere else.
    expect(main.match(/<PwaBanners \/>/g)).toHaveLength(1);
    expect(main).toContain("<StaffPwaBanners />");
  });

  it("every page chunk sits in its own crash slot, so a failed chunk leaves the menu standing", () => {
    const app = readFileSync(resolve(HERE, "SupplierApp.tsx"), "utf8");
    expect(app).not.toMatch(/<Suspense\b/);
    expect(app).toContain("<LazySlot resetKey={`supplier:${pathname}`}");
  });
});

describe("the supplier pages keep away from the staff app", () => {
  it("has source files to check", () => {
    expect(sources).toEqual(expect.arrayContaining(["api.ts", "ui.tsx", "SupplierApp.tsx", "OrdersPage.tsx", "ForecastPage.tsx", "PickupsPage.tsx", "FinancePage.tsx"]));
  });

  it.each(sources)("%s imports no staff client, session, menu or saved layouts", (file) => {
    const text = readFileSync(resolve(HERE, file), "utf8");
    const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const banned of ["api/client", "auth/AuthContext", "auth/AuthGate", "components/Layout", "hooks/useQuery", "hooks/useUdf", "lib/tableLayouts", "supplier-staff"]) {
      expect(imports.filter((i) => i.includes(banned)), `${file} imports ${banned}`).toEqual([]);
    }
  });

  it.each(sources)("%s gives the staff table nothing that reaches a staff route", (file) => {
    // Custom fields are read and written through the staff API; import is not a supplier's; shared and seeded
    // layouts are saved through the staff API; the printed letterhead reads the staff branding.
    const text = readFileSync(resolve(HERE, file), "utf8");
    for (const prop of ["udfTable", "onImport", "layoutPresets", "layoutSeeds", "onApplyLayoutSeed", "onExportPdf"]) {
      expect(text, `${file} passes ${prop}`).not.toMatch(new RegExp(`\\b${prop}\\s*=`));
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
    // The same digits a staff page shows (vendor/shared/format.ts): year first, no month names.
    expect(fmtDay("2026-11-20")).toBe("2026/11/20");
    expect(fmtMonth("2026-12")).toBe("2026/12");
    expect(fmtMonth("")).toBe("");
    // 16:30 UTC is 00:30 the next day in Kuala Lumpur.
    expect(fmtStamp("2026-11-20T16:30:00Z")).toBe("2026/11/21 00:30");
    // Not known is "", never the formatter's dash: each page names the gap in words.
    for (const none of [null, undefined, "", "not a date"]) {
      expect(fmtDay(none)).toBe("");
      expect(fmtStamp(none)).toBe("");
    }
  });

  it("writes money the Malaysian way, and a stage in Carres's words", () => {
    expect(money(1734.6)).toBe("RM 1,734.60");
    expect(soStatusLabel("CONFIRMED")).toBe("Submitted");
    expect(soStatusLabel("SOMETHING_NEW")).toBe("Something new");
  });
});

// ── A signed-in walk ─────────────────────────────────────────────────────────────────────────────────────────────

const ME = {
  user: { name: "Ops", email: "ops@supplier.test", canOperation: true, canFinance: true },
  supplier: { name: "Maker", code: "400-X" },
  badges: { pickupsToAccept: 1 },
};
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
  id: "p1", requestNo: "CR-PU-2611-001", supplierName: "Maker", expectedDate: "2026-11-25", expectedTime: null, note: null, status: "REQUESTED",
  requestedAt: "2026-11-16T02:00:00Z", acceptedAt: null, acceptedByName: null, collectedAt: null, cancelledAt: null, cancelReason: null,
  soDocNos: ["CR-SO-2611-001"], lineCount: 1, unitCount: 2,
  lines: [{ soDocNo: "CR-SO-2611-001", soItemId: "i1", itemCode: "MAT-Q", description: "Mattress Queen", spec: "183 x 190", modelName: null, uom: "UNIT", qty: 2 }],
};
const FIN_ORDER = {
  id: "f1", agreementNo: "CR-AG-2611-001", soNo: "CR-SO-2611-001", customerName: "Tan Ah Kow", item: "Mattress Queen", termMonths: 60, monthlyFee: 100,
  ratePct: 20, startDate: "2026-11-01", status: "active", state: "on_time", contractValue: 6000, shareTotal: 1200, paidCount: 1, collected: 100,
  shareEarned: 20, toCollect: 5900, shareToCome: 1180, overdueMonths: 0, overdueAmount: 0, overdueShare: 0, nextDueDate: "2026-12-01", lastPaidOn: "2026-11-01",
};

/** The suppliers' API, as far as these pages ask it. Anything else is answered 404 and fails the walk. */
function supplierServer(path: string, method: string, search: URLSearchParams): unknown {
  if (path === "/api/track/company") return { companyName: "Carres" };
  if (path === "/api/carres-supplier/auth/me") return ME;
  if (path === "/api/carres-supplier/orders") {
    const page = Number(search.get("page") ?? 1);
    return { rows: page === 1 ? [ORDER_1, ORDER_2] : [], total: 2, page, pageSize: Number(search.get("pageSize") ?? 50), counts: { all: 2, incoming: 1, processing: 1, delivered: 0 } };
  }
  if (path === `/api/carres-supplier/orders/${ORDER_1.docNo}`) {
    return { order: { ...ORDER_1, trail: [{ at: "2026-11-02T02:00:00Z", kind: "received", code: "RECEIVED", ref: null, detail: null }], map: [] } };
  }
  if (path === "/api/carres-supplier/forecast") {
    return {
      rows: [{ itemCode: "MAT-Q", description: "Mattress Queen", spec: "183 x 190", modelName: null, category: "mattress", uom: "UNIT", incoming: 2, processing: 1, total: 3, byMonth: { "2026-11": 3 } }],
      months: ["2026-11"], totals: { incoming: 2, processing: 1, total: 3, orders: 2 },
    };
  }
  if (path === "/api/carres-supplier/pickups") return { rows: [PICKUP] };
  if (path === "/api/carres-supplier/pickups/p1") return { pickup: PICKUP };
  if (path === "/api/carres-supplier/pickups/p1/accept" && method === "POST") return { pickup: { ...PICKUP, status: "ACCEPTED", acceptedAt: "2026-11-16T03:00:00Z", acceptedByName: "Ops" } };
  if (path === "/api/carres-supplier/finance/summary") {
    return {
      shared: true, asOf: "2026-11-16",
      totals: { orders: 1, contractValue: 6000, shareTotal: 1200, collected: 100, collectedCount: 1, shareEarned: 20, toCollect: 5900, shareToCome: 1180, overdueOrders: 0, overdueMonths: 0, overdueAmount: 0, overdueShare: 0, defaultOrders: 0 },
      months: [{ month: "2026-11", due: 100, dueShare: 20, collected: 100, collectedShare: 20, open: 0, openShare: 0 }],
      orders: [FIN_ORDER],
    };
  }
  if (path === "/api/carres-supplier/finance/orders/f1") {
    return { asOf: "2026-11-16", order: FIN_ORDER, instalments: [{ seq: 1, dueDate: "2026-11-01", amountDue: 100, state: "paid", paidOn: "2026-11-01", paidAmount: 100, share: 20, daysLate: 0 }] };
  }
  return null;
}

const readBlob = (blob: Blob) => new Promise<string>((done) => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result).replace(/^﻿/, ""));
  reader.readAsText(blob);
});

describe("a signed-in supplier, clicking through every page, asks the suppliers' own API and nothing else", () => {
  const asked: Array<{ method: string; url: string }> = [];
  const allowed = (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    return path.startsWith("/api/carres-supplier/") || path === "/api/track/company";
  };

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    asked.length = 0;
    supplierToken.set("tok-1");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      asked.push({ method, url });
      const u = new URL(url, "http://localhost");
      const body = supplierServer(u.pathname, method, u.searchParams);
      return Promise.resolve(new Response(JSON.stringify(body ?? { error: "Not found." }), { status: body ? 200 : 404, headers: { "content-type": "application/json" } }));
    }));
    // The other ways a page can reach a server are watched too.
    vi.stubGlobal("XMLHttpRequest", class { open(_m: string, url: string) { asked.push({ method: "XHR", url: String(url) }); } send() {} setRequestHeader() {} addEventListener() {} abort() {} });
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (url: string) => { asked.push({ method: "BEACON", url: String(url) }); return true; } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "sendBeacon");
    supplierToken.clear();
  });

  const walk = (path: string) => render(<MemoryRouter initialEntries={[path]}><SupplierApp /></MemoryRouter>);
  const settle = () => new Promise((r) => setTimeout(r, 1500)); // past the table's layout save delay (1.2 s)
  const strays = () => asked.filter((a) => !allowed(a.url));
  // Each page is its own chunk, loaded on first use: the first sight of a page may take a while in a test run.
  const LOAD = { timeout: 15_000 };
  const inTable = (els: HTMLElement[]) => els.find((el) => el.closest("td")) ?? els[0]!;

  it("Sales Orders: the list, its Columns, the quick view, Cards and the exported file", { timeout: 40_000 }, async () => {
    const files: Blob[] = [];
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { files.push(b); return "blob:x"; }), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    walk("/supplier/orders");

    expect(await screen.findByRole("heading", { name: "Sales Orders" }, LOAD)).toBeTruthy();
    // In the table, and in the cards a phone shows instead.
    expect(await screen.findAllByText("Tan Ah Kow")).toHaveLength(2);
    // The figure cards read the counts the list answers.
    expect(screen.getByText("Total Orders")).toBeTruthy();
    expect(screen.getByText("Pickups to Accept")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    expect(await screen.findByText("Delivery Address")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(inTable(screen.getAllByText("Tan Ah Kow")));
    const view = await screen.findByRole("dialog");
    expect(within(view).getByText("CR-SO-2611-002")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(files).toHaveLength(1));
    const lines = (await readBlob(files[0]!)).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^SO No,SO Date,Customer,Items,Qty/);
    // The staff writer keeps a cell that starts like a formula as text, and Items carries every line.
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[1]).toContain("2 UNIT Mattress Queen (183 x 190)");
    // The file covers every order of the view, asked a page of 200 at a time.
    expect(asked.some((a) => a.url.includes("/api/carres-supplier/orders?") && a.url.includes("pageSize=200"))).toBe(true);
    click.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(await screen.findAllByText("CR-SO-2611-001")).toBeTruthy();

    // A phone's search box asks the suppliers' API once typing stops.
    fireEvent.change(screen.getByLabelText("Search sales orders"), { target: { value: "Tan " } });
    await waitFor(() => expect(asked.some((a) => a.url.includes("/api/carres-supplier/orders?") && a.url.includes("q=Tan&"))).toBe(true));

    await settle();
    expect(strays()).toEqual([]);
  });

  it("an order's own page", { timeout: 40_000 }, async () => {
    walk("/supplier/orders/CR-SO-2611-001");
    expect(await screen.findByText("Order received", {}, LOAD)).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Forecast", { timeout: 40_000 }, async () => {
    walk("/supplier/forecast");
    expect(await screen.findByRole("heading", { name: "Forecast" }, LOAD)).toBeTruthy();
    expect(await screen.findByText("Mattress Queen")).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Pickup Requests: the list, the quick view and accepting", { timeout: 40_000 }, async () => {
    walk("/supplier/pickups");
    expect(await screen.findByRole("heading", { name: "Pickup Requests" }, LOAD)).toBeTruthy();
    // The number is also under Next Pickup; the row is the one in the table.
    fireEvent.click(inTable(await screen.findAllByText("CR-PU-2611-001")));
    fireEvent.click(await screen.findByRole("button", { name: "Accept pickup" }));
    await waitFor(() => expect(asked.some((a) => a.method === "POST" && a.url.endsWith("/api/carres-supplier/pickups/p1/accept"))).toBe(true));
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Finance: the orders, by month, and one order's instalments", { timeout: 40_000 }, async () => {
    walk("/supplier/finance");
    fireEvent.click(await screen.findByRole("button", { name: /By month/ }, LOAD));
    expect(await screen.findByText("Instalments Due")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /All orders/ }));
    fireEvent.click(inTable(await screen.findAllByText("Tan Ah Kow")));
    expect(await screen.findByText("Agreement No", {}, LOAD)).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
  });

  it("Account", { timeout: 40_000 }, async () => {
    walk("/supplier/account");
    expect(await screen.findByRole("heading", { name: "Your account" }, LOAD)).toBeTruthy();
    await settle();
    expect(strays()).toEqual([]);
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
    // No request to the suppliers' API was made without a token.
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
          user: { name: "Fin", email: "fin@supplier.com", canOperation: false, canFinance: true },
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
    // A Finance-only person has no Sales Orders, Forecast or Pickup pages.
    expect(screen.queryByRole("link", { name: "Sales Orders" })).toBeNull();
    expect(screen.getByRole("link", { name: "Finance" })).toBeTruthy();
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
    // Already typed: not asked for twice. (An email field drops the spaces round what is typed.)
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("Ana@Supplier.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("If that email signs in here, a link is on its way. It works once, for 1 hour. Look in your spam folder too.");
    // One ask, with the email and nothing else, and no token: asking for a link signs nobody in.
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
    // Nothing to send until an email is typed.
    expect((screen.getByRole("button", { name: "Send link" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@supplier.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The server could not be reached. Check your connection and try again.");
    // Still the form: nothing claims a link was sent.
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
