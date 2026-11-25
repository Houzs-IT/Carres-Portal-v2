import { beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Hono } from "hono";
import { server } from "../test/server";
import { signTestJwt, useTestJwks } from "../test/jwt";

/* The person's session is minted by GoTrue in production (lib/mcp-session.ts). Here it is a test-signed ES256 JWT,
 * so the REAL auth middleware, role guards and data client run against it. */
const session = vi.hoisted(() => ({ jwt: "" }));
vi.mock("../lib/mcp-session", () => ({
  McpSessionError: class extends Error {},
  sessionFor: vi.fn(async () => session.jwt),
  releaseSession: vi.fn(async () => undefined),
}));

const { default: app } = await import("../index");
const { mcpAppRoutes, readEndpoint, setMcpApp, MAX_RESULT_CHARS, authorizationServerMetadata } = await import("./mcp");
const { readablePaths } = await import("../lib/mcp-access");

const env = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
  STAFF_SESSION_SECRET: "test-staff-secret",
};
const ORIGIN = "https://api.carresofficial.com";
const call = (path: string, init?: RequestInit) => app.fetch(new Request(ORIGIN + path, init), env);

beforeAll(() => useTestJwks());

describe("discovery and the unauthenticated MCP endpoint", () => {
  it("answers 401 with a WWW-Authenticate that points at the protected-resource metadata", async () => {
    const res = await call("/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer realm="carres-erp", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  });

  it("serves both discovery documents at the site root, with and without the resource path", async () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const res = await call(p);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    }
    for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/mcp"]) {
      const res = await call(p);
      expect(await res.json()).toEqual(authorizationServerMetadata(ORIGIN));
    }
    expect(authorizationServerMetadata(ORIGIN)).toMatchObject({ code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  });

  it("GET on the MCP endpoint is 405 (stateless server, no stream)", async () => {
    expect((await call("/api/mcp")).status).toBe(405);
  });

  it("registration refuses a non-loopback http redirect before touching the database", async () => {
    const res = await call("/api/mcp/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x", redirect_uris: ["http://evil.example.com/cb"] }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("authorize without client or redirect is refused before touching the database", async () => {
    expect((await call("/api/mcp/oauth/authorize?response_type=code")).status).toBe(400);
  });
});

describe("a connector token is not an API credential", () => {
  it("authMiddleware refuses a crmcp_ token on an ordinary route", async () => {
    const res = await call("/api/orders", { headers: { authorization: "Bearer crmcp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" } });
    expect(res.status).toBe(401);
  });

  it("the admin routes need a signed-in session too", async () => {
    expect((await call("/api/mcp-admin/me")).status).toBe(401);
  });
});

describe("tool reads run as the person, GET only", () => {
  const ctxFor = () => {
    const h = new Hono();
    let captured: Parameters<typeof readEndpoint>[0] | null = null;
    h.get("/x", (c) => {
      captured = c;
      return c.text("ok");
    });
    return Promise.resolve(h.fetch(new Request(`${ORIGIN}/x`), env)).then(() => captured!);
  };

  it("the route table offers no blocked or writing GET", () => {
    const paths = readablePaths(mcpAppRoutes(), null);
    expect(paths.length).toBeGreaterThan(50);
    for (const bad of ["/api/operation/staff", "/api/auth/me", "/api/account/email-change", "/api/mcp-admin/me", "/api/orders/:id/stripe/checkout/:sid"]) {
      expect(paths, bad).not.toContain(bad);
    }
    expect(paths.every((p) => p.startsWith("/api/"))).toBe(true);
  });

  it("a role the route refuses gets 'Not available to your role' (bd on an operation route)", async () => {
    session.jwt = await signTestJwt("11111111-1111-4111-8111-111111111111", { email: "bd@x.com", app_metadata: { role: "bd" } });
    const c = await ctxFor();
    const r = await readEndpoint(c, "11111111-1111-4111-8111-111111111111", "/api/operation/badges", undefined);
    expect(r.status).toBe(403);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/Not available to your role/);
  });

  it("the database is asked with the PERSON's JWT, never the service key, and only with GET", async () => {
    session.jwt = await signTestJwt("22222222-2222-4222-8222-222222222222", { email: "op@x.com", app_metadata: { role: "operation" } });
    const seen: { method: string; auth: string | null; apikey: string | null }[] = [];
    server.use(
      http.all("https://test.supabase.co/rest/v1/*", ({ request }) => {
        seen.push({ method: request.method, auth: request.headers.get("authorization"), apikey: request.headers.get("apikey") });
        return HttpResponse.json([], { headers: { "content-range": "0-0/0" } });
      }),
    );
    const c = await ctxFor();
    const r = await readEndpoint(c, "22222222-2222-4222-8222-222222222222", "/api/operation/badges", undefined);
    expect(r.status).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(["GET", "HEAD"]).toContain(s.method);
      expect(s.auth).toBe(`Bearer ${session.jwt}`);
      expect(s.apikey).toBe("test-anon");
    }
  });

  it("a blocked path never reaches the app", async () => {
    const c = await ctxFor();
    const r = await readEndpoint(c, "22222222-2222-4222-8222-222222222222", "/api/operation/staff", undefined);
    expect(r.status).toBe(400);
    expect(r.note).toBe("blocked path");
  });

  // Last in the file: it swaps the in-process app for a stub that answers a big reply with a credential in it.
  it("strips credential keys and caps the reply; the stub sees GET with the person's JWT only", async () => {
    const seen: { method: string; auth: string | null }[] = [];
    setMcpApp({
      routes: [],
      fetch: (req: Request) => {
        seen.push({ method: req.method, auth: req.headers.get("authorization") });
        const big = Array.from({ length: 4000 }, (_, i) => ({ id: `row-${i}`, note: "x".repeat(20), password: "never-shown" }));
        return Response.json({ rows: big, api_key: "never-shown" });
      },
    });
    session.jwt = "the-persons-jwt";
    const c = await ctxFor();
    const r = await readEndpoint(c, "33333333-3333-4333-8333-333333333333", "/api/orders", { limit: 5 });
    const out = r.result.content[0].text;
    expect(out).not.toContain("never-shown");
    expect(out).toMatch(/Credential fields removed: .*password/);
    expect(out).toMatch(/Reply cut at 60000 characters/);
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 300);
    expect(seen).toEqual([{ method: "GET", auth: "Bearer the-persons-jwt" }]);
    expect(r.target).toBe("/api/orders?limit=5");
  });
});
