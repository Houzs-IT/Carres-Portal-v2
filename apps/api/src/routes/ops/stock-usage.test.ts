import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import { Hono } from "hono";
import { authMiddleware, _setJwksForTesting } from "../../middleware/auth";
import stockRouter from "./stock";
import type { AppEnv } from "../../types";

/**
 * Pool usage + reserve levels — Ready Stock K4 (migration 0292).
 *
 * What a UI bug could never reveal, and these tests can:
 *  1. A draw goes through ONE rpc that takes the unit AND records the reason.
 *     0213's route stamped the reason afterwards, so a failed stamp left a
 *     drawn unit nobody could explain — the shape, not the wording, is the fix.
 *  2. The month is sliced by the SERVER, in Malaysian time, and a junk
 *     `?period=` reads as this month rather than 500-ing.
 *  3. `canEdit` comes from the caller's DUTY — "only the COO edits reserve
 *     levels" — and a database refusal (42501) surfaces as 403, not 500.
 *  4. `/reserve-item` still answers 409 (not 404, not 500) when the unit was
 *     grabbed a second ago: the contract the drawer's picker depends on
 *     survived moving into the RPC.
 */

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { userClient } from "../../lib/supabase";

const SUPABASE_URL = "https://test.supabase.co";
const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
};

function buildApp() {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    return c.json(
      { error: "server_error", message },
      status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  });
  const api = new Hono<AppEnv>();
  api.use("*", authMiddleware);
  api.route("/ops/stock", stockRouter);
  app.route("/api", api);
  return app;
}
const app = buildApp();

async function makeJwt(role: string, email = "khoryee@carres.com") {
  return signTestJwt("11111111-1111-1111-1111-000000000999", { email, app_metadata: { role } });
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});

afterAll(() => _setJwksForTesting(null));

/** The live prod pool 2026-07-27, free-text Klg-sheet SKUs and all. */
const PILLOW = "Essential Memory Pillow(L)";
const MP_K = "Microfiber Waterproof Mattress Protector-K";

const STOCK_ROWS = [
  { sku: PILLOW, status: "free", qty: 555 },
  { sku: MP_K, status: "free", qty: 15 },
  { sku: MP_K, status: "reserved", qty: 4 },
];

interface SbOpts {
  usage?: unknown[];
  levels?: unknown[];
  stock?: unknown[];
  duties?: string[] | null;
  rpcResult?: unknown;
  rpcError?: { code?: string; message?: string } | null;
}

function buildSb(opts: SbOpts = {}) {
  const rpcCalls: Array<[string, unknown]> = [];
  const filters: Array<[string, unknown[]]> = [];
  const tables: string[] = [];

  function chainFor(rows: unknown[]) {
    const chain: Record<string, unknown> = {
      then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(res),
    };
    for (const m of ["select", "eq", "in", "is", "or", "order", "limit", "gte", "lt"]) {
      chain[m] = (...args: unknown[]) => {
        filters.push([m, args]);
        return chain;
      };
    }
    return chain;
  }

  const sb = {
    from: vi.fn((table: string) => {
      tables.push(table);
      if (table === "ops_stock_pool_usage") return chainFor(opts.usage ?? []);
      if (table === "ops_stock_reserve_levels") return chainFor(opts.levels ?? []);
      return chainFor(opts.stock ?? STOCK_ROWS);
    }),
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      if (name === "my_org_duties") return { data: opts.duties ?? [], error: null };
      if (name === "actor_display_names") return { data: [{ id: "u-1", name: "Shasha" }], error: null };
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcResult ?? null, error: null };
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { sb, rpcCalls, filters, tables };
}

