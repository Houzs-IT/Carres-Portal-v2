import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import type { Bindings } from "../types";
import {
  _forgetApiDoorCheckForTesting,
  _setCarresApiSecretForTesting,
  apiDoorReaches,
  carresApiSecret,
  opensApiDoor,
} from "./api-door";

/* The API door (owner, 16 Nov 2026; migrations 0778, 0779): the product tables answer a role that does not see
 * cost only when the request came through this API, on a route where the door is open. */

const SUPABASE_URL = "https://test.supabase.co";
const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
} as Bindings;

const SECRET = "a".repeat(64);
const NEXT_SECRET = "b".repeat(64);

describe("where the door is open", () => {
  it("is open on the routes a store sells through", () => {
    expect(opensApiDoor("GET", "/api/catalog")).toBe(true);
    expect(opensApiDoor("get", "/api/catalog/")).toBe(true);
    expect(opensApiDoor("GET", "/api/orders")).toBe(true);
    expect(opensApiDoor("POST", "/api/orders")).toBe(true);
    expect(opensApiDoor("PATCH", "/api/orders/7b1d/lines")).toBe(true);
    expect(opensApiDoor("POST", "/api/orders/7b1d/stripe/checkout")).toBe(true);
    expect(opensApiDoor("POST", "/api/pwp-codes/reserve")).toBe(true);
    expect(opensApiDoor("GET", "/api/pwp-codes/available")).toBe(true);
  });

  it("is shut on the catalogue's office routes: only reading the catalogue itself is a store's", () => {
    expect(opensApiDoor("POST", "/api/catalog")).toBe(false);
    expect(opensApiDoor("GET", "/api/catalog/supplier-offers")).toBe(false);
    expect(opensApiDoor("GET", "/api/catalog/skus/1/supplier-offers")).toBe(false);
    expect(opensApiDoor("PATCH", "/api/catalog/skus/1")).toBe(false);
    expect(opensApiDoor("GET", "/api/catalog/config-history")).toBe(false);
    expect(opensApiDoor("GET", "/api/catalog/fabrics/history")).toBe(false);
  });

  it("is shut on every route written for the office, and on a name that only starts the same", () => {
    for (const path of [
      "/api/operation/orders", "/api/operation/pos/skus", "/api/operation/purchase/demands",
      "/api/finance/payables", "/api/principal/dealers", "/api/bd/dealers", "/api/ops/stock", "/api/analytics",
      "/api/approvals", "/api/rental/config", "/api/guarantees", "/api/dealers/me", "/api/staff",
      "/api/orders-archive", "/api/pwp-codes-old/x", "/api/catalogue", "/health", "/",
    ]) {
      expect(opensApiDoor("GET", path), path).toBe(false);
    }
  });
});

