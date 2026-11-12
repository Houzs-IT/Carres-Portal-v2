import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";
import { assertRpcCallShape } from "../../test-utils/assert-rpc";

vi.mock("../../lib/supabase", () => ({
  userClient: vi.fn(),
}));

import { userClient } from "../../lib/supabase";
vi.mock("../../lib/sales-order-document-search", () => ({ findSalesOrderDocuments: vi.fn(async () => ({ orderIds: [] as string[], soNumbers: [] as number[] })) }));
import { findSalesOrderDocuments } from "../../lib/sales-order-document-search";


// The Work Completed writer (0584) observes this door from a middleware and is
// proven in lib/sales-order-work-completion*.test.ts; here it passes through,
// so these tests keep asserting only what the door itself writes.
vi.mock("../../lib/sales-order-work-completion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sales-order-work-completion")>()),
  salesOrderWorkCompletion: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
}));


const SUPABASE_URL = "https://test.supabase.co";

const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
};

async function makeJwt(role: string) {
  return signTestJwt("11111111-1111-1111-1111-000000000999", {
    email: `${role}@carres.com`,
    app_metadata: { role },
  });
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
  vi.mocked(findSalesOrderDocuments).mockResolvedValue({ orderIds: [], soNumbers: [] });
});

afterAll(() => _setJwksForTesting(null));

