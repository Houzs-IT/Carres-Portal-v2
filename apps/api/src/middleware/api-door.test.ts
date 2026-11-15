import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { http, HttpResponse } from "msw";
import { APP_ROLES } from "@carres/shared";
import { _setCarresApiSecretForTesting } from "../lib/api-door";
import { signTestJwt, useTestJwks } from "../test/jwt";
import { server } from "../test/server";
import { TEST_API_DOOR_SECRET } from "../test/api-door";
import type { AppEnv } from "../types";
import { apiDoorMiddleware } from "./api-door";
import { _setJwksForTesting, authMiddleware } from "./auth";

/* Owner, 16 Nov 2026: nobody who sells (a store login, or bd) sees what Carres pays or who Carres buys from. The
 * product tables answer a role that does not see cost only on a route where this middleware opens the API door. */

const SUPABASE_URL = "https://test.supabase.co";
const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
};

// The same two middlewares, in the same order, as the real API; the handler says what a route would be handed.
const app = new Hono<AppEnv>();
app.use("*", authMiddleware);
app.use("*", apiDoorMiddleware);
app.all("*", (c) => c.json({ ran: true, door: c.env.CARRES_API_SECRET ?? null, url: c.env.SUPABASE_URL }));

async function call(role: string, method: string, path: string, withEnv: object = env) {
  const jwt = await signTestJwt("11111111-1111-1111-1111-000000000999", { email: "t@carres.com", app_metadata: { role } });
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: { Authorization: `Bearer ${jwt}` } }), withEnv);
  return { status: res.status, body: (await res.json()) as { ran?: boolean; door?: string | null; url?: string; error?: string } };
}

beforeEach(() => useTestJwks());
afterAll(() => _setJwksForTesting(null));

const COST = ["principal", "operation", "finance"];
const NO_COST = APP_ROLES.filter((role) => !COST.includes(role));

describe("the API door, per request", () => {
  it("opens for every role that does not see cost on the routes a store sells through", async () => {
    expect(NO_COST).toEqual(expect.arrayContaining(["dealer", "salesperson", "showroom", "bd", "hr"]));
    for (const role of NO_COST) {
      for (const [method, path] of [["GET", "/api/catalog"], ["POST", "/api/orders"], ["GET", "/api/orders/abc"], ["POST", "/api/pwp-codes/reserve"]] as const) {
        const { status, body } = await call(role, method, path);
        expect({ role, path, status, door: body.door }).toEqual({ role, path, status: 200, door: TEST_API_DOOR_SECRET });
      }
    }
  });

  it("stays shut for the same roles on every other route, so an office route cannot hand a store its cost", async () => {
    for (const role of NO_COST) {
      for (const [method, path] of [
        ["GET", "/api/operation/pos/skus"], ["GET", "/api/operation/orders"], ["GET", "/api/analytics/sales"],
        ["GET", "/api/finance/payables"], ["GET", "/api/catalog/supplier-offers"], ["PATCH", "/api/catalog/skus/1"],
        ["GET", "/api/rental/config"], ["GET", "/api/dealers/me"],
      ] as const) {
        const { status, body } = await call(role, method, path);
        expect({ role, path, status, door: body.door }).toEqual({ role, path, status: 200, door: null });
      }
    }
  });

  it("is never needed by a role that sees cost: their requests are handed nothing extra, on any route", async () => {
    for (const role of COST) {
      for (const path of ["/api/catalog", "/api/orders", "/api/operation/orders"]) {
        const { status, body } = await call(role, "GET", path);
        expect({ role, path, status, door: body.door }).toEqual({ role, path, status: 200, door: null });
      }
    }
  });

  it("puts the value on that request's own copy of env and leaves the Worker's env as it was", async () => {
    const workerEnv = { ...env };
    const { body } = await call("dealer", "GET", "/api/catalog", workerEnv);
    expect(body).toEqual({ ran: true, door: TEST_API_DOOR_SECRET, url: SUPABASE_URL });
    expect(workerEnv).toEqual(env);
    expect("CARRES_API_SECRET" in workerEnv).toBe(false);

    const next = await call("dealer", "GET", "/api/dealers/me", workerEnv);
    expect(next.body.door).toBeNull();
  });

  describe("when the database has not handed the value over", () => {
    beforeEach(() => {
      _setCarresApiSecretForTesting(null);
      server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/carres_api_secret`, () => HttpResponse.json({ message: "down" }, { status: 503 })));
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("refuses a store's request on a door route instead of running it against empty product tables", async () => {
      const { status, body } = await call("dealer", "POST", "/api/orders");
      expect(status).toBe(503);
      expect(body).toEqual({ error: "server_not_ready", message: "Not ready yet. Try again." });
      expect(body.ran).toBeUndefined();
    });

    it("still serves a store's other routes, and every role that sees cost everywhere", async () => {
      expect((await call("dealer", "GET", "/api/dealers/me")).status).toBe(200);
      for (const role of COST) expect((await call(role, "POST", "/api/orders")).status).toBe(200);
    });
  });
});