describe("the value the API sends", () => {
  let asked: Array<{ authorization: string | null; apikey: string | null }>;
  let answer: () => Response;

  beforeEach(() => {
    _setCarresApiSecretForTesting(null);
    _forgetApiDoorCheckForTesting();
    asked = [];
    answer = () => HttpResponse.json(SECRET);
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/carres_api_secret`, ({ request }) => {
        asked.push({ authorization: request.headers.get("authorization"), apikey: request.headers.get("apikey") });
        return answer();
      }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T02:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const minutesLater = (minutes: number) => vi.setSystemTime(new Date(Date.now() + minutes * 60_000));

  it("is read from the database with the service key, once, and then held", async () => {
    expect(await carresApiSecret(env)).toBe(SECRET);
    expect(await carresApiSecret(env)).toBe(SECRET);
    expect(asked).toEqual([{ authorization: "Bearer test-service", apikey: "test-service" }]);
  });

  it("is read again after five minutes, so a replaced value is picked up", async () => {
    await carresApiSecret(env);
    minutesLater(4);
    expect(await carresApiSecret(env)).toBe(SECRET);
    expect(asked).toHaveLength(1);

    answer = () => HttpResponse.json(NEXT_SECRET);
    minutesLater(2);
    expect(await carresApiSecret(env)).toBe(NEXT_SECRET);
    expect(asked).toHaveLength(2);
  });

  it("one read serves every request that arrives while it is on its way", async () => {
    const all = await Promise.all([carresApiSecret(env), carresApiSecret(env), carresApiSecret(env)]);
    expect(all).toEqual([SECRET, SECRET, SECRET]);
    expect(asked).toHaveLength(1);
  });

  it("is null while the database has never handed one over, and the next request asks again", async () => {
    answer = () => HttpResponse.json({ message: "permission denied for function carres_api_secret" }, { status: 403 });
    expect(await carresApiSecret(env)).toBeNull();
    expect(await carresApiSecret(env)).toBeNull();
    expect(asked).toHaveLength(2);

    answer = () => HttpResponse.json(SECRET);
    expect(await carresApiSecret(env)).toBe(SECRET);
  });

  it("keeps the value it holds when a later read fails, and does not ask on every request", async () => {
    await carresApiSecret(env);
    minutesLater(6);
    answer = () => HttpResponse.json({ message: "upstream timeout" }, { status: 504 });
    expect(await carresApiSecret(env)).toBe(SECRET);
    expect(await carresApiSecret(env)).toBe(SECRET);
    expect(asked).toHaveLength(2);

    vi.setSystemTime(new Date(Date.now() + 16_000));
    answer = () => HttpResponse.json(NEXT_SECRET);
    expect(await carresApiSecret(env)).toBe(NEXT_SECRET);
    expect(asked).toHaveLength(3);
  });

  it("does not take an answer that is not a value", async () => {
    for (const bad of [null, "", "short", 12345, { token: SECRET }]) {
      _setCarresApiSecretForTesting(null);
      answer = () => HttpResponse.json(bad);
      expect(await carresApiSecret(env), JSON.stringify(bad)).toBeNull();
    }
  });

  it("never writes the value to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await carresApiSecret(env);
    minutesLater(6);
    answer = () => HttpResponse.json({ message: "boom" }, { status: 500 });
    await carresApiSecret(env);
    const written = JSON.stringify([...vi.mocked(console.error).mock.calls, ...log.mock.calls]);
    expect(written).not.toContain(SECRET);
  });

  describe("the deploy check: does the header reach the database and match?", () => {
    let seen: Array<{ header: string | null; authorization: string | null }>;
    let matches: (header: string | null) => boolean;

    beforeEach(() => {
      seen = [];
      matches = (header) => header === SECRET;
      server.use(
        http.post(`${SUPABASE_URL}/rest/v1/rpc/carres_api_door_check`, ({ request }) => {
          const header = request.headers.get("x-carres-api");
          seen.push({ header, authorization: request.headers.get("authorization") });
          return HttpResponse.json(matches(header));
        }),
      );
    });

    it("sends the held value in x-carres-api with the service key, and says yes when the database does", async () => {
      expect(await apiDoorReaches(env)).toBe(true);
      expect(seen).toEqual([{ header: SECRET, authorization: "Bearer test-service" }]);
    });

    it("says no when the database says the header did not match", async () => {
      matches = () => false;
      expect(await apiDoorReaches(env)).toBe(false);
    });

    it("says no without asking when there is no value to send", async () => {
      answer = () => HttpResponse.json({ message: "nope" }, { status: 500 });
      expect(await apiDoorReaches(env)).toBe(false);
      expect(seen).toEqual([]);
    });

    it("holds its answer for a minute, so the public URL cannot load the database", async () => {
      await apiDoorReaches(env);
      await apiDoorReaches(env);
      await apiDoorReaches(env);
      expect(seen).toHaveLength(1);
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await apiDoorReaches(env);
      expect(seen).toHaveLength(2);
    });
  });
});