describe("GET /api/operation/orders", () => {
  const ORDER_ROW = {
    id: "00000000-0000-0000-0000-000000000a01",
    so: 4001,
    status: "proceed_order",
    operation_stage: "in_production",
    warehouse_id: "00000000-0000-0000-0000-000000000w01",
    customer_name: "Tan Ah Kow",
    placed_at: "2026-05-03T10:00:00Z",
    delivery_date: "2026-05-10",
    delivery_partner_id: null,
    do_number: null,
    dispatched_at: null,
    delivered_at: null,
    outlet_id: null,
    dealer_id: "00000000-0000-0000-0000-000000000d01",
    dealers: { name: "BedHouse KL" },
  };

  function mockOrdersList(rows: typeof ORDER_ROW[]) {
    const eq = vi.fn().mockReturnThis();
    const inFn = vi.fn().mockReturnThis();
    const ilike = vi.fn().mockReturnThis();
    const or = vi.fn().mockReturnThis();
    const not = vi.fn().mockReturnThis();
    const is = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn((_n: number, o?: { referencedTable?: string }) => (o?.referencedTable ? chainRef.current : Promise.resolve({ data: rows, error: null })));
    const chainRef: { current: unknown } = { current: null };
    const select = vi.fn((_fields?: string) => (chainRef.current = { in: inFn, eq, ilike, or, not, is, order, limit }));
    vi.mocked(userClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return { select, eq, inFn, ilike, or, not, is, order, limit };
  }

  it("reads invoice, receipt allocation and amendment lineage from their source ledgers", async () => {
    const { select, eq } = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request("http://t/api/operation/orders", { headers: { Authorization: `Bearer ${jwt}` } }), env);
    expect(res.status).toBe(200);
    const fields = String(select.mock.calls[0]?.[0]);
    expect(fields).toContain("original_request:sales_order_revisions(revision,snapshot)");
    expect(eq).toHaveBeenCalledWith("original_request.revision", 1);
    expect(fields).toContain("invoice_documents:invoices(id,invoice_no)");
    expect(fields).toContain("receipt_documents:order_payments(id,receipt_no)");
    expect(fields).toContain("allocated_receipts:payment_allocations(order_payments(id,receipt_no))");
    expect(fields).toContain("amendment_documents:sales_order_amendments(id,status)");
  });

  it("searches linked identities before the register cap, retaining normal order scope", async () => {
    const { or } = mockOrdersList([ORDER_ROW]);
    vi.mocked(findSalesOrderDocuments).mockResolvedValue({ orderIds: [ORDER_ROW.id], soNumbers: [4001, 4002] });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request("http://t/api/operation/orders?stage=proceeded&search=RC-123", { headers: { Authorization: `Bearer ${jwt}` } }), env);
    expect(res.status).toBe(200);
    expect(or.mock.calls.some(([value]) => value.includes(`id.in.(${ORDER_ROW.id})`) && value.includes("so.in.(4001,4002)"))).toBe(true);
    expect(findSalesOrderDocuments).toHaveBeenCalledWith(expect.anything(), "RC-123");
  });

  it("returns orders for operation with default 'all' stage and 'all' channel", async () => {
    const { inFn, order, limit } = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: typeof ORDER_ROW[] };
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]?.so).toBe(4001);
    // Pipeline v2 (C3): status filter now includes 'place' so the kanban
    // can render the "Placed" column.
    expect(inFn).toHaveBeenCalledWith("status", ["place", "proceed_order", "delivered"]);
    expect(order).toHaveBeenCalledWith("placed_at", { ascending: false });
    // STAGE 1 FIX 1 — the 200-row trap removed; the agreed cap is 500.
    expect(limit).toHaveBeenCalledWith(500);
  });

  /* ⭐ `{n} of {m}` needs the SERVER's count of the permitted scope — not the
     500-row page, not the search answer. */
  describe("salesOrderTotal — the Register's authoritative total", () => {
    /* Which table each recorded call was made on — kept beside the calls so
       the recorded shape the older assertions compare stays unchanged. */
    let tableOfCall = new WeakMap<object, string>();
    function mockWithCount(opts: { rows: unknown[]; count: number | null; countError?: unknown }) {
      const calls: Array<{ head: boolean; method: string; args: unknown[] }> = [];
      tableOfCall = new WeakMap();
      const record = (table: string, call: { head: boolean; method: string; args: unknown[] }) => {
        tableOfCall.set(call, table);
        calls.push(call);
      };
      const from = vi.fn((table: string) => {
        let head = false;
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn((_cols: string, o?: { count?: string; head?: boolean }) => {
          head = Boolean(o?.head);
          record(table, { head, method: "select", args: [_cols, o] });
          return chain;
        });
        for (const m of ["in", "eq", "neq", "ilike", "or", "not", "is", "order", "limit", "range"])
          chain[m] = vi.fn((...args: unknown[]) => { record(table, { head, method: m, args }); return chain; });
        chain.then = (resolve: (v: unknown) => unknown) =>
          resolve(head ? { count: opts.count, error: opts.countError ?? null, data: null } : { data: opts.rows, error: null });
        return chain;
      });
      vi.mocked(userClient).mockReturnValue({ from } as never);
      return calls;
    }
    const get = async (qs = "") => {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(new Request(`http://t/api/operation/orders${qs}`, { headers: { Authorization: `Bearer ${jwt}` } }), env);
      expect(res.status).toBe(200);
      return (await res.json()) as { orders: unknown[]; salesOrderTotal: number | null };
    };

    it("answers a search with the UNSEARCHED total, counted head-only and without rentals", async () => {
      const calls = mockWithCount({ rows: [ORDER_ROW], count: 612 });
      const body = await get("?search=Tan");
      expect(body.orders).toHaveLength(1);
      expect(body.salesOrderTotal).toBe(612);
      const countCalls = calls.filter((c) => c.head);
      expect(countCalls.find((c) => c.method === "select")?.args[1]).toEqual({ count: "exact", head: true });
      expect(countCalls).toContainEqual({ head: true, method: "in", args: ["status", ["place", "proceed_order", "delivered"]] });
      expect(countCalls).toContainEqual({ head: true, method: "or", args: ["source_system.is.null,source_system.neq.rental"] });
      /* The search narrows the rows, never the total. */
      expect(countCalls.some((c) => c.method === "or" && String(c.args[0]).includes("customer_name"))).toBe(false);
    });

    it("reports a total larger than the 500-row page it returns", async () => {
      mockWithCount({ rows: Array.from({ length: 500 }, (_, i) => ({ ...ORDER_ROW, id: `o-${i}`, so: 5000 + i })), count: 612 });
      const body = await get();
      expect(body.orders).toHaveLength(500);
      expect(body.salesOrderTotal).toBe(612);
    });

    it("narrows the total by the same stage and channel as the list", async () => {
      const calls = mockWithCount({ rows: [], count: 3 });
      await get("?stage=placed&channel=showrooms");
      const countCalls = calls.filter((c) => c.head);
      expect(countCalls).toContainEqual({ head: true, method: "eq", args: ["status", "place"] });
      expect(countCalls).toContainEqual({ head: true, method: "not", args: ["outlet_id", "is", null] });
    });

    /* ⭐ THE SALES ORDERS REGISTER POPULATION — ONE POPULATION, ONE PREDICATE
       (owner ruling 2026-09-26, Orders MASTER §0.1 REGISTER CLOSE-OUT item 4).
       Every non-cancelled handed-over order, rentals excluded ON THE SERVER,
       and the rows and the total are narrowed by the SAME calls. */
    const populationCalls = (calls: Array<{ head: boolean; method: string; args: unknown[] }>, head: boolean) =>
      calls
        .filter((c) => c.head === head && tableOfCall.get(c) === "orders")
        .filter((c) =>
          (["in", "eq", "neq", "not"].includes(c.method) && c.args[0] === "status") ||
          (c.method === "or" && String(c.args[0]).includes("source_system")))
        .map((c) => ({ method: c.method, args: c.args }));

    it("stage=proceeded reads the rows AND the total through one predicate, and serves proceeded_at", async () => {
      const calls = mockWithCount({ rows: [ORDER_ROW], count: 29 });
      const body = await get("?stage=proceeded");
      expect(body.salesOrderTotal).toBe(29);
      const expected = [
        { method: "not", args: ["status", "in", "(place,cancelled)"] },
        { method: "or", args: ["source_system.is.null,source_system.neq.rental"] },
      ];
      expect(populationCalls(calls, false)).toEqual(expected);
      expect(populationCalls(calls, true)).toEqual(expected);
      const listSelect = calls.find((c) => !c.head && c.method === "select");
      expect(String(listSelect?.args[0])).toContain("proceeded_at");
      /* Never the planned production-start field in its place. */
      expect(calls.some((c) => c.method === "eq" && c.args[0] === "operation_stage")).toBe(false);
    });

    it("stage=proceeded keeps one predicate when a search narrows the rows", async () => {
      const calls = mockWithCount({ rows: [ORDER_ROW], count: 29 });
      await get("?stage=proceeded&search=Tan");
      expect(populationCalls(calls, false)).toEqual(populationCalls(calls, true));
      expect(populationCalls(calls, false)).toHaveLength(2);
    });

    /* The list is shared (Delivery, Work, Payments, the dashboard, the old
       Orders control). Off the Register's path nothing they receive changes:
       Placed rows and rentals still ride the list. */
    it("leaves every other caller's list as it was — no Register predicate without stage=proceeded", async () => {
      const calls = mockWithCount({ rows: [ORDER_ROW], count: 40 });
      await get();
      expect(populationCalls(calls, false)).toEqual([
        { method: "in", args: ["status", ["place", "proceed_order", "delivered"]] },
      ]);
    });

    it("says UNKNOWN (null), never a guess, when the count cannot be read", async () => {
      mockWithCount({ rows: [ORDER_ROW], count: null, countError: { message: "timeout" } });
      const body = await get();
      expect(body.orders).toHaveLength(1);
      expect(body.salesOrderTotal).toBeNull();
    });
  });

  /* ⭐ FIND AN ORDER BY PHONE (Orders MASTER §0 Charter). The Sales Order
     page's `Existing customer · {n} orders ›` opens this list searched by the
     phone; before this read the server matched no phone, so the answer
     replaced the rows with nothing. */
  describe("phone search — the digits find the order however they were written", () => {
    type Call = { table: string; cols: string; head: boolean; method: string; args: unknown[] };
    const PHONE_COLS = "id, customer_phone";
    function mockPhoneRead(opts: { phones?: Array<{ id: string; customer_phone: string | null }>; phoneError?: unknown }) {
      const calls: Call[] = [];
      const from = vi.fn((table: string) => {
        let cols = "";
        let head = false;
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn((c: string, o?: { head?: boolean }) => {
          cols = c;
          head = Boolean(o?.head);
          calls.push({ table, cols, head, method: "select", args: [c, o] });
          return chain;
        });
        for (const m of ["in", "eq", "neq", "ilike", "or", "not", "is", "order", "limit", "range"])
          chain[m] = vi.fn((...args: unknown[]) => { calls.push({ table, cols, head, method: m, args }); return chain; });
        chain.then = (resolve: (v: unknown) => unknown) =>
          resolve(
            head
              ? { count: 1, error: null, data: null }
              : cols === PHONE_COLS
                ? opts.phoneError
                  ? { data: null, error: opts.phoneError }
                  : { data: opts.phones ?? [], error: null }
                : { data: [ORDER_ROW], error: null },
          );
        return chain;
      });
      vi.mocked(userClient).mockReturnValue({ from } as never);
      return calls;
    }
    const search = async (term: string, stage = "proceeded") => {
      const jwt = await makeJwt("operation");
      return app.fetch(
        new Request(`http://t/api/operation/orders?stage=${stage}&search=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${jwt}` } }),
        env,
      );
    };
    const listOr = (calls: Call[]) =>
      calls.filter((c) => c.table === "orders" && !c.head && c.cols !== PHONE_COLS && c.method === "or").map((c) => String(c.args[0]));
    const searchClause = (calls: Call[]) => listOr(calls).find((v) => v.includes("customer_name")) ?? "";

    it.each([
      ["019-00000075", "019-00000075"],
      ["01900000075", "019-00000075"],
      ["019 0000 0075", "019-00000075"],
      ["(019) 0000-0075", "019-00000075"],
      ["+60190000 0075", "019-00000075"],
      ["+60 19-0000 0075", "019-00000075"],
      ["0123456789", "+60123456789"],
      ["012-345 6789", "+60 12-345 6789"],
      ["+60123456789", "0123456789"],
      ["0123456789", "123456789"],
    ])("typed %s finds the order stored as %s", async (typed, stored) => {
      const calls = mockPhoneRead({
        phones: [
          { id: "hit-order", customer_phone: stored },
          { id: "other-order", customer_phone: "011-1111 2222" },
        ],
      });
      const res = await search(typed);
      expect(res.status).toBe(200);
      const clause = searchClause(calls);
      expect(clause).toContain("id.in.(hit-order)");
      expect(clause).not.toContain("other-order");
    });

    it("reads the phones of the list's OWN population, through the caller's RLS client", async () => {
      const calls = mockPhoneRead({ phones: [] });
      await search("019-0000 0075");
      const phoneCalls = calls.filter((c) => c.cols === PHONE_COLS).map((c) => ({ method: c.method, args: c.args }));
      expect(phoneCalls).toContainEqual({ method: "not", args: ["status", "in", "(place,cancelled)"] });
      expect(phoneCalls).toContainEqual({ method: "or", args: ["source_system.is.null,source_system.neq.rental"] });
      expect(phoneCalls).toContainEqual({ method: "ilike", args: ["customer_phone", "%1%9%0%0%0%0%0%0%7%5%"] });
      expect(phoneCalls).toContainEqual({ method: "range", args: [0, 999] });
      /* No phone matched: no id clause, and the rest of the search is unchanged. */
      expect(searchClause(calls)).not.toContain("id.in.");
    });

    it("leaves a NAME search exactly as it was — no phone read", async () => {
      const calls = mockPhoneRead({ phones: [{ id: "hit-order", customer_phone: "0123456789" }] });
      const res = await search("Tan");
      expect(res.status).toBe(200);
      expect(calls.some((c) => c.cols === PHONE_COLS)).toBe(false);
      expect(searchClause(calls)).toBe("customer_name.ilike.%Tan%,source_ref.cs.{TAN},invoice_no.ilike.%TAN%,do_number.ilike.%TAN%");
    });

    it("leaves an SO-number search as it was — four digits are not a phone", async () => {
      const calls = mockPhoneRead({ phones: [{ id: "hit-order", customer_phone: "0123454001" }] });
      await search("4001");
      expect(calls.some((c) => c.cols === PHONE_COLS)).toBe(false);
      expect(searchClause(calls)).toContain("so.eq.4001");
    });

    it("fails the search when the phones cannot be read — never a silent `no order`", async () => {
      const calls = mockPhoneRead({ phoneError: { code: "42501", message: "permission denied for table orders" } });
      const res = await search("019-0000 0075");
      expect(res.status).toBe(403);
      /* The list itself was never answered with a phone-less search. */
      expect(listOr(calls).some((v) => v.includes("customer_name"))).toBe(false);
    });

    it("keeps a bracketed phone from breaking the or() grammar", async () => {
      const calls = mockPhoneRead({ phones: [{ id: "hit-order", customer_phone: "03-1234 5678" }] });
      const res = await search("(03) 1234 5678");
      expect(res.status).toBe(200);
      const clause = searchClause(calls);
      expect(clause.startsWith('customer_name.ilike."%(03) 1234 5678%",')).toBe(true);
      expect(clause).toContain("id.in.(hit-order)");
    });
  });

  it.each(["4001", "SO-4001", "so-4001", "SO 4001"])("finds the order number entered as %s", async (search) => {
    const { or } = mockOrdersList([]);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    expect(or).toHaveBeenCalledWith(expect.stringContaining("so.eq.4001"));
  });

  it.each(["4001 Smith", "CR4001", "SO-4001-extra", "9007199254740992"])("does not turn %s into an unrelated order number", async (search) => {
    const { or } = mockOrdersList([]);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    expect(or).toHaveBeenCalledWith(expect.not.stringContaining("so.eq."));
  });

  it("carries exact product-line bindings through both reserved and sold stock reads", async () => {
    const stockSelects: string[] = [];
    const from = vi.fn((table: string) => {
      let status: unknown;
      const chain: Record<string, unknown> = {};
      for (const method of ["in", "ilike", "or", "not", "is", "order", "limit", "range"])
        chain[method] = vi.fn(() => chain);
      chain.select = vi.fn((columns: string) => {
        if (table === "ops_stock_items") stockSelects.push(columns);
        return chain;
      });
      chain.eq = vi.fn((column: string, value: unknown) => {
        if (column === "status") status = value;
        return chain;
      });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, data:
        table === "orders" ? [ORDER_ROW] : table === "ops_stock_items" ?
          status === "reserved" ? [
            { sku: "same", qty: 1, reserved_ref: "SO-4001", reserved_order_line_id: "line-a" },
            { sku: "same", qty: 1, reserved_ref: "SO-4001", reserved_order_line_id: null },
          ] : status === "sold" ? [
            { sku: "same", qty: 2, sold_order_id: ORDER_ROW.id, reserved_order_line_id: "line-b" },
          ] : [] : [],
      });
      return chain;
    });
    vi.mocked(userClient).mockReturnValue({ from } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request("http://t/api/operation/orders", {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { orders: { allocated_units: unknown[] }[] };
    expect(body.orders[0]?.allocated_units).toEqual([
      { sku: "same", qty: 1, status: "reserved", orderLineId: "line-a" },
      { sku: "same", qty: 1, status: "reserved", orderLineId: null },
      { sku: "same", qty: 2, status: "sold", orderLineId: "line-b" },
    ]);
    expect(stockSelects).toHaveLength(2);
    expect(stockSelects.every(columns => columns.split(", ").includes("reserved_order_line_id"))).toBe(true);
  });

  // ── D1 · the list carries the SKUs a real purchase order covers ───────────
  //
  // Before D1 the only PO evidence on the wire was `order_lines.source_po`, a
  // column ONLY the AutoCount importer writes, so the Orders ladder read every
  // NATIVE order as "nothing ordered". Measured on production 2026-08-06: 19 of
  // 28 live orders were covered by a real purchase order and 0 carried
  // `source_po`. The link is the DRAWER's own — `purchase_orders.so` or
  // `so_refs[]` — batched over the page rather than one query per order.
  describe("D1 — po_skus", () => {
    /** Three tables, three answers: orders · purchase_orders · lines. */
    function mockWithPos(
      orders: Record<string, unknown>[],
      pos: Record<string, unknown>[],
      poLines: Record<string, unknown>[],
    ) {
      const from = vi.fn((table: string) => {
        if (table === "purchase_orders") {
          const or = vi.fn().mockResolvedValue({ data: pos, error: null });
          return { select: vi.fn(() => ({ or })) };
        }
        if (table === "purchase_order_lines") {
          const inFn = vi.fn().mockResolvedValue({ data: poLines, error: null });
          return { select: vi.fn(() => ({ in: inFn })) };
        }
        const chain: Record<string, unknown> = {};
        for (const k of ["in", "eq", "ilike", "or", "not", "is", "order"])
          chain[k] = vi.fn(() => chain);
        chain.limit = vi.fn((_n: number, o?: { referencedTable?: string }) => (o?.referencedTable ? chain : Promise.resolve({ data: orders, error: null })));
        return { select: vi.fn(() => chain) };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(userClient).mockReturnValue({ from } as any);
      return from;
    }

    async function get() {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(
        new Request("http://t/api/operation/orders", {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        env,
      );
      return (await res.json()) as {
        orders: { so: number; po_skus: string[]; po_numbers: string[] }[];
      };
    }

    it("a PO linked through so_refs[] puts its SKUs on the order", async () => {
      mockWithPos(
        [{ ...ORDER_ROW, so: 1206 }],
        [{ id: "PO-2049", so: null, so_refs: [1206] }],
        [{ po_id: "PO-2049", sku: "mattress:MAT-1" }],
      );
      const body = await get();
      expect(body.orders[0]?.po_skus).toEqual(["mattress:MAT-1"]);
      expect(body.orders[0]?.po_numbers).toEqual(["PO-2049"]);
    });

    it("a PO linked through its own so also counts", async () => {
      mockWithPos(
        [{ ...ORDER_ROW, so: 1206 }],
        [{ id: "PO-1", so: 1206, so_refs: null }],
        [{ po_id: "PO-1", sku: "sofa:SOF-1" }],
      );
      expect((await get()).orders[0]?.po_skus).toEqual(["sofa:SOF-1"]);
    });

    it("ONE consolidated PO serves EVERY sales order it names", async () => {
      mockWithPos(
        [
          { ...ORDER_ROW, id: "a", so: 1206 },
          { ...ORDER_ROW, id: "b", so: 1213 },
        ],
        [{ id: "PO-9", so: null, so_refs: [1206, 1213] }],
        [{ po_id: "PO-9", sku: "mattress:MAT-1" }],
      );
      const body = await get();
      expect(body.orders[0]?.po_skus).toEqual(["mattress:MAT-1"]);
      expect(body.orders[1]?.po_skus).toEqual(["mattress:MAT-1"]);
      expect(body.orders[0]?.po_numbers).toEqual(["PO-9"]);
      expect(body.orders[1]?.po_numbers).toEqual(["PO-9"]);
    });

    it("an order NO purchase order names gets an empty list, never another order's SKUs", async () => {
      mockWithPos(
        [
          { ...ORDER_ROW, id: "a", so: 1206 },
          { ...ORDER_ROW, id: "b", so: 9999 },
        ],
        [{ id: "PO-9", so: null, so_refs: [1206] }],
        [{ po_id: "PO-9", sku: "mattress:MAT-1" }],
      );
      const body = await get();
      expect(body.orders[1]?.po_skus).toEqual([]);
      expect(body.orders[1]?.po_numbers).toEqual([]);
    });

    it("a PO with no lines retains its document number without claiming goods coverage", async () => {
      mockWithPos(
        [{ ...ORDER_ROW, so: 1206 }],
        [{ id: "PO-EMPTY", so: null, so_refs: [1206] }],
        [],
      );
      const body = await get();
      expect(body.orders[0]?.po_skus).toEqual([]);
      expect(body.orders[0]?.po_numbers).toEqual(["PO-EMPTY"]);
    });

    it("ONE batched query for the whole page — never one per order", async () => {
      const from = mockWithPos(
        [
          { ...ORDER_ROW, id: "a", so: 1206 },
          { ...ORDER_ROW, id: "b", so: 1213 },
          { ...ORDER_ROW, id: "c", so: 1216 },
        ],
        [{ id: "PO-9", so: null, so_refs: [1206] }],
        [{ po_id: "PO-9", sku: "mattress:MAT-1" }],
      );
      await get();
      const poCalls = from.mock.calls.filter((c) => c[0] === "purchase_orders");
      const lineCalls = from.mock.calls.filter(
        (c) => c[0] === "purchase_order_lines",
      );
      expect(poCalls).toHaveLength(1);
      expect(lineCalls).toHaveLength(1);
    });
  });

  /**
   * THE LIST CARRIES THE CATALOG'S CATEGORY (2026-08-24).
   *
   * Jess: "Other goods 44 - the number doesn't tally." The register footer
   * classified a line from its SKU TEXT alone while the SO detail read the
   * catalog first, so one product counted two ways on two screens. The list
   * now stamps `category` the SAME way the detail route has since PR 885,
   * through `skuCategories` - the ONE category reader (Law D).
   */
  describe("category on list lines", () => {
    function mockWithCatalog(
      orders: Record<string, unknown>[],
      productSkus: Record<string, unknown>[],
    ) {
      const from = vi.fn((table: string) => {
        if (table === "product_skus") {
          // ONE fixture serves BOTH readers of this table -
          // `resolveSkuLabels` (name) and `skuCategories` (category).
          const inFn = vi.fn().mockResolvedValue({ data: productSkus, error: null });
          return { select: vi.fn(() => ({ in: inFn })) };
        }
        if (table === "purchase_orders") {
          const or = vi.fn().mockResolvedValue({ data: [], error: null });
          return { select: vi.fn(() => ({ or })) };
        }
        if (table === "purchase_order_lines") {
          const inFn = vi.fn().mockResolvedValue({ data: [], error: null });
          return { select: vi.fn(() => ({ in: inFn })) };
        }
        const chain: Record<string, unknown> = {};
        for (const k of ["in", "eq", "ilike", "or", "not", "is", "order"])
          chain[k] = vi.fn(() => chain);
        chain.limit = vi.fn((_n: number, o?: { referencedTable?: string }) => (o?.referencedTable ? chain : Promise.resolve({ data: orders, error: null })));
        return { select: vi.fn(() => chain) };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(userClient).mockReturnValue({ from } as any);
      return from;
    }

    async function lines() {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(
        new Request("http://t/api/operation/orders", {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        env,
      );
      const body = (await res.json()) as {
        orders: { order_lines: { sku: string; category: string | null }[] }[];
      };
      return body.orders[0]?.order_lines ?? [];
    }

    it("stamps the catalog category onto a line the SKU parser cannot read", async () => {
      mockWithCatalog(
        [{ ...ORDER_ROW, order_lines: [{ sku: "1013Jager/Fab3-King", qty: 1 }] }],
        [
          {
            sku: "1013Jager/Fab3-King",
            variant: "King",
            product_models: { name: "Jager", category: "mattress" },
          },
        ],
      );
      expect((await lines())[0]?.category).toBe("mattress");
    });

    it("a SKU the catalog does not hold reads null - never a guessed category", async () => {
      mockWithCatalog(
        [{ ...ORDER_ROW, order_lines: [{ sku: "NOT-IN-CATALOG", qty: 1 }] }],
        [],
      );
      expect((await lines())[0]?.category).toBeNull();
    });

    it("ONE batched product_skus read for the whole page, never one per order", async () => {
      // `skuCategories` and `resolveSkuLabels` each read this table once
      // for the page. Two reads total is the documented price of keeping
      // ONE category owner; what must never happen is a read PER ORDER.
      const from = mockWithCatalog(
        [
          { ...ORDER_ROW, id: "a", so: 1206, order_lines: [{ sku: "S-1", qty: 1 }] },
          { ...ORDER_ROW, id: "b", so: 1213, order_lines: [{ sku: "S-2", qty: 1 }] },
          { ...ORDER_ROW, id: "c", so: 1216, order_lines: [{ sku: "S-3", qty: 1 }] },
        ],
        [],
      );
      await lines();
      const skuCalls = from.mock.calls.filter((c) => c[0] === "product_skus");
      expect(skuCalls.length).toBeLessThanOrEqual(2);
    });
  });

  it("returns status='place' rows in the response (pipeline v2 'Placed' column)", async () => {
    const PLACE_ROW = {
      ...ORDER_ROW,
      id: "00000000-0000-0000-0000-000000000a02",
      so: 4002,
      status: "place",
      operation_stage: null,
      warehouse_id: null,
    };
    // PLACE_ROW has nulls for operation_stage + warehouse_id (real shape for
     // status='place' rows); the helper's `typeof ORDER_ROW` is over-narrow.
     mockOrdersList([PLACE_ROW as unknown as typeof ORDER_ROW]);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as { orders: any[] };
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].status).toBe("place");
  });

  it("filters by stage=placed via status='place' (synthetic stage)", async () => {
    const { eq } = mockOrdersList([]);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request("http://t/api/operation/orders?stage=placed", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    // 'placed' is synthetic — derived from status, not operation_stage.
    expect(eq).toHaveBeenCalledWith("status", "place");
  });

  it("filters by stage=confirmed via operation_stage column", async () => {
    const { eq } = mockOrdersList([]);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request("http://t/api/operation/orders?stage=confirmed", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(eq).toHaveBeenCalledWith("operation_stage", "confirmed");
  });

  it("filters by stage when query param provided", async () => {
    const { eq } = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request("http://t/api/operation/orders?stage=ready_to_dispatch", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(eq).toHaveBeenCalledWith("operation_stage", "ready_to_dispatch");
  });

  it("0584 · narrows to one order for the Work completion probe, and refuses a malformed id", async () => {
    const { eq } = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    const id = "11111111-0000-4000-8000-000000000001";
    const ok = await app.fetch(
      new Request(`http://t/api/operation/orders?orderId=${id}`, { headers: { Authorization: `Bearer ${jwt}` } }),
      env,
    );
    expect(ok.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("id", id);
    const bad = await app.fetch(
      new Request("http://t/api/operation/orders?orderId=not-an-id", { headers: { Authorization: `Bearer ${jwt}` } }),
      env,
    );
    expect(bad.status).toBe(422);
  });

  it("filters by channel=dealers excludes showroom orders (outlet_id IS NULL)", async () => {
    const m = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request("http://t/api/operation/orders?channel=dealers", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    // dealers channel: outlet_id IS NULL via .is("outlet_id", null). PostgREST
    // requires .is(col, null) for SQL IS NULL — .eq(col, null) serializes to
    // outlet_id=eq.null (string filter) which never matches a uuid column.
    // Public 'channel=dealers' wording kept per spec §18.3; filter uses outlet_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (m.is as any).mock.calls;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(calls.find((c: any[]) => c[0] === 'outlet_id' && c[1] === null)).toBeTruthy();
  });

  it("filters by channel=showrooms (outlet_id IS NOT NULL)", async () => {
    const m = mockOrdersList([ORDER_ROW]);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request("http://t/api/operation/orders?channel=showrooms", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    // showrooms channel: outlet_id IS NOT NULL via .not("outlet_id", "is", null)
    // (Public 'channel=showrooms' wording kept per spec §18.3; internally filters on outlet_id.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (m.not as any).mock.calls;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(calls.find((c: any[]) => c[0] === 'outlet_id' && c[1] === 'is' && c[2] === null)).toBeTruthy();
  });

  it("returns 422 for invalid stage", async () => {
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders?stage=bogus", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(422);
  });

  it("returns 403 for dealer role (no Supabase round-trip)", async () => {
    const from = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ from } as any);
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.fetch(new Request("http://t/api/operation/orders"), env);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/operation/orders/:id", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";

  function mockDetailQueries(opts: {
    order?: any;
    lines?: any[];
    addons?: any[];
    history?: any[];
    pos?: any[];
    poLines?: any[];
    warehouse?: any;
    stockBalances?: any[];
    /** Rows `product_skus` answers with. ONE fixture serves BOTH readers the
     *  route makes of that table — `resolveSkuLabels` (name) and
     *  `skuCategories` (category) — which is the point: they read one join. */
    productSkus?: any[];
    freeUnits?: any[];
    /** The two name sources the History actor is resolved from. They are
     *  SEPARATE fixtures on purpose: the staff door (`actor_display_names`,
     *  0390) returns only internal-staff accounts, so a test that fed one
     *  list to both would prove nothing about the case that actually breaks
     *  — a salesperson whose name only `salespersons` can answer. */
    appUsers?: any[];
    salespersons?: any[];
    /** The `ops_order_control` overlay row; `controlFail` makes its read fail. */
    control?: any;
    controlFail?: boolean;
    /** What `app_users` answers for the SO PIC (null = RLS hides the row). */
    picUser?: any;
  }) {
    const fromImpl = vi.fn((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnThis(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promise = (data: any) => Promise.resolve({ data, error: null });
      switch (table) {
        case 'orders':
          chain.maybeSingle = vi.fn(() => promise(opts.order ?? null));
          break;
        case 'order_lines':
          chain.eq = vi.fn(() => promise(opts.lines ?? []));
          break;
        case 'order_addons':
          chain.eq = vi.fn(() => promise(opts.addons ?? []));
          break;
        case 'order_history':
          chain.order = vi.fn(() => promise(opts.history ?? []));
          break;
        case 'salespersons':
          chain.in = vi.fn(() => promise(opts.salespersons ?? []));
          break;
        case 'purchase_orders':
          chain.or = vi.fn(() => promise(opts.pos ?? []));
          break;
        case 'purchase_order_lines':
          chain.in = vi.fn(() => promise(opts.poLines ?? []));
          break;
        case 'warehouses':
          chain.maybeSingle = vi.fn(() => promise(opts.warehouse ?? null));
          break;
        // 0366 — the order drawer reads the unit register's one availability
        // authority. Fixtures still describe a site as {qty, reserved}; the
        // view's `on_hand`/`available` are derived here as the register does.
        case 'stock_sku_availability':
          chain.in = vi.fn(() =>
            promise(
              (opts.stockBalances ?? []).map((b: {
                sku: string;
                warehouse_id: string;
                qty: number;
                reserved: number;
                available?: number;
              }) => ({
                sku: b.sku,
                warehouse_id: b.warehouse_id,
                on_hand: b.qty,
                reserved: b.reserved,
                available: b.available ?? b.qty - b.reserved,
              })),
            ),
          );
          break;
        // These two are awaited at the END of a chain whose length varies
        // (`ops_stock_items` appends `.eq(warehouse)` only when the order has
        // one), so the chain itself is the thenable rather than any one method.
        case 'product_skus':
          chain.then = (res: (v: unknown) => unknown) =>
            res({ data: opts.productSkus ?? [], error: null });
          break;
        case 'ops_order_control':
          chain.maybeSingle = vi.fn(() =>
            opts.controlFail
              ? Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } })
              : promise(opts.control ?? null));
          break;
        case 'app_users':
          chain.maybeSingle = vi.fn(() => promise(opts.picUser ?? null));
          break;
        case 'ops_stock_items':
          chain.then = (res: (v: unknown) => unknown) =>
            res({ data: opts.freeUnits ?? [], error: null });
          break;
      }
      return chain;
    });
    /* The staff half of the actor lookup goes through the 0390 definer door,
       not a table read — the fixture keeps its old name because it plays the
       same part: what the internal-staff source answers. */
    const rpcImpl = vi.fn((fn: string) =>
      fn === "actor_display_names"
        ? Promise.resolve({ data: opts.appUsers ?? [], error: null })
        : Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ from: fromImpl, rpc: rpcImpl } as any);
    return Object.assign(fromImpl, { rpc: rpcImpl });
  }

  it("returns 404 when order does not exist", async () => {
    mockDetailQueries({ order: null });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("retired POST /api/operation/orders/:id/warehouse", () => {
  it.each([{}, { warehouseId: "00000000-0000-0000-0000-000000000c02" }, { warehouseId: "not-a-uuid" }])(
    "refuses stale requests before opening a database client: %j", async (body) => {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(new Request("http://t/api/operation/orders/00000000-0000-0000-0000-000000000a01/warehouse", {
        method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), env);
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ code: "warehouse_pick_retired" });
      expect(userClient).not.toHaveBeenCalled();
    },
  );
  it("preserves the Operation permission boundary", async () => {
    const jwt = await makeJwt("finance");
    const res = await app.fetch(new Request("http://t/api/operation/orders/00000000-0000-0000-0000-000000000a01/warehouse", {
      method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: "{}",
    }), env);
    expect(res.status).toBe(403);
    expect(userClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/operation/orders/:id/reselect-partner (migration 0147 — item h)", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";
  const PARTNER_ID = "00000000-0000-0000-0000-000000000b02";

  it("returns 200 and forwards p_order_id + p_partner_id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        order_id: ORDER_ID,
        so: 4001,
        delivery_partner_id: PARTNER_ID,
        request_for_delivery_at: new Date().toISOString(),
      },
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/reselect-partner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: PARTNER_ID }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("operation_reselect_partner", {
      p_order_id: ORDER_ID,
      p_partner_id: PARTNER_ID,
    });
  });

  it("returns 422 with code='not_rejected' when order has no active reject", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "order is not in rejected state", details: "not_rejected" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/reselect-partner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: PARTNER_ID }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_rejected");
  });

  it("returns 422 with code='same_partner' when reselecting the LP that just rejected", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "cannot reselect the same partner", details: "same_partner" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/reselect-partner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: PARTNER_ID }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.code).toBe("same_partner");
  });

  it("returns 422 when partnerId is not a uuid", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/reselect-partner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: "nope" }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 403 for non-operation role", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/reselect-partner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: PARTNER_ID }),
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("retired POST /api/operation/orders/:id/transfer-ready", () => {
  it.each([{}, { warehouseId: "00000000-0000-0000-0000-000000000c02" }, { warehouseId: "not-a-uuid" }])(
    "refuses stale requests before opening a database client: %j", async (body) => {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(new Request("http://t/api/operation/orders/00000000-0000-0000-0000-000000000a01/transfer-ready", {
        method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), env);
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ code: "warehouse_pick_retired" });
      expect(userClient).not.toHaveBeenCalled();
    },
  );
  it("preserves the Operation permission boundary", async () => {
    const jwt = await makeJwt("finance");
    const res = await app.fetch(new Request("http://t/api/operation/orders/00000000-0000-0000-0000-000000000a01/transfer-ready", {
      method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: "{}",
    }), env);
    expect(res.status).toBe(403);
    expect(userClient).not.toHaveBeenCalled();
  });
});

describe("retired POST /api/operation/orders/:id/issue-pos", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";

  it("is unreachable and never calls a PO creation RPC", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/issue-pos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// 2026-05-12 (Loo) — revert RPCs added by migration 0095.
describe("POST /api/operation/orders/:id/revert-proceed", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";

  it("returns 200 on success and calls the right RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { order_id: ORDER_ID, so: 1001, status: "place", operation_stage: "placed" },
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-proceed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("operation_revert_order_proceed_to_placed", {
      p_order_id: ORDER_ID,
    });
  });

  it("admits principal role too (Loo's de-facto admin)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { order_id: ORDER_ID, so: 1001, status: "place", operation_stage: "placed" },
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("principal");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-proceed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalled();
  });

  it("returns 403 for dealer (not operation or principal)", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-proceed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC 22023 wrong_stage → 422 invalid_param", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "Order is not in confirmed stage",
        details: "wrong_stage",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-proceed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.code).toBe("wrong_stage");
  });
});

describe("POST /api/operation/orders/:id/revert-dispatch", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";

  it("returns 200 + threads_reverted on success", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { order_id: ORDER_ID, so: 1002, threads_reverted: 2 },
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("operation_revert_order_dispatched_to_ready", {
      p_order_id: ORDER_ID,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.threads_reverted).toBe(2);
  });

  it("returns 403 for partner role", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("partner");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC 22023 no_dispatched_threads → 422", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "No dispatched threads on this order",
        details: "no_dispatched_threads",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/revert-dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.code).toBe("no_dispatched_threads");
  });
});

/**
 * STAGE 2 · THE REVISION ENGINE — the API is a THIN door: validation + ONE
 * RPC. The property held hardest: **no route here writes orders or
 * order_lines directly** — every write goes through the 0327 RPCs, which own
 * Rev-1 minting and immutability.
 */
describe("POST /api/operation/orders/:id/save", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000b01";

  it("saves only safe correction fields and writes nothing directly", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { revision: 2, changed: ["customer_phone", "proceed_date"] },
      error: null,
    });
    const from = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          header: { customer_phone: "012-3456789", proceed_date: "2026-09-05" },
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("sales_order_save_revision", {
      p_order_id: ORDER_ID,
      p_header: { customer_phone: "012-3456789", proceed_date: "2026-09-05" },
      p_lines: null,
      p_change: null,
    });
    /* NOTHING was written directly — the RPC owns every write. */
    expect(from).not.toHaveBeenCalled();
    assertRpcCallShape(rpc, "sales_order_save_revision", [
      "p_order_id",
      "p_header",
      "p_lines",
      "p_change",
    ]);
  });

  /* 0354 — the object page's form IS the Sales Portal's form (owner ruling
     2026-08-15), so the door must accept every question the portal asks. A
     `.strict()` schema that had never heard of `customer_race` turned a field
     the operator could SEE into a field they could never fix. */
  it("accepts the rest of what the Sales Portal asks", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { revision: 3, changed: [] }, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from: vi.fn() } as any);
    const jwt = await makeJwt("operation");
    const header = {
      customer_race: "Chinese",
      customer_gender: "Female",
      customer_birthday: "1990-04-02",
      customer_address_unknown: false,
      customer_billing_same: true,
      delivery_stair_items: 2,
      entry_fields: { building_type: "Condo", referral: null },
    };
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ header }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("sales_order_save_revision", {
      p_order_id: ORDER_ID,
      p_header: header,
      p_lines: null,
      p_change: null,
    });
  });

  it("still refuses attribution at the API boundary", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    for (const header of [
      { salesperson_id: "00000000-0000-0000-0000-0000000000a1" },
      { outlet_id: "00000000-0000-0000-0000-0000000000a2" },
      { dealer_id: "00000000-0000-0000-0000-0000000000a3" },
    ]) {
      const res = await app.fetch(
        new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({ header }),
        }),
        env,
      );
      expect(res.status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses contractual items at the API boundary", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          header: { customer_phone: "012-3456789" },
          lines: [{ sku: "MODEL-B", qty: 1, unit_price: 2799 }],
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses the promised date at the API boundary", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          header: { delivery_date: "2026-09-05" },
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty save without calling the database", async () => {
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own refusal (22023 detail) instead of a bare 500", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Nothing changed", details: "invalid_param" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ header: { customer_phone: "012-3456789" } }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.message).toBe("Nothing changed");
  });
});

