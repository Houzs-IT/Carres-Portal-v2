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
