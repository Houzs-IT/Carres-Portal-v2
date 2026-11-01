import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./customer-consignment";

const STAFF = "11111111-1111-4111-8111-111111111111";
const LEFT = "22222222-2222-4222-8222-222222222222";
const base = { created_at: "2026-10-20T00:00:00Z" };
const TABLES: Record<string, unknown[]> = {
  customer_consignment_orders: [{ ...base, id: "o1", created_by: STAFF, customer_consignment_order_units: [{ price: 100 }], customer_consignment_order_payments: [{ amount: 40 }] }],
  consignment_notes: [{ ...base, id: "n1", created_by: LEFT, consignment_note_units: [], consignment_note_payments: [] }],
  customer_consignment_returns: [{ ...base, id: "r1", created_by: null }],
  salespersons: [],
};
const selects: string[] = [];

vi.mock("../../lib/supabase", () => ({
  userClient: () => ({
    rpc: async () => ({ data: [{ id: STAFF, name: "Aina" }], error: null }),
    from: (table: string) => {
      const q = {
        select: (cols: string) => { selects.push(cols); return q; },
        order: () => q,
        limit: () => q,
        in: () => q,
        then: (done: (r: unknown) => unknown) => done({ data: TABLES[table], error: null }),
      };
      return q;
    },
  }),
}));

const app = new Hono<any>();
app.use("*", async (c, next) => { c.set("auth", { role: "operation", jwt: "t" }); await next(); });
app.route("/", router);

const get = async (path: string) => (await app.request(path, {}, {})).json() as Promise<any>;

describe("who on Consignment History", () => {
  beforeEach(() => { selects.length = 0; });

  it("returns the staff name on an order, keeps its money, and never the uuid", async () => {
    const res = await app.request("/orders", {}, {});
    const text = await res.clone().text();
    const { orders } = await res.json() as any;
    expect(orders[0]).toMatchObject({ performed_by: "Aina", total: 100, paid: 40, balance: 60 });
    expect(orders[0]).not.toHaveProperty("created_by");
    expect(text).not.toContain(STAFF);
    expect(selects[0]).toContain("created_by");
  });

  it("returns null for a name it cannot find on a Note", async () => {
    const { notes } = await get("/notes");
    expect(notes[0].performed_by).toBeNull();
    expect(notes[0]).not.toHaveProperty("created_by");
  });

  it("returns null when a Return has no creator", async () => {
    const { returns } = await get("/returns");
    expect(returns[0].performed_by).toBeNull();
    expect(returns[0]).not.toHaveProperty("created_by");
  });
});
