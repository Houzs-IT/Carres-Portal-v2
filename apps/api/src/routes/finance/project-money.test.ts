import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../types";
vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { userClient } from "../../lib/supabase";
import router from "./project-money";

/** 0754 — a project's money from the books, Houzs way (YH 3 Nov 2026, "all follow houzs"). */
const project = {
  id: "p1", code: "2026-12-SOLO-KL-MITEC-CARRES", name: "KL [Carres] SOLO @ MITEC", brand: "Carres", status: "pending",
  start_date: "2026-12-04", end_date: "2026-12-06", archived: false, total_sales: 10000,
  lines: [{ id: "t1", kind: "cost", category: "rental", description: "Booth", amount: 5000, occurredAt: null }],
  rate: { brand: "Carres", transport_pct: 3, merchandise_pct: 1, commission_normal_pct: 5, commission_boost_pct: null, boost_min_gp_pct: null, boost_min_sales: null },
};
const leg = { project_id: "p1", leg_id: "l1", account_code: "900-R001", account_name: "Booth rental", account_kind: "EXPENSE", project_row: "rental",
  debit: 4800, credit: 0, memo: "Booth", doc_no: "PV-1", entry_date: "2026-12-01", checked: false };

const rpcs: Record<string, { data: unknown; error: unknown }> = {};
const calls: Array<{ fn: string; args: unknown }> = [];
function from() {
  const q: Record<string, unknown> = {};
  for (const op of ["select", "eq", "order"]) q[op] = () => q;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return q;
}
function app(role = "finance") {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => { c.set("auth", { role, jwt: "t", id: "u1" } as never); await next(); });
  a.route("/projects", router);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(rpcs)) delete rpcs[k];
  calls.length = 0;
  const rpc = async (fn: string, args: unknown) => { calls.push({ fn, args }); return rpcs[fn] ?? { data: null, error: null }; };
  vi.mocked(userClient).mockReturnValue({ from, rpc } as never);
});

describe("/api/finance/projects", () => {
  it("refuses Operation: only Finance sees a project's money", async () => {
    expect((await app("operation").request("/projects/p1")).status).toBe(403);
  });

  it("the books replace the typed rental, and the rate card fills the % rows", async () => {
    rpcs.project_money = { data: [project], error: null };
    rpcs.project_books = { data: [leg], error: null };
    const body = await (await app().request("/projects/p1")).json() as {
      pnl: { bySales: { rental: number; sales: number; transportFee: { amount: number; from: string } } };
      replaced: Array<{ id: string }>; booksRows: string[];
    };
    expect(body.booksRows).toEqual(["rental"]);
    expect(body.replaced.map((l) => l.id)).toEqual(["t1"]);
    expect(body.pnl.bySales).toMatchObject({ sales: 10000, rental: 4800, transportFee: { amount: 300, from: "rate" } });
  });

  it("passes the account flags to the database", async () => {
    const res = await app().request("/projects/accounts/900-R001", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ needsProject: true, projectRow: "rental" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toContainEqual({ fn: "gl_account_project_set", args: { p_code: "900-R001", p_needs_project: true, p_project_row: "rental" } });
  });
});
