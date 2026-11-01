import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn() }));
import { userClient } from "../../lib/supabase";

const env = { SUPABASE_URL: "https://t.x", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", SUPABASE_JWT_SECRET: "x" } as never;

/** Every table answers its canned rows through a chain that records its filters. */
function stub(tables: Record<string, { data: unknown; error?: unknown }>) {
  const filters: Array<[string, string, unknown]> = [];
  const sb = {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn((table: string) => {
      const answer = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null, ...answer }).then(ok),
      };
      for (const m of ["select", "eq", "neq", "or", "gte", "lt", "in", "order", "range"]) {
        chain[m] = (...args: unknown[]) => { filters.push([table, m, args[0]]); return chain; };
      }
      return chain;
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(userClient).mockReturnValue(sb as any);
  return { sb, filters };
}

async function get(path: string, role = "finance") {
  const jwt = await signTestJwt("11111111-1111-1111-1111-000000000001", { email: `${role}@x`, app_metadata: { role } });
  return app.fetch(new Request(`http://t/api/finance/${path}`, { headers: { Authorization: `Bearer ${jwt}` } }), env);
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});
afterAll(() => _setJwksForTesting(null));

describe("/api/finance/not-yet-billed", () => {
  const ORDER = {
    id: "o1", so: 1375, customer_name: "Amy", delivered_at: "2026-10-30", order_lines: [{ id: "l1", qty: 1, unit_price: 100 }],
    order_addons: [], invoices: [], ops_delivery_orders: [{ do_number: "DO1", voided_at: null }],
  };

  it("refuses operation before the database", async () => {
    const { sb } = stub({});
    expect((await get("not-yet-billed", "operation")).status).toBe(403);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("lists delivered orders left unbilled, and drops billed ones and imports", async () => {
    const billed = { ...ORDER, id: "o2", invoices: [{ kind: "sales", status: "issued" }] };
    const { filters } = stub({ orders: { data: [ORDER, billed] } });
    const res = await get("not-yet-billed");
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: Array<{ order_id: string; not_billed: number }> };
    expect(rows.map((r) => [r.order_id, r.not_billed])).toEqual([["o1", 100]]);
    expect(filters).toContainEqual(["orders", "eq", "operation_stage"]);
    expect(filters).toContainEqual(["orders", "neq", "status"]);
    expect(filters).toContainEqual(["orders", "or", "source_system.is.null,source_system.neq.autocount"]);
  });

  it("a failed read says so", async () => {
    stub({ orders: { data: null, error: { message: "boom" } } });
    expect((await get("not-yet-billed")).status).toBe(500);
  });
});

describe("/api/finance/corrections", () => {
  it("wants a real month", async () => {
    stub({});
    expect((await get("corrections?month=2026-13")).status).toBe(422);
  });

  it("joins allocation corrections and voids, newest first, in Malaysian month bounds", async () => {
    const { filters } = stub({
      payment_allocation_corrections: { data: [{
        id: "c1", payment_id: "p1", reason: "Wrong SO", corrected_by: null, corrected_at: "2026-10-05T02:00:00Z",
        before: [{ order_id: "o1", amount: 100 }], after: [{ order_id: "o2", amount: 100 }],
      }] },
      ops_activity_log: { data: [{
        id: "v1", order_id: "o1", actor_id: null, occurred_at: "2026-10-09T02:00:00Z",
        detail: { amount: 1250, payment_id: "p2", reason: "Bounced" },
      }] },
      order_payments: { data: [
        { id: "p1", order_id: "o1", receipt_no: "R-1", recorded_by: null, created_at: "2026-10-01T02:00:00Z" },
        { id: "p2", order_id: "o1", receipt_no: "R-2", recorded_by: null, created_at: "2026-10-02T02:00:00Z" },
      ] },
      orders: { data: [{ id: "o1", so: 11, customer_name: "Amy" }, { id: "o2", so: 22, customer_name: "Ben" }] },
    });
    const res = await get("corrections?month=2026-10");
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(rows.map((r) => r.id)).toEqual(["v1", "c1"]);
    expect(rows[0]).toMatchObject({ kind: "void", so: 11, receipt_no: "R-2", reason: "Bounced", what: "Payment voided: RM 1,250.00" });
    expect(rows[1]).toMatchObject({ kind: "allocation", what: "Allocation changed: SO-11 RM 100.00 → SO-22 RM 100.00" });
    expect(filters).toContainEqual(["ops_activity_log", "eq", "action"]);
  });

  it("a failed read refuses the page rather than showing fewer rows", async () => {
    stub({ ops_activity_log: { data: null, error: { message: "boom" } } });
    expect((await get("corrections?month=2026-10")).status).toBe(500);
  });
});
