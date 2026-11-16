/* Carres: the Supplier Platform is a surface of its own, outside the staff sign-in.
 *
 * The owner's rule (15 Nov 2026): a supplier's login must never be a way into Carres's system. On the screen side
 * that means three things, each pinned here:
 *   1. /supplier/* is its own surface, so the staff app, its providers and its sign-in never load for a supplier,
 *      while the staff pages whose address merely starts with the same letters stay staff pages;
 *   2. the supplier pages never import the staff client, the staff session or the staff table (whose layouts are
 *      saved through staff routes): a supplier's browser must not call a staff route;
 *   3. the supplier's token and the staff token are different keys, and the one-time link's secret is read from the
 *      address fragment and removed from the address at once. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { appSurfaceForPath } from "../../routing/appSurface";
import { supplierToken } from "./api";
import { SUPPLIER_HOSTS, isSupplierHost } from "./host";
import { Table, downloadCsv, fmtDay, fmtMonth, fmtStamp, money, soStatusLabel, toCsv, type Column } from "./ui";
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

describe("the supplier's table", () => {
  afterEach(cleanup);
  type Row = { no: string; state: string; items: string };
  const columns: Column<Row>[] = [
    { key: "no", header: "No", cell: (r) => r.no },
    { key: "state", header: "Status", cell: (r) => r.state },
    { key: "items", header: "Items", wrap: true, cell: (r) => r.items },
  ];

  it("keeps a number and a status on one line; only a column that asks may break", () => {
    render(<Table columns={columns} rows={[{ no: "CR-SO-2611-040", state: "In default", items: "A long item name" }]} rowKey={(r) => r.no} empty="None" />);
    expect(screen.getByText("CR-SO-2611-040").closest("td")?.className).toContain("whitespace-nowrap");
    expect(screen.getByText("In default").closest("td")?.className).toContain("whitespace-nowrap");
    expect(screen.getByText("A long item name").closest("td")?.className).not.toContain("whitespace-nowrap");
  });
});

describe("the supplier pages keep away from the staff app", () => {
  it("has source files to check", () => {
    expect(sources).toEqual(expect.arrayContaining(["api.ts", "ui.tsx", "SupplierApp.tsx", "OrdersPage.tsx", "ForecastPage.tsx", "PickupsPage.tsx", "FinancePage.tsx"]));
  });

  it.each(sources)("%s imports no staff client, session, layout or table", (file) => {
    const text = readFileSync(resolve(HERE, file), "utf8");
    const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const banned of ["api/client", "auth/AuthContext", "auth/AuthGate", "components/Layout", "components/DataTable", "hooks/useQuery", "lib/tableLayouts", "supplier-staff"]) {
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

  type Row = { a: string; b: number };
  const csvColumns = [
    { key: "a", header: "Name", cell: () => null, csv: (r: Row) => r.a },
    { key: "b", header: "Qty", cell: () => null, csv: (r: Row) => r.b },
    { key: "c", header: "Screen only", cell: () => null },
  ];

  it("a CSV keeps only the columns meant for it, and a text cell that starts like a formula is written as text", () => {
    const text = toCsv(csvColumns, [
      { a: '=HYPERLINK("http://x")', b: 2 },
      { a: "Tan, Ah Kow", b: 1 },
      { a: "+60 12 777", b: -3 },
      { a: "@cmd", b: 0 },
    ]);
    expect(text.split("\r\n")).toEqual([
      "Name,Qty",
      `"'=HYPERLINK(""http://x"")",2`,
      '"Tan, Ah Kow",1',
      // A number stays a number, even a negative one; only text is guarded.
      "'+60 12 777,-3",
      "'@cmd,0",
    ]);
  });

  it("downloads the file through a link", () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    downloadCsv("t.csv", csvColumns, [{ a: "x", b: 1 }]);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
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
});
