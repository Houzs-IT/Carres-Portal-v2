import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const db = vi.hoisted(() => ({ bill: null as unknown, admin: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  userClient: () => ({
    rpc: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.bill, error: null }) }) }),
  }),
  adminClient: db.admin,
}));

import router, { billDetailLines } from "./purchase-invoices";

const ID = "11111111-1111-4111-8111-111111111111";
const appAs = (role: string) => {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("auth", { role, jwt: "t", id: "u" });
    await next();
  });
  app.route("/", router as unknown as Hono);
  app.onError((e, c) => c.json({ message: e.message }, (e as { status?: number }).status as 403 ?? 500));
  return app;
};

describe("billDetailLines", () => {
  const line = (n: number, over = {}) => ({ line_no: n, warehouse_receipt_id: "g", po_line_id: "p", sku: "S", description: "S",
    qty: 1, unit_price: 10.1, amount: 10.1, ...over });

  it("reads a goods line split by channel as the one line typed", () => {
    const out = billDetailLines([line(2), line(1)], new Map([["g", "GRN-1"]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ line_no: 1, qty: 2, amount: 20.2, grn_no: "GRN-1" });
  });

  it("keeps a different price, and every line with no GRN, on its own", () => {
    expect(billDetailLines([line(1), line(2, { unit_price: 9 })], new Map())).toHaveLength(2);
    const free = { warehouse_receipt_id: null, po_line_id: null };
    expect(billDetailLines([line(1, free), line(2, free)], new Map())).toHaveLength(2);
  });
});

describe("GET /:id/detail", () => {
  it("refuses a role the list refuses, before any read", async () => {
    db.admin.mockClear();
    const res = await appAs("bd").request(`/${ID}/detail`);
    expect(res.status).toBe(403);
    expect(db.admin).not.toHaveBeenCalled();
  });

  it("never opens the service client when the list does not give the caller this bill", async () => {
    db.admin.mockClear();
    db.bill = null;
    const res = await appAs("operation").request(`/${ID}/detail`);
    expect(res.status).toBe(404);
    expect(db.admin).not.toHaveBeenCalled();
  });

  it("sends only the line fields it names", async () => {
    db.bill = { id: ID, total_amount: 20 };
    const select = vi.fn(() => ({ eq: async () => ({ data: [], error: null }) }));
    db.admin.mockReturnValue({ from: () => ({ select }) });
    const res = await appAs("operation").request(`/${ID}/detail`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bill: db.bill, lines: [] });
    const columns = (select.mock.calls[0] as unknown as [string])[0];
    expect(columns).not.toMatch(/account_code|department/);
  });

  it("sends line prices to principal but not to operation", async () => {
    db.bill = { id: ID, total_amount: 20 };
    const row = { line_no: 1, warehouse_receipt_id: null, po_line_id: null, sku: "S", description: "S", qty: 2, unit_price: 10, amount: 20 };
    db.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: async () => ({ data: [row], error: null }) }) }) });
    const op = await (await appAs("operation").request(`/${ID}/detail`)).json() as { lines: typeof row[] };
    expect(op.lines[0]).toMatchObject({ qty: 2, unit_price: null, amount: null });
    const boss = await (await appAs("principal").request(`/${ID}/detail`)).json() as { lines: typeof row[] };
    expect(boss.lines[0]).toMatchObject({ unit_price: 10, amount: 20 });
  });
});