async function req(
  path: string,
  sb: unknown,
  init: RequestInit = {},
  role = "operation",
  email = "khoryee@carres.com",
) {
  vi.mocked(userClient).mockReturnValue(sb as never);
  return app.request(
    `/api${path}`,
    {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${await makeJwt(role, email)}`,
      },
    },
    env,
  );
}

describe("PUT /api/ops/stock/reserve-level", () => {
  const put = (body: unknown) => ({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("calls the audited RPC, never the table", async () => {
    const { sb, rpcCalls, tables } = buildSb();
    const res = await req(
      "/ops/stock/reserve-level",
      sb,
      put({ sku: PILLOW, reserveLevel: 200 }),
    );
    expect(res.status).toBe(200);
    expect(rpcCalls).toContainEqual([
      "ops_set_reserve_level",
      { p_sku: PILLOW, p_level: 200, p_note: null },
    ]);
    expect(tables).not.toContain("ops_stock_reserve_levels");
  });

  it("keeps 0 as the OFF switch rather than rejecting it", async () => {
    const { sb, rpcCalls } = buildSb();
    const res = await req(
      "/ops/stock/reserve-level",
      sb,
      put({ sku: PILLOW, reserveLevel: 0 }),
    );
    expect(res.status).toBe(200);
    expect((rpcCalls[0][1] as { p_level: number }).p_level).toBe(0);
  });

  it("reads a database refusal as 403, not an outage", async () => {
    const { sb } = buildSb({ rpcError: { code: "42501", message: "forbidden" } });
    const res = await req(
      "/ops/stock/reserve-level",
      sb,
      put({ sku: PILLOW, reserveLevel: 5 }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a level the column cannot hold", async () => {
    const { sb } = buildSb();
    const res = await req(
      "/ops/stock/reserve-level",
      sb,
      put({ sku: PILLOW, reserveLevel: 100001 }),
    );
    expect(res.status).toBe(400);
  });
});

describe("the draw doors", () => {
  const post = (body: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("still answers 404 when no free unit of that SKU exists", async () => {
    const { sb, rpcCalls } = buildSb({ rpcResult: null });
    const res = await req(
      "/ops/stock/reserve",
      sb,
      post({ sku: PILLOW, ref: "SO-1209", reason: "sales_urgent" }),
    );
    expect(res.status).toBe(404);
    expect(rpcCalls[0][1]).toMatchObject({ p_sku: PILLOW, p_item_id: null });
  });

  /**
   * The THIRD door (0294). `Takeout` is offered on a free row too, so it draws
   * on the pool — but only the DATABASE knows a unit's real status, so the
   * route forwards whatever the browser has and lets SQL decide whether a
   * reason was required. A client that believed a stale "reserved" gets a 400,
   * not a silent unrecorded draw.
   */
  it("forwards the reason to takeout and lets SQL decide if it was needed", async () => {
    const { sb, rpcCalls } = buildSb({ rpcResult: "item-1" });
    await req(
      "/ops/stock/takeout",
      sb,
      post({
        itemId: "11111111-1111-1111-1111-111111111111",
        reason: "warranty_exchange",
        note: null,
      }),
    );
    expect(rpcCalls[0]).toEqual([
      "ops_stock_takeout",
      {
        p_item_id: "11111111-1111-1111-1111-111111111111",
        p_reason: "warranty_exchange",
        p_note: null,
      },
    ]);
  });

  it("still allows a reason-less takeout — a reserved unit is not a new draw", async () => {
    const { sb, rpcCalls } = buildSb({ rpcResult: "item-1" });
    const res = await req(
      "/ops/stock/takeout",
      sb,
      post({ itemId: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(res.status).toBe(200);
    expect((rpcCalls[0][1] as { p_reason: string | null }).p_reason).toBeNull();
  });

  it("reads the database's reason_required refusal as 400, not an outage", async () => {
    const { sb } = buildSb({
      rpcError: { code: "22023", message: "reason_required" },
    });
    const res = await req(
      "/ops/stock/takeout",
      sb,
      post({ itemId: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(res.status).toBe(400);
  });

  it("passes the condition and warehouse the oldest-unit door may narrow by", async () => {
    const { sb, rpcCalls } = buildSb({ rpcResult: "item-1" });
    await req(
      "/ops/stock/reserve",
      sb,
      post({
        sku: PILLOW,
        ref: "SO-1209",
        reason: "sales_urgent",
        condition: "exhibition",
        warehouseId: "22222222-2222-2222-2222-222222222222",
      }),
    );
    expect(rpcCalls[0][1]).toMatchObject({
      p_condition: "exhibition",
      p_wh: "22222222-2222-2222-2222-222222222222",
    });
  });
});
