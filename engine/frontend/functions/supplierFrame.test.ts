// Carres only. The supplier pages (/supplier) are open to the internet before any sign-in and are never shown
// inside another page, so no site may put one in a frame and draw over it to take a click or a typed password.
// The staff pages stay frameable: the Carres portal shows them inside itself.
import { describe, expect, it } from "vitest";

import { isSupplierPage, onRequest, supplierMoveTo } from "./_middleware";

const html = () => new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
// A preview of the site: the production address sends its supplier pages on (the last tests here), a preview keeps
// showing them, so the frame rule is checked where the pages are still served.
const SITE = "https://abc123.carres-scm.pages.dev";
const call = (path: string, answer: Response = html()) =>
  onRequest({ request: new Request(`${SITE}${path}`), next: async () => answer });

describe("supplier pages cannot be framed", () => {
  it("knows a supplier page from a staff page", () => {
    for (const path of ["/supplier", "/supplier/", "/supplier/orders", "/supplier/orders/CR-SO-1?x=1", "/supplier/set-password"]) {
      expect(isSupplierPage(`https://carres-scm.pages.dev${path}`), path).toBe(true);
    }
    for (const path of ["/", "/scm/suppliers", "/scm/supplier-pickups", "/suppliers", "/supplierx", "/settings?tab=suppliers"]) {
      expect(isSupplierPage(`https://carres-scm.pages.dev${path}`), path).toBe(false);
    }
  });

  it("a supplier page is sent with both ways of refusing a frame, enforced", async () => {
    for (const path of ["/supplier", "/supplier/orders", "/supplier/finance/orders/abc"]) {
      const res = await call(path);
      expect(res.headers.get("Content-Security-Policy"), path).toBe("frame-ancestors 'none'");
      expect(res.headers.get("X-Frame-Options"), path).toBe("DENY");
      // The watching policy every page gets is still there beside it.
      expect(res.headers.get("Content-Security-Policy-Report-Only"), path).toContain("script-src 'self'");
    }
  });

  it("a staff page keeps being frameable by the portal", async () => {
    for (const path of ["/", "/scm/supplier-pickups", "/settings"]) {
      const res = await call(path);
      expect(res.headers.get("Content-Security-Policy"), path).toBeNull();
      expect(res.headers.get("X-Frame-Options"), path).toBeNull();
      expect(res.headers.get("Content-Security-Policy-Report-Only"), path).toContain("https://carres-portal.pages.dev");
    }
  });

  it("only pages are touched: a script or an API answer under /supplier is left as it is", async () => {
    const js = new Response("export const a = 1;", { status: 200, headers: { "Content-Type": "application/javascript" } });
    const res = await call("/supplier/assets/app.js", js);
    expect(res).toBe(js);
    expect(res.headers.get("X-Frame-Options")).toBeNull();
  });
});

describe("the supplier pages moved to their own address", () => {
  const PROD = "https://carres-scm.pages.dev";
  const never = async () => { throw new Error("the page must not be served"); };

  it("a supplier page opened at the old production address is sent on, with the same path", async () => {
    for (const [path, to] of [
      ["/supplier", "https://supp.carresofficial.com/supplier"],
      ["/supplier/", "https://supp.carresofficial.com/supplier/"],
      ["/supplier/login", "https://supp.carresofficial.com/supplier/login"],
      ["/supplier/setup", "https://supp.carresofficial.com/supplier/setup"],
      ["/supplier/orders/CR-SO-2611-001?view=all", "https://supp.carresofficial.com/supplier/orders/CR-SO-2611-001?view=all"],
    ] as const) {
      const res = await onRequest({ request: new Request(`${PROD}${path}`), next: never });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("Location"), path).toBe(to);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    // The address is matched whole, whatever its letter case.
    expect(supplierMoveTo(new Request("https://CARRES-SCM.pages.dev/supplier/login"))).toBe("https://supp.carresofficial.com/supplier/login");
  });

  it("everything else at that address is served as before: the staff pages, the files, the one page at the root", async () => {
    for (const path of ["/", "/index.html", "/scm/suppliers", "/scm/supplier-pickups", "/settings?tab=suppliers", "/suppliers", "/supplierx", "/assets/app-1a2b.js", "/logo-wordmark.png", "/api/carres-supplier/auth/me"]) {
      expect(supplierMoveTo(new Request(`${PROD}${path}`)), path).toBeNull();
    }
    const res = await onRequest({ request: new Request(`${PROD}/`), next: async () => html() });
    expect(res.status).toBe(200);
  });

  it("a preview of the site, a local run and the new address itself keep showing the pages", () => {
    for (const origin of ["https://abc123.carres-scm.pages.dev", "http://localhost:5173", "http://127.0.0.1:8788", "https://supp.carresofficial.com", "https://carres-scm.pages.dev.evil.test"]) {
      expect(supplierMoveTo(new Request(`${origin}/supplier/login`)), origin).toBeNull();
    }
  });

  it("only a page being read is sent on", () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      expect(supplierMoveTo(new Request(`${PROD}/supplier/login`, { method })), method).toBeNull();
    }
    expect(supplierMoveTo(new Request(`${PROD}/supplier/login`, { method: "HEAD" }))).toBe("https://supp.carresofficial.com/supplier/login");
  });
});
