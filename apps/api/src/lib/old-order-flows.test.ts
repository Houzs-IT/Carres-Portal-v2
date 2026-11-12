import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signTestJwt, useTestJwks } from "../test/jwt";
import app from "../index";
import { _setJwksForTesting } from "../middleware/auth";
import { OLD_CASES_OFF, OLD_ORDERS_OFF } from "./old-order-flows";

const USER = "11111111-1111-1111-1111-000000000997";
const env = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
  STAFF_SESSION_SECRET: "test-staff-secret-0240-abcdef",
};

async function post(path: string, extra: object) {
  const jwt = await signTestJwt(USER, { email: "ops@carres.com", app_metadata: { role: "operation" } });
  return app.fetch(new Request(`http://t${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: "{}",
  }), { ...env, ...extra });
}

beforeEach(() => useTestJwks());
afterAll(() => _setJwksForTesting(null));

describe("new orders into the old supply chain, while it is turned off", () => {
  for (const path of ["/api/orders", "/api/orders/raw", "/api/rental/agreements"]) {
    it(`${path} refuses with the plain sentence`, async () => {
      const res = await post(path, { OLD_ORDER_FLOWS: "off" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "old_orders_off", message: OLD_ORDERS_OFF });
    });
    it(`${path} is untouched when the switch is unset`, async () => {
      const res = await post(path, {});
      expect(res.status).not.toBe(409);
    });
  }
});

describe("new cases into the old Service Cases, while it is turned off", () => {
  for (const path of ["/api/guarantees/00000000-0000-0000-0000-000000000001/claim"]) {
    it(`${path} refuses with the plain sentence`, async () => {
      const res = await post(path, { OLD_ORDER_FLOWS: "off" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "old_cases_off", message: OLD_CASES_OFF });
    });
    it(`${path} is untouched when the switch is unset`, async () => {
      expect((await post(path, {})).status).not.toBe(409);
    });
  }
});
