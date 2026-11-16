import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

const USER = "11111111-1111-1111-1111-000000000998";
const baseEnv = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
  STAFF_SESSION_SECRET: "test-staff-secret-0240-abcdef",
};
const engineEnv = { ...baseEnv, SCM_ENGINE_API: "https://engine.test/", SCM_ENGINE_SITE: "https://scm.test/", SCM_ENGINE_SSO_SECRET: "s".repeat(32) };

async function post(env: object, role = "operation") {
  const jwt = await signTestJwt(USER, { email: "ops@carres.com", app_metadata: { role } });
  return app.fetch(new Request("http://t/api/operation/scm-engine/session", { method: "POST", headers: { Authorization: `Bearer ${jwt}` } }), env);
}

beforeEach(() => useTestJwks());
afterEach(() => vi.restoreAllMocks());
afterAll(() => _setJwksForTesting(null));

describe("POST /api/operation/scm-engine/session", () => {
  it("501 when the engine is not set up", async () => {
    expect((await post(baseEnv)).status).toBe(501);
  });

  it("403 for a role outside operation, principal, hr and finance", async () => {
    expect((await post(engineEnv, "dealer")).status).toBe(403);
  });

  it("lets finance ask: its menu holds Houzs's Finance (owner, 11 Nov 2026)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "tok" }), { status: 200 }));
    expect((await post(engineEnv, "finance")).status).toBe(200);
  });

  it("lets hr ask too: its menu holds Houzs's Team, Mail Center and IT Support", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "tok" }), { status: 200 }));
    expect((await post(engineEnv, "hr")).status).toBe(200);
  });

  it("asks the engine with a signed assertion and hands back its session and site", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "tok", session_pass: "sp" }), { status: 200 }));
    const res = await post(engineEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site: "https://scm.test", token: "tok", sessionPass: "sp" });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://engine.test/api/carres-sso");
    const { assertion } = JSON.parse(String(init.body)) as { assertion: string };
    const claims = JSON.parse(atob(assertion.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims).toMatchObject({ email: "ops@carres.com", role: "operation" });
  });

  it("calls the engine through the service binding when there is one", async () => {
    const global = vi.spyOn(globalThis, "fetch");
    const bound = vi.fn(async () => new Response(JSON.stringify({ token: "tok" }), { status: 200 }));
    const res = await post({ ...engineEnv, SCM_ENGINE: { fetch: bound } });
    expect(res.status).toBe(200);
    expect(bound).toHaveBeenCalledOnce();
    expect(global).not.toHaveBeenCalled();
  });

  it("502 when the engine cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    expect((await post(engineEnv)).status).toBe(502);
  });
});

describe("GET /api/operation/scm-engine/supplier-asks (the Alerts bell, owner 17 Nov 2026)", () => {
  async function asks(env: object, role = "operation") {
    const jwt = await signTestJwt(USER, { email: "ops@carres.com", app_metadata: { role } });
    return app.fetch(new Request("http://t/api/operation/scm-engine/supplier-asks", { headers: { Authorization: `Bearer ${jwt}` } }), env);
  }
  const ASK = { id: "p1", requestNo: "CR-PKR-2611-001", supplierName: "ZZT SOFA", kind: "date", askDate: "2026-11-26", expectedDate: "2026-11-20", askedAt: "2026-11-17T01:00:00Z" };

  it("only the people who answer asks: operation and the principal", async () => {
    for (const role of ["finance", "hr", "dealer", "supplier"]) expect((await asks(engineEnv, role)).status).toBe(403);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ count: 0, asks: [] }), { status: 200 }));
    expect((await asks(engineEnv, "principal")).status).toBe(200);
  });

  it("501 when the engine is not set up", async () => {
    expect((await asks(baseEnv)).status).toBe(501);
  });

  it("asks the engine with a signature for this purpose only, through the binding, and passes on only what the bell shows", async () => {
    const bound = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ count: 3, asks: [{ ...ASK, askedByName: "Ana", phone: "0123" }, { id: "x" }] }), { status: 200 }));
    const res = await asks({ ...engineEnv, SCM_ENGINE: { fetch: bound } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3, asks: [ASK] });
    const [url, init] = bound.mock.calls[0]!;
    expect(url).toBe("https://engine.test/api/carres-portal/supplier-asks");
    const headers = init.headers as Record<string, string>;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode("s".repeat(32)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(headers["x-carres-portal-signature"]!.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    const signed = (purpose: string) => enc.encode(`${purpose}.${headers["x-carres-portal-ts"]}.${String(init.body)}`);
    expect(await crypto.subtle.verify("HMAC", key, sig, signed("supplier-asks"))).toBe(true);
    // The signature is good for this one purpose: it never passes as a finance or a sign-on call.
    expect(await crypto.subtle.verify("HMAC", key, sig, signed("supplier-finance"))).toBe(false);
  });

  it("502 when the engine cannot be reached or refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("down"));
    expect((await asks(engineEnv)).status).toBe(502);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not allowed." }), { status: 401 }));
    expect((await asks(engineEnv)).status).toBe(502);
  });
});
