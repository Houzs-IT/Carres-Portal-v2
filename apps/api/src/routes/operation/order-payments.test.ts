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

interface TableCfg {
  list?: { data: unknown; error: unknown; count?: number };
  single?: { data: unknown; error: unknown };
  maybeSingle?: { data: unknown; error: unknown };
}

/** Table-routed query-builder mock. Each `from(table)` returns a thenable
 *  builder whose terminal (await / .single() / .maybeSingle()) resolves to that
 *  table's configured result. Captures insert/delete/upsert payloads for
 *  assertions; an optional `rpc` result backs sb.rpc(). */
function makeSb(
  byTable: Record<string, TableCfg>,
  rpc?: { data: unknown; error: unknown },
) {
  const calls = {
    inserts: [] as unknown[],
    upserts: [] as unknown[],
    updates: [] as Record<string, unknown>[],
    deletes: 0,
    rpc: [] as unknown[],
  };
  const from = vi.fn((table: string) => {
    const cfg = byTable[table] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: vi.fn(() => builder),
      insert: vi.fn((payload: unknown) => {
        calls.inserts.push(payload);
        return builder;
      }),
      delete: vi.fn(() => {
        calls.deletes += 1;
        return builder;
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        calls.updates.push(payload);
        return builder;
      }),
      upsert: vi.fn((payload: unknown) => {
        calls.upserts.push(payload);
        return builder;
      }),
      eq: vi.fn(() => builder),
      /* `.in()` — the recorder-name lookup filters app_users by a list of ids.
         The builder had no such method, so the route 500'd inside the mock
         while the real PostgREST client was fine. A mock that cannot express a
         call the route makes does not prove the route works. */
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve(cfg.single ?? { data: null, error: null })),
      maybeSingle: vi.fn(() => Promise.resolve(cfg.maybeSingle ?? { data: null, error: null })),
      // Awaiting the builder (list / count / delete queries) resolves here.
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(cfg.list ?? { data: [], error: null }).then(resolve, reject),
    };
    return builder;
  });
  const rpcFn = vi.fn((name: string, args: unknown) => {
    calls.rpc.push({ name, args });
    return Promise.resolve(rpc ?? { data: null, error: null });
  });
  return { from, rpc: rpcFn, calls };
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});

afterAll(() => _setJwksForTesting(null));

const ORDER_ID = "00000000-0000-0000-0000-00000000010a";
const PAY_ID = "00000000-0000-0000-0000-0000000002bb";