describe("Sales Order amendment decision lane", () => {
  const AMENDMENT_ID = "00000000-0000-0000-0000-000000000a01";

  it("returns the owner impact preview without writing another module", async () => {
    const impact = {
      amendment_id: AMENDMENT_ID,
      stale: false,
      findings: [{ owner: "Purchasing", kind: "purchase_order", count: 1, blocks: false }],
    };
    const rpc = vi.fn().mockResolvedValue({ data: impact, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/amendment/${AMENDMENT_ID}/impact`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(impact);
    expect(rpc).toHaveBeenCalledWith("sales_order_amendment_impact", {
      p_amendment_id: AMENDMENT_ID,
    });
  });
});

describe("retired POST /api/operation/orders (the office create door)", () => {
  /* ⭐ OWNER RULING 2026-09-27 (Jess): a customer order is born in the Sales
     Portal and nowhere else; Operation receives it and never creates it. */
  it.each([{}, { header: { customer_name: "Walk-in" }, lines: [{ sku: "X", qty: 1, unit_price: 1 }] }])(
    "refuses a stale client before opening a database client: %j",
    async (body) => {
      const jwt = await makeJwt("operation");
      const res = await app.fetch(
        new Request("http://t/api/operation/orders", {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({
        error: "This action is no longer available. A Sales Order is created in the Sales Portal.",
        code: "office_create_retired",
      });
      expect(userClient).not.toHaveBeenCalled();
    },
  );

  it("preserves the Operation permission boundary", async () => {
    const jwt = await makeJwt("finance");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: "{}",
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(userClient).not.toHaveBeenCalled();
  });
});

/**
 * CARD 1 — CUSTOMER OBLIGATION TRUTH. The route is a thin door: ONE definer
 * read (sales_order_commitment_bundle, 0340) + the shared resolver. The
 * resolver itself is proven case-by-case in
 * packages/shared/src/sales-order-commitment.test.ts (CASES 1–7); here we
 * prove the wiring and that the answer carries lineage + cause.
 */
describe("GET /api/operation/orders/:id/commitment", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000b01";
  const SNAP = (sku: string) => ({
    header: { customer_name: "Tan Ah Kow", delivery_date: "2026-09-01", delivery_date_tbd: false },
    lines: [{ id: "00000000-0000-0000-0000-0000000000l1", sku, qty: 1, unit_price: 2499 }],
    addons: [],
  });

  it("answers current commitment + lineage from the bundle RPC alone", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        order_id: ORDER_ID,
        current: SNAP("MODEL-A"),
        revisions: [
          { revision: 1, created_at: "2026-08-01", created_by: "u1", change_type: null, note: null, snapshot: SNAP("MODEL-B") },
          { revision: 2, created_at: "2026-08-02", created_by: "u2", change_type: "staff_correction", note: null, snapshot: SNAP("MODEL-A") },
        ],
        requests: [],
      },
      error: null,
    });
    const from = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/orders/${ORDER_ID}/commitment`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("sales_order_commitment_bundle", { p_order_id: ORDER_ID });
    /* The door read NOTHING else — no PO, no units, no drawer stages. */
    expect(from).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.commitment.lines[0].sku).toBe("MODEL-A");
    expect(body.commitment.lineage[1].changeType).toBe("staff_correction");
    expect(body.commitment.lineage[1].changes.length).toBeGreaterThan(0);
  });
});

describe("GET /api/operation/orders/:id/expansion", () => {
  it("uses an explicit reserved line before the PO source and never spreads it across same-SKU lines", async () => {
    const ORDER_ID = "00000000-0000-0000-0000-000000000a01";
    const from = vi.fn((table: string) => ({ select: (columns: string) => {
      let data: unknown = [];
      if (table === "orders") data = { so: 1340 };
      if (table === "order_lines") data = [{ id: "l1", sku: "SAME", qty: 1 }, { id: "l2", sku: "SAME", qty: 1 }];
      if (table === "po_line_sources") data = [{ po_line_id: "p1", po_id: "po1", order_id: ORDER_ID, order_line_id: "l1", qty: 1 }];
      if (table === "ops_stock_items" && columns.includes("warehouse_id")) {
        expect(columns).toContain("reserved_order_line_id");
        data = [{ unit_code: "EXACT", sku: "SAME", po_line_id: "p1", reserved_order_line_id: "l2" },
          { unit_code: "UNKNOWN", sku: "SAME", po_line_id: "p1", reserved_order_line_id: "other-order-line" }];
      }
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "or"]) chain[method] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
      return chain;
    } }));
    vi.mocked(userClient).mockReturnValue({ from } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${ORDER_ID}/expansion`, { headers: { Authorization: `Bearer ${jwt}` } }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { lines: Array<{ unitIds: string[]; verifiedUnitIds: string[]; unverifiedUnitIds: string[] }> };
    expect(body.lines[0].verifiedUnitIds).toEqual([]);
    expect(body.lines[1].verifiedUnitIds).toEqual(["EXACT"]);
    expect(body.lines[0].unverifiedUnitIds).toEqual(["UNKNOWN"]);
  });

  it.each([false, true])("never launders excess or unverified IDs into an ordinary Qty 1 row (verified=%s)", async (verified) => {
    const orderId = "00000000-0000-0000-0000-000000000a01";
    const ids = Array.from({ length: 14 }, (_, i) => `U1-${i}`);
    const from = vi.fn((table: string) => ({ select: (columns: string) => {
      let data: unknown = [];
      if (table === "orders") data = { so: 1340 };
      if (table === "order_lines") data = [{ id: "l1", sku: "H1401F-K", qty: 1 }, { id: "l2", sku: "H1401F-K", qty: 1 }];
      if (table === "purchasing_destinations") data = [{ id: "default", name: "Carres Klang", is_default: true }];
      if (table === "po_line_sources" && verified) data = [{ po_line_id: "p1", po_id: "po1", order_id: orderId, order_line_id: "l1", qty: 1 }];
      if (table === "ops_stock_items" && columns.includes("warehouse_id")) data = ids.map((unit_code) => ({ unit_code, sku: "H1401F-K", po_line_id: verified ? "p1" : null, reserved_order_line_id: verified ? "l1" : null }));
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "or"]) chain[method] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
      return chain;
    } }));
    vi.mocked(userClient).mockReturnValue({ from } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${orderId}/expansion`, { headers: { Authorization: `Bearer ${jwt}` } }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { lines: Array<{ unitIds: string[]; verifiedUnitIds: string[]; unverifiedUnitIds: string[]; unitQuantityMismatch: boolean; deliverTo: unknown[] }> };
    expect(body.lines[0].verifiedUnitIds).toHaveLength(verified ? 14 : 0);
    expect(body.lines[0].unverifiedUnitIds).toHaveLength(verified ? 0 : 14);
    expect(body.lines[0].unitQuantityMismatch).toBe(verified);
    expect(body.lines[1].verifiedUnitIds).toEqual([]);
    // No PO destination exists: a current default is never a historical fact.
    expect(body.lines.every((line) => line.deliverTo.length === 0)).toBe(true);
  });

  it.each([[false, false], [true, false], [false, true]])("reads incoming IDs only from complete exclusive sources (shared=%s, truncated=%s)", async (shared, truncated) => {
    const orderId = "00000000-0000-0000-0000-000000000a01";
    const source = { po_line_id: "pol-1", order_id: orderId, order_line_id: "line-1" };
    const secondSource = { ...source, po_line_id: "pol-2" };
    const from = vi.fn((table: string) => ({
      select: vi.fn((columns: string) => {
        let data: unknown = [];
        if (table === "orders") data = { so: 1340 };
        if (table === "order_lines") data = [
          { id: "line-1", sku: "H1401F-K", qty: 1 },
          { id: "line-2", sku: "H1401F-K", qty: 1 },
        ];
        if (table === "po_line_sources") data = columns.includes("order_id") && shared
          ? [source, secondSource, ...[source, secondSource].map((s) => ({ ...s, order_id: "other-order", order_line_id: "other-line" }))] : [source, secondSource];
        if (table === "ops_stock_items" && !columns.includes("sku")) data = [
          { unit_code: "U1-000-071", po_line_id: "pol-2" },
          { unit_code: "U1-000-070", po_line_id: "pol-1" },
        ];
        if (table === "purchase_order_lines") data = [{ id: "pol-1", po_id: "PO-1" }, { id: "pol-2", po_id: "PO-2" }];
        const chain: Record<string, unknown> = {};
        for (const method of ["eq", "in", "or"]) chain[method] = vi.fn(() => chain);
        chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
        chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null,
          count: Array.isArray(data) ? data.length + (table === "po_line_sources" && columns.includes("order_id") && truncated ? 1 : 0) : null,
        });
        return chain;
      }),
    }));
    vi.mocked(userClient).mockReturnValue({ from } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${orderId}/expansion`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      lines: Array<{ unitIds: string[] }>;
      place: unknown[];
      unitCoverage: Record<string, string>;
      unitLines: Record<string, string | null>;
    };
    expect(body.lines[0].unitIds).toEqual(shared || truncated ? [] : ["U1-000-070", "U1-000-071"]);
    expect(body.unitCoverage).toEqual(shared || truncated ? {} : { "U1-000-070": "PO-1", "U1-000-071": "PO-2" });
    expect(body.lines[1].unitIds).toEqual([]);
    /**
     * ⭐ THE INVARIANT A READER IS ALLOWED TO STAND ON (owner correction
     * 2026-09-11): an incoming Unit DECLARES the item line it answers, it does
     * not leave the map and let a reader infer one from its own absence.
     *
     * The evidence is the same one `exclusive` above establishes — every
     * `po_line_sources` row on that purchase-order line names THIS order and
     * THIS item line — but it is now WRITTEN DOWN, so `unitLines` can carry
     * the whole rule: what is in it is evidenced, and what is not, is not.
     * Without this, a gap in the data proved a fact about the goods.
     */
    expect(body.unitLines).toEqual(
      shared || truncated ? {} : { "U1-000-070": "line-1", "U1-000-071": "line-1" },
    );
    // Incoming goods are not reported as physical allocated stock for Delivery.
    expect(body.place).toEqual([]);
  });

  /**
   * A purchase-order line SHARED with another Sales Order evidences nothing
   * about which SO's Unit is which, so it names no line at all — and the map
   * stays empty rather than pointing somewhere convenient. The `shared=true`
   * case above proves exactly that, and this states why it matters: a reader
   * that finds nothing in `unitLines` must read `unresolved`, never `exact`.
   */
  it("names no item line for a Unit on a SHARED purchase-order line", async () => {
    const orderId = "00000000-0000-0000-0000-000000000a01";
    const mine = { po_line_id: "pol-1", order_id: orderId, order_line_id: "line-1" };
    const theirs = { po_line_id: "pol-1", order_id: "other-order", order_line_id: "other-line" };
    const from = vi.fn((table: string) => ({
      select: vi.fn((columns: string) => {
        let data: unknown = [];
        if (table === "orders") data = { so: 1340 };
        if (table === "order_lines") data = [{ id: "line-1", sku: "H1401F-K", qty: 1 }];
        if (table === "po_line_sources") data = columns.includes("order_id") ? [mine, theirs] : [mine];
        if (table === "ops_stock_items" && !columns.includes("sku")) {
          data = [{ unit_code: "U1-000-070", po_line_id: "pol-1" }];
        }
        if (table === "purchase_order_lines") data = [{ id: "pol-1", po_id: "PO-1" }];
        const chain: Record<string, unknown> = {};
        for (const method of ["eq", "in", "or"]) chain[method] = vi.fn(() => chain);
        chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
        chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
        return chain;
      }),
    }));
    vi.mocked(userClient).mockReturnValue({ from } as never);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${orderId}/expansion`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { unitLines: Record<string, string | null>; lines: Array<{ unitIds: string[] }> };
    expect(body.unitLines).toEqual({});
    expect(body.lines[0].unitIds).toEqual([]);
  });

  it("projects Stock Unit IDs and Purchasing line destinations without a Sales Order destination field", async () => {
    const ORDER_ID = "00000000-0000-0000-0000-000000000a01";
    const rows: Record<string, unknown> = {
      orders: { so: 1303 },
      order_lines: [{ id: "line-1", sku: "B1201S-K", qty: 11 }],
      order_supplier_threads: [{ order_line_id: "line-1", po_id: "PO-2032" }],
      po_line_sources: [
        { po_id: "PO-2032", po_line_id: "pol-1", order_id: ORDER_ID, order_line_id: "line-1", qty: 10 },
        { po_id: "PO-2032", po_line_id: "pol-2", order_id: ORDER_ID, order_line_id: "line-1", qty: 1 },
      ],
      purchasing_destinations: [
        { id: "klang", name: "Carres Klang", is_default: true },
        { id: "al", name: "AL Sungai Buloh", is_default: false },
      ],
      purchase_orders: [{ id: "PO-2032", destination_id: "klang" }],
      purchase_order_lines: [
        { id: "pol-1", po_id: "PO-2032", sku: "B1201S-K", qty: 10, destination_id: null },
        { id: "pol-2", po_id: "PO-2032", sku: "B1201S-K", qty: 1, destination_id: "al" },
      ],
      ops_stock_items: [
        { unit_code: "id-001", po_line_id: "pol-1", sku: "B1201S-K", warehouse_id: "wh-klang", holder_party_id: null },
        { unit_code: "id-002", po_line_id: "pol-1", sku: "B1201S-K", warehouse_id: "wh-klang", holder_party_id: "party-nets" },
      ],
      /* DELIVERY CARD 02 — Where and Who has it come from Stock's own two
         lookup tables, never from a name copied onto the Unit. */
      warehouses: [{ id: "wh-klang", name: "Carres Klang Warehouse" }],
      stock_operating_parties: [{ id: "party-nets", name: "NETS Warehouse" }],
    };
    const from = vi.fn((table: string) => {
      const data = rows[table];
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "or"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
      return { select: vi.fn((columns: string) => table === "ops_stock_items" && !columns.includes("warehouse_id")
        ? { in: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) } : chain) };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ from } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${ORDER_ID}/expansion`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      defaultDeliverTo: "Carres Klang",
      unitCoverage: { "id-001": "PO-2032", "id-002": "PO-2032" },
      /* 0471 — the stored binding, carried verbatim. Neither Unit here has
         one, and `null` is the honest answer for that: the Unit is on this
         Sales Order and WHICH item line it answers was never recorded. */
      unitLines: { "id-001": null, "id-002": null },
      /* 0453 — a counted row has no identity, so the scope rides the wire and
         no reader has to guess a `QTY-` key from its shape. */
      unitScopes: { "id-001": "unit", "id-002": "unit" },
      /* WHERE each Unit is and WHO has it — the SAME Units the lines already
         name, resolved to Stock's own names. Delivery Work reads this block;
         the Sales Orders register ignores it. */
      place: [
        { unitCode: "id-001", siteName: "Carres Klang Warehouse", holderName: null },
        { unitCode: "id-002", siteName: "Carres Klang Warehouse", holderName: "NETS Warehouse" },
      ],
      lines: [{
        lineId: "line-1",
        sku: "B1201S-K",
        unitIds: ["id-001", "id-002"],
        verifiedUnitIds: [],
        unverifiedUnitIds: ["id-001", "id-002"],
        unitQuantityMismatch: false,
        deliverTo: [
          { name: "Carres Klang", qty: 10 },
          { name: "AL Sungai Buloh", qty: 1 },
        ],
      }],
    });
  });
});

/**
 * ⭐ THE STORED BINDING, NOT A SKU MATCH — 0471 applied to this read
 * 2026-09-11.
 *
 * This fan-in grouped every reserved/sold Unit of the order by NORMALIZED SKU,
 * so a Sales Order with two item lines of one SKU — SO-1251, SO-1207 and
 * SO-1246 carry exactly that today — printed the SAME Unit IDs under BOTH
 * lines. `ops_stock_items.reserved_order_line_id` has answered that question
 * since 0471 and the read simply did not ask it: a row position was answering
 * something the database already knew.
 */
describe("GET /api/operation/orders/:id/expansion — the Unit's own item line", () => {
  const ORDER_ID = "00000000-0000-0000-0000-000000000a01";

  const call = async (units: Array<Record<string, unknown>>) => {
    const rows: Record<string, unknown> = {
      orders: { so: 1251 },
      order_lines: [
        { id: "line-1", sku: "JAGER-SS", qty: 1 },
        { id: "line-2", sku: "JAGER-SS", qty: 1 },
      ],
      order_supplier_threads: [],
      purchasing_destinations: [{ id: "klang", name: "Carres Klang", is_default: true }],
      purchase_orders: [],
      purchase_order_lines: [],
      po_line_sources: [],
      ops_stock_items: units,
      warehouses: [],
      stock_operating_parties: [],
    };
    const from = vi.fn((table: string) => {
      const data = rows[table];
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "or", "not"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
      return { select: vi.fn(() => chain) };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ from } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(new Request(`http://t/api/operation/orders/${ORDER_ID}/expansion`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      lines: Array<{ lineId: string; unitIds: string[] }>;
      unitLines: Record<string, string | null>;
    };
  };

  it("puts a bound Unit under its OWN line and nowhere else", async () => {
    const body = await call([
      { unit_code: "U1-000-001", sku: "JAGER-SS", reserved_order_line_id: "line-1" },
      { unit_code: "U1-000-002", sku: "JAGER-SS", reserved_order_line_id: "line-2" },
    ]);
    expect(body.lines[0]!.unitIds).toEqual(["U1-000-001"]);
    expect(body.lines[1]!.unitIds).toEqual(["U1-000-002"]);
    expect(body.unitLines).toEqual({
      "U1-000-001": "line-1",
      "U1-000-002": "line-2",
    });
  });

  /* A pre-0471 reservation carries no binding. It is NOT dropped — evidence is
     never thrown away to tidy a read — it keeps the SKU reading it always had,
     and `unitLines` reports `null` so a screen can say the association was
     never recorded instead of printing an inference as a fact. */
  it("keeps the SKU reading for an unbound Unit, and reports that it is unbound", async () => {
    const body = await call([
      { unit_code: "U1-000-003", sku: "JAGER-SS", reserved_order_line_id: null },
    ]);
    expect(body.lines[0]!.unitIds).toEqual(["U1-000-003"]);
    expect(body.lines[1]!.unitIds).toEqual(["U1-000-003"]);
    expect(body.unitLines).toEqual({ "U1-000-003": null });
  });
});

/**
 * 3.2 · the consequence-floor endpoint is a THIN read-only door: one RPC,
 * no writes, findings passed through verbatim.
 */
describe("POST /api/operation/orders/:id/floors", () => {
  it("calls sales_order_floors and writes nothing", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { order_id: "x", so: 1308, findings: [] },
      error: null,
    });
    const from = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request("http://t/api/operation/orders/00000000-0000-0000-0000-000000000c01/floors", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["order_lines"], proposedLines: [{ sku: "A", qty: 0 }] }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("sales_order_floors", {
      p_order_id: "00000000-0000-0000-0000-000000000c01",
      p_changed: ["order_lines"],
      p_proposed_lines: [{ sku: "A", qty: 0 }],
    });
    expect(from).not.toHaveBeenCalled();
  });
});
