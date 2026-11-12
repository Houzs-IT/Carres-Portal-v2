import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn() }));
import { userClient } from "../../lib/supabase";

const env = {
  SUPABASE_URL: "https://t.x",
  SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "s",
  SUPABASE_JWT_SECRET: "",
};

async function makeJwt(role: string) {
  return signTestJwt("u1", { email: `${role}@x`, app_metadata: { role } });
}

/** Chainable supabase query-builder mock — both the GET (select→eq→maybeSingle)
 *  and PUT (upsert→select→single) chains resolve to the same `result`. */
function makeSb(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  return { from: vi.fn(() => builder), builder };
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});

afterAll(() => _setJwksForTesting(null));

const ORDER_ID = "00000000-0000-0000-0000-00000000010a";

describe("D2 — receiving has ONE door", () => {
  it("POST /:id/receive-line is gone — an old tab meets a 404, never a silent write", async () => {
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/receive-line`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "mattress:MAT-1", qty: 1, condition: "new" }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/delivery-attempt — a Journey leg records its own result (0491)", () => {
  const ORDER = "00000000-0000-0000-0000-00000000020a";
  it("passes the leg to the governed door, and admits an intermediate leg's arrival", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { attempt: { leg: 1 } }, error: null });
    vi.mocked(userClient).mockReturnValue({ ...makeSb({ data: null, error: null }), rpc } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER}/delivery-attempt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ result: "delivered", leg: 1, note: "Reached JB" }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("delivery_attempt_record", expect.objectContaining({ p_order_id: ORDER, p_result: "delivered", p_leg: 1, p_reason_key: null, p_where_goods: null }));
  });

  it("a whole-order `delivered` is refused before any call — the delivery door owns it", async () => {
    const rpc = vi.fn();
    vi.mocked(userClient).mockReturnValue({ ...makeSb({ data: null, error: null }), rpc } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER}/delivery-attempt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ result: "delivered" }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the loan offer record (0492, Delivery MASTER §14.2)", () => {
  const ORDER = "00000000-0000-0000-0000-00000000020a";

  it("reads the history newest first with the offered Unit's ID", async () => {
    const sb = makeSb({ data: null, error: null });
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "o2", seq: 2, order_id: ORDER, event: "accepted", item_id: "u1", label: "Display sofa", reason: null, recorded_by: null, recorded_at: "2026-09-13T01:00:00Z", ops_stock_items: { unit_code: "U1-000-082", identity_scope: "unit" } },
      ],
      error: null,
    });
    sb.builder.order = order;
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER}/loan-offers`, { headers: { Authorization: `Bearer ${jwt}` } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offers: Array<{ event: string; unit_id: string | null }> };
    expect(body.offers[0]).toMatchObject({ event: "accepted", unit_id: "U1-000-082" });
  });
});

