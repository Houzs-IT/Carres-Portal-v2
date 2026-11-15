import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { server } from "../test/server";
import type { Bindings } from "../types";
import { CARRES_API_HEADER, adminClient, userClient } from "./supabase";

/* What each client sends the database. The API door (lib/api-door.ts) rests on two facts proven here: a user
 * client carries x-carres-api exactly when its request's `env` holds the value, and nothing else ever does. */

const SUPABASE_URL = "https://test.supabase.co";
const env = { SUPABASE_URL, SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service" } as Bindings;
const JWT = "user.jwt.token";

type Seen = { door: string | null; authorization: string | null; apikey: string | null };
let seen: Seen[];
const record: HttpResponseResolver = ({ request }) => {
  seen.push({
    door: request.headers.get(CARRES_API_HEADER),
    authorization: request.headers.get("authorization"),
    apikey: request.headers.get("apikey"),
  });
  return HttpResponse.json([]);
};

beforeEach(() => {
  seen = [];
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/product_skus`, record),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/pwp_discover_available`, record),
  );
});

describe("userClient", () => {
  it("sends the caller's token and the public key, and no x-carres-api, as it always did", async () => {
    await userClient(env, JWT).from("product_skus").select("sku");
    expect(seen).toEqual([{ door: null, authorization: `Bearer ${JWT}`, apikey: "test-anon" }]);
  });

  it("adds x-carres-api when this request's env holds the value: on a table read and on a function call", async () => {
    const open = { ...env, CARRES_API_SECRET: "the-value" } as Bindings;
    const sb = userClient(open, JWT);
    await sb.from("product_skus").select("sku");
    await sb.rpc("pwp_discover_available", { p_phone: "0123" });
    expect(seen).toEqual([
      { door: "the-value", authorization: `Bearer ${JWT}`, apikey: "test-anon" },
      { door: "the-value", authorization: `Bearer ${JWT}`, apikey: "test-anon" },
    ]);
  });

  it("a client made for one request does not change what the next request's client sends", async () => {
    await userClient({ ...env, CARRES_API_SECRET: "the-value" } as Bindings, JWT).from("product_skus").select("sku");
    await userClient(env, JWT).from("product_skus").select("sku");
    expect(seen.map((s) => s.door)).toEqual(["the-value", null]);
  });
});

describe("adminClient", () => {
  it("sends the service key and never x-carres-api, even when the request's env holds the value", async () => {
    await adminClient({ ...env, CARRES_API_SECRET: "the-value" } as Bindings).from("product_skus").select("sku");
    expect(seen).toEqual([{ door: null, authorization: "Bearer test-service", apikey: "test-service" }]);
  });
});
