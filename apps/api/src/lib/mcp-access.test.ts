import { describe, expect, it } from "vitest";
import {
  appLabel,
  classifyPath,
  cleanQuery,
  isMcpAdminRole,
  leakCheckPaths,
  moduleCatalog,
  pkceS256,
  readablePaths,
  redactSecrets,
  sensitiveKeys,
  validCodeVerifier,
  validRedirectUri,
} from "./mcp-access";

describe("classifyPath — what the AI Connector may read", () => {
  it("accepts an ordinary read path and trims a trailing slash and query", () => {
    expect(classifyPath("/api/orders/")).toEqual({ ok: true, path: "/api/orders" });
    expect(classifyPath("/api/finance/payments?x=1")).toEqual({ ok: true, path: "/api/finance/payments" });
  });

  it("refuses anything outside /api and any traversal or encoding trick", () => {
    for (const p of ["/health", "orders", "/stripe/webhook", "/public/delivery-link/abc", "/api/../health", "/api//orders", "/api/%2e%2e/x", "/api/orders%2F1", "/api\\orders", "/api/a b"]) {
      expect(classifyPath(p).ok, p).toBe(false);
    }
  });

  it("refuses sign-in, account, the connector itself and the engine sign-on", () => {
    for (const p of ["/api/auth/me", "/api/account/email-change", "/api/mcp", "/api/mcp-admin/admin/overview", "/api/operation/scm-engine/session"]) {
      expect(classifyPath(p).ok, p).toBe(false);
    }
  });

  it("refuses the GET routes that write: the auto-assign enrol and the Stripe reconcile", () => {
    expect(classifyPath("/api/operation/staff").ok).toBe(false);
    expect(classifyPath("/api/orders/abc/stripe/checkout/cs_1").ok).toBe(false);
    expect(classifyPath("/api/rental/agreements/abc/stripe/checkout/cs_1").ok).toBe(false);
  });

  it("refuses file links and files", () => {
    for (const p of ["/api/finance/payables/files/url", "/api/operation/delivery-orders/x/signed-document", "/api/x/print", "/api/x/pdf", "/api/x/download"]) {
      expect(classifyPath(p).ok, p).toBe(false);
    }
  });

  it("does not over-block look-alike names", () => {
    expect(classifyPath("/api/staff").ok).toBe(true); // store staff list, not the operation enrol
    expect(classifyPath("/api/authorisations").ok).toBe(true);
    expect(classifyPath("/api/mcpx").ok).toBe(true);
  });
});

describe("redactSecrets — credentials never leave", () => {
  it("removes credential-shaped keys at any depth and names them", () => {
    const { value, removed } = redactSecrets({
      id: 1,
      password: "x",
      nested: [{ api_key: "k", apiKey: "k", pin_hash: "h", pinHash: "h", name: "ok", refresh_token: "r", link_token: "t" }],
      deep: { a: { b: { totp_secret: "s", service_role: "s", note: "keep" } } },
    });
    expect(value).toEqual({ id: 1, nested: [{ name: "ok" }], deep: { a: { b: { note: "keep" } } } });
    expect([...removed].sort()).toEqual(["apiKey", "api_key", "link_token", "password", "pinHash", "pin_hash", "refresh_token", "service_role", "totp_secret"].sort());
  });

  it("leaves money and people fields (the role decides those, the leak check reports them)", () => {
    const { value, removed } = redactSecrets({ cost: 100, supplierCode: "S1", salary: 1 });
    expect(value).toEqual({ cost: 100, supplierCode: "S1", salary: 1 });
    expect(removed.size).toBe(0);
  });
});

describe("sensitiveKeys — the leak check reports names, never values", () => {
  it("finds cost, supplier, salary, commission, IC and bank names in camel and snake case", () => {
    const body = { rows: [{ name: "a", cost: 1, supplierId: "s", supplier_code: "c", salary: 2, commissionRate: 3, ic_no: "x", bankAccount: "1", price: 9 }] };
    expect(sensitiveKeys(body)).toEqual(["bankAccount", "commissionRate", "cost", "ic_no", "salary", "supplierId", "supplier_code"]);
  });
});

describe("cleanQuery", () => {
  it("keeps scalar parameters with plain names and drops the rest", () => {
    const qs = cleanQuery({ from: "2026-11-01", limit: 5, all: true, bad$: "x", obj: { a: 1 }, arr: [1], nul: null });
    expect(qs.toString()).toBe("from=2026-11-01&limit=5&all=true");
    expect(cleanQuery("nope").toString()).toBe("");
  });
});

describe("routes -> modules and endpoints", () => {
  const routes = [
    { method: "GET", path: "/api/orders" },
    { method: "GET", path: "/api/orders/:id" },
    { method: "POST", path: "/api/orders" },
    { method: "GET", path: "/api/operation/orders" },
    { method: "GET", path: "/api/operation/staff" },
    { method: "GET", path: "/api/orders/:id/stripe/checkout/:sid" },
    { method: "ALL", path: "/api/*" },
    { method: "GET", path: "/api/auth/me" },
    { method: "GET", path: "/health" },
  ];

  it("lists only readable GET endpoints", () => {
    expect(readablePaths(routes, null)).toEqual(["/api/operation/orders", "/api/orders", "/api/orders/:id"]);
    expect(readablePaths(routes, "/api/orders")).toEqual(["/api/orders", "/api/orders/:id"]);
  });

  it("groups areas one level deeper", () => {
    expect(moduleCatalog(routes)).toEqual([
      { prefix: "/api/operation/orders", endpoints: 1 },
      { prefix: "/api/orders", endpoints: 2 },
    ]);
  });

  it("leak check probes parameter-free endpoints only", () => {
    expect(leakCheckPaths(routes)).toEqual(["/api/operation/orders", "/api/orders"]);
  });
});

describe("OAuth helpers", () => {
  it("PKCE S256 matches the RFC 7636 Appendix B vector", async () => {
    expect(await pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("a wrong verifier does not match (negative control)", async () => {
    expect(await pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl")).not.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("code verifier length and alphabet follow RFC 7636 §4.1", () => {
    expect(validCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(true);
    expect(validCodeVerifier("short")).toBe(false);
    expect(validCodeVerifier(`${"a".repeat(42)}!`)).toBe(false);
    expect(validCodeVerifier("a".repeat(129))).toBe(false);
  });

  it("redirect URI rule: https anywhere, http only on loopback, never a fragment or credentials", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(validRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:33418/cb")).toBe(true);
    expect(validRedirectUri("http://[::1]:8080/cb")).toBe(true);
    expect(validRedirectUri("http://evil.example.com/cb")).toBe(false);
    expect(validRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(validRedirectUri("https://user:pw@claude.ai/cb")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("not a url")).toBe(false);
  });

  it("names the AI app and the admin", () => {
    expect(appLabel("Claude")).toBe("Claude");
    expect(appLabel("ChatGPT connector")).toBe("ChatGPT");
    expect(appLabel("")).toBe("AI app");
    expect(isMcpAdminRole("principal")).toBe(true);
    expect(isMcpAdminRole("operation")).toBe(false);
    expect(isMcpAdminRole(null)).toBe(false);
  });
});