// =====================================================================
// POST /api/operation/orders/:id/payments
// =====================================================================
describe("POST /:id/payments", () => {
  it("403 for dealer role", async () => {
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100, paidOn: "2026-06-26" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  // Follows Houzs backdateRequestNotify.ts:5-8 per Weisiang's ruling
  // (2026-10-22): clear Carres rules, implement Houzs (YH 2026-10-26, Q14).
  it("finance reaches Record payment (payment_record decides)", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: { payment: { id: PAY_ID, order_id: ORDER_ID, amount: 10 }, orders_paid: 10 }, error: null },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("finance");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 10, paidOn: "2026-06-26", method: "bank", kind: "deposit" }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it("422 when amount is non-positive", async () => {
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 0, paidOn: "2026-06-26" }),
      }),
      env,
    );
    expect(res.status).toBe(422);
  });

  it("201 — records through the ONE writer (payment_record) with a locked-scheme receipt (CARD 4)", async () => {
    const returned = {
      id: PAY_ID, order_id: ORDER_ID, amount: 1500, paid_on: "2026-06-26",
      method: "bank", kind: "deposit", recorded_by: "u1", counted_in_paid: true,
    };
    const sb = makeSb(
      {
        // count query (then) → 2 existing → seq 3 (rides the receipt seed).
        order_payments: { list: { data: null, error: null, count: 2 } },
      },
      { data: { payment: returned, orders_paid: 3500 }, error: null },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1500, paidOn: "2026-06-26", method: "bank", kind: "deposit", idempotencyKey: "00000000-0000-4000-8000-000000000052" }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { payment: typeof returned; ordersPaid: number };
    expect(body.payment.id).toBe(PAY_ID);
    expect(body.ordersPaid).toBe(3500);
    // The write went through the RPC — never a direct table insert.
    expect(sb.calls.inserts).toHaveLength(0);
    const rpc = sb.calls.rpc[0] as { name: string; args: Record<string, unknown> };
    expect(rpc.name).toBe("payment_record");
    expect(rpc.args).toMatchObject({
      p_order_id: ORDER_ID,
      p_amount: 1500,
      p_method: "bank",
      p_kind: "deposit",
      p_counts_toward_paid: true,
      p_idempotency_key: "00000000-0000-4000-8000-000000000052",
      // 0448 — an ordinary payment asks for no continuation past a duplicate.
      p_duplicate_ack: false,
    });
    // The receipt is the LOCKED document scheme: RC-DDMMYY-NNNN, seeded on
    // {orderId}:{seq} (seq = 3 here) — deterministic, so a reprint matches.
    expect(rpc.args.p_receipt_no).toMatch(/^RC-260626-\d{4}$/);
  });

  // CARD 4 closing slice (0347). The receipt seed is `count + 1`, so two
  // payments recorded into one order in the same instant mint the SAME number.
  // 0347's unique index stops that being stored; without a retry the index
  // just turns a silent duplicate into a 500 at the till.
  it("a taken receipt number is retried with the next sequence, not returned as an error", async () => {
    const returned = {
      id: PAY_ID, order_id: ORDER_ID, amount: 300, paid_on: "2026-06-26",
      method: "cash", kind: "payment", recorded_by: "u1", counted_in_paid: true,
    };
    const sb = makeSb({ order_payments: { list: { data: null, error: null, count: 2 } } });
    let call = 0;
    sb.rpc.mockImplementation((name: string, args: unknown) => {
      sb.calls.rpc.push({ name, args });
      call += 1;
      // The first attempt collides; the second (seq bumped) succeeds.
      return Promise.resolve(
        call === 1
          ? { data: null, error: { code: "23505", message: "duplicate key" } }
          : { data: { payment: returned, orders_paid: 300 }, error: null },
      );
    });
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 300, paidOn: "2026-06-26", method: "cash" }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(sb.calls.rpc).toHaveLength(2);
    const first = sb.calls.rpc[0] as { args: Record<string, unknown> };
    const second = sb.calls.rpc[1] as { args: Record<string, unknown> };
    // A DIFFERENT number, still on the locked scheme — never the same one twice.
    expect(second.args.p_receipt_no).not.toBe(first.args.p_receipt_no);
    expect(second.args.p_receipt_no).toMatch(/^RC-260626-\d{4}$/);
    // 0707 — with no key sent, the key is the request's own, not the receipt.
    expect(first.args.p_idempotency_key).not.toBe(first.args.p_receipt_no);
    expect(second.args.p_idempotency_key).toBe(first.args.p_idempotency_key);
  });

  it("gives up after three attempts rather than looping on a real conflict", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: null, error: { code: "23505", message: "duplicate key" } },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 300, paidOn: "2026-06-26", method: "cash" }),
      }),
      env,
    );
    expect(res.status).not.toBe(201);
    expect(sb.calls.rpc).toHaveLength(3);
  });
});

