// Carres only. The supplier pages (/supplier) are open to the internet before any sign-in and are never shown
// inside another page, so no site may put one in a frame and draw over it to take a click or a typed password.
// The staff pages stay frameable: the Carres portal shows them inside itself.
import { describe, expect, it } from "vitest";

import { isSupplierPage, onRequest } from "./_middleware";

const html = () => new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
const call = (path: string, answer: Response = html()) =>
  onRequest({ request: new Request(`https://carres-scm.pages.dev${path}`), next: async () => answer });

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