// =====================================================================
// DELETE /api/operation/orders/:id/payments/:pid
// =====================================================================
describe("DELETE /:id/payments/:pid", () => {
  it("403 for a dealer before anything reads", async () => {
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments/${PAY_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "keyed twice" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("422 — a void with no reason is refused before SQL (0430)", async () => {
    const sb = makeSb({}, { data: null, error: null });
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("principal");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments/${PAY_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "  " }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(sb.calls.rpc).toHaveLength(0);
  });

  it("200 — the reason reaches payment_void; the row is never deleted (CARD 4 · 0430)", async () => {
    const sb = makeSb(
      {},
      { data: { payment_id: PAY_ID, orders_paid: 2000 }, error: null },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("principal");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments/${PAY_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "keyed twice" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    // A void is a STAMP through the RPC — no direct delete, ever.
    expect(sb.calls.deletes).toBe(0);
    const rpc = sb.calls.rpc[0] as { name: string; args: Record<string, unknown> };
    expect(rpc.name).toBe("payment_void");
    expect(rpc.args).toMatchObject({ p_payment_id: PAY_ID, p_reason: "keyed twice" });
  });

  it("operation reaches the SQL door, which decides by Payment Approver duty (0430)", async () => {
    const sb = makeSb({}, { data: null, error: { code: "42501", message: "forbidden" } });
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments/${PAY_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "keyed twice" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect((sb.calls.rpc[0] as { name: string }).name).toBe("payment_void");
  });
});

// =====================================================================
// §5 (0448) — the duplicate acknowledgement reaches the door that decides
// =====================================================================
describe("POST /:id/payments — the §5 acknowledgement is the SERVER's to judge", () => {
  it("passes duplicateAck through to payment_record", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: { payment: { id: PAY_ID }, orders_paid: 500 }, error: null },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 500, paidOn: "2026-09-08", method: "bank", kind: "payment",
          duplicateAck: true, idempotencyKey: "00000000-0000-4000-8000-000000000099",
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const rpc = sb.calls.rpc[0] as { name: string; args: Record<string, unknown> };
    expect(rpc.args).toMatchObject({ p_duplicate_ack: true });
  });

  /** The door refuses with P0001 + detail `possible_duplicate_payment`, which
   *  mapPgError turns into 422 carrying that code — so the page can tell a
   *  duplicate refusal apart from every other rejection. */
  it("surfaces the door's duplicate refusal as its own code, not a 500", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: null, error: { code: "P0001", details: "possible_duplicate_payment",
                             message: "This looks like a payment already recorded (RC-080926-0001 · RM 500.00 · 2026-09-08)." } },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 500, paidOn: "2026-09-08", method: "bank", kind: "payment" }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("possible_duplicate_payment");
    expect(body.message).toContain("RC-080926-0001");
  });

  it("surfaces a non-approver continuation as 403, not a silent success", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: null, error: { code: "42501", details: "not_payment_approver",
                             message: "Only the Payment Approver can record this" } },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 500, paidOn: "2026-09-08", method: "bank",
                               kind: "payment", duplicateAck: true }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

// =====================================================================
// 0707 — a paid date more than 14 days back waits for the Payment Approver
// =====================================================================
describe("backdated payment (0707)", () => {
  const REQ_ID = "00000000-0000-4000-8000-0000000007a7";
  const waiting = { id: REQ_ID, order_id: ORDER_ID, amount: 300, paid_on: "2026-09-01", status: "waiting" };

  it("202 — Record payment answers a waiting request, not a payment", async () => {
    const sb = makeSb(
      { order_payments: { list: { data: null, error: null, count: 0 } } },
      { data: { pending_approval: true, request: waiting, payment: null, orders_paid: 0 }, error: null },
    );
    vi.mocked(userClient).mockReturnValue(sb as never);
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await makeJwt("operation")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 300, paidOn: "2026-09-01", method: "cash", kind: "payment" }),
      }),
      env,
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pendingApproval: true, request: waiting });
  });

  it("GET lists the order's requests", async () => {
    const sb = makeSb({ payment_backdate_requests: { list: { data: [waiting], error: null } } });
    vi.mocked(userClient).mockReturnValue(sb as never);
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payment-backdate`, {
        headers: { Authorization: `Bearer ${await makeJwt("operation")}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [waiting] });
  });

  it("decide passes the decision to the SQL door, which owns the duty check", async () => {
    const sb = makeSb({}, { data: { request: { ...waiting, status: "refused" }, payment: null }, error: null });
    vi.mocked(userClient).mockReturnValue(sb as never);
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payment-backdate/${REQ_ID}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await makeJwt("operation")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approve: false, reason: "Wrong slip" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(sb.calls.rpc[0]).toEqual({
      name: "payment_backdate_decide",
      args: { p_request_id: REQ_ID, p_approve: false, p_reason: "Wrong slip", p_duplicate_ack: false },
    });
  });

  it("decide is refused for a dealer before anything reads", async () => {
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/payment-backdate/${REQ_ID}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await makeJwt("dealer")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
