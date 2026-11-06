import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../types";
vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { userClient } from "../../lib/supabase";
vi.mock("../../lib/today", async (orig) => ({ ...(await orig<typeof import("../../lib/today")>()), todayIsoMYT: vi.fn(() => "2026-11-05") }));
import { todayIsoMYT } from "../../lib/today";
import router from "./projects";

/** 0750 — Projects, Houzs way (Weisiang's decision 2026-10-22). */
const row = {
  id: "p1", code: "2026-12-SOLO-JOHOR-PARADIGM-MALL-CARRES", name: "JOHOR [Carres] SOLO @ Paradigm Mall", stage: "draft", status: "pending",
  event_type: "solo", brand: "Carres", state: "Johor", venue: "Paradigm Mall", venue_address: null, organizer: null, contractor: null,
  booth_no: null, size_sqm: null, start_date: "2026-12-04", end_date: "2026-12-06", pic_id: null, notes: null, archived_at: null,
  created_at: "2026-11-02T00:00:00Z", pic: null,
};

/** A chainable query stub: every filter returns itself; awaiting it, or calling
 *  single/maybeSingle, answers the next queued result for that table. */
const results: Record<string, Array<{ data: unknown; error: unknown }>> = {};
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
function from(table: string) {
  const next = () => (results[table] ?? []).shift() ?? { data: null, error: null };
  const q: Record<string, unknown> = {};
  for (const op of ["select", "insert", "update", "delete", "eq", "is", "not", "in", "gte", "lte", "or", "like", "order", "limit", "range"]) {
    q[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
  }
  q.single = async () => next();
  q.maybeSingle = async () => next();
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(next()).then(res);
  return q;
}
function app(role = "operation") {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => { c.set("auth", { role, jwt: "t", id: "u1" } as never); await next(); });
  a.route("/projects", router);
  return a;
}
const post = (path: string, body: unknown, method = "POST") =>
  app().request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
  const rpc = async (fn: string, args: unknown) => { calls.push({ table: "rpc", op: fn, args: [args] }); return { data: null, error: null }; };
  vi.mocked(userClient).mockReturnValue({ from, rpc } as never);
});

describe("/api/operation/projects", () => {
  it("refuses a caller outside Operation", async () => {
    expect((await app("finance").request("/projects")).status).toBe(403);
  });

  it("lists live projects with the overlap date filter", async () => {
    results.projects = [{ data: [row], error: null }];
    const res = await app().request("/projects?from=2026-12-01&to=2026-12-31&status=pending,bogus");
    expect(await res.json()).toMatchObject({ projects: [{ id: "p1", eventType: "solo", startDate: "2026-12-04" }] });
    expect(calls).toEqual(expect.arrayContaining([
      { table: "projects", op: "is", args: ["archived_at", null] },
      { table: "projects", op: "in", args: ["status", ["pending"]] },
      { table: "projects", op: "gte", args: ["end_date", "2026-12-01"] },
      { table: "projects", op: "lte", args: ["start_date", "2026-12-31"] },
    ]));
  });

  it("gives each listed project its checklist progress and overdue count", async () => {
    vi.mocked(todayIsoMYT).mockReturnValue("2026-11-05");
    results.projects = [{ data: [row], error: null }];
    // start 2026-12-04: -40 is due 25 Oct (overdue), -10 due 24 Nov (not yet).
    results.project_checklist = [{ data: [
      { id: "k1", project_id: "p1", status: "pending", due_offset_days: -40 },
      { id: "k2", project_id: "p1", status: "pending", due_offset_days: -10 },
      { id: "k3", project_id: "p1", status: "done", due_offset_days: -40 },
      { id: "k4", project_id: "other", status: "pending", due_offset_days: -40 },
    ], error: null }];
    const res = await app().request("/projects");
    expect(await res.json()).toMatchObject({ projects: [{ id: "p1", checklist: { total: 3, percent: 33, overdue: 1 } }] });
    expect(calls).toEqual(expect.arrayContaining([{ table: "project_checklist", op: "in", args: ["project_id", ["p1"]] }]));
  });

  it("mints the next free code and the derived name on create", async () => {
    results.projects = [{ data: [{ code: "2026-12-SOLO-JOHOR-PARADIGM-MALL-CARRES" }], error: null }, { data: row, error: null }];
    const res = await post("/projects", { eventType: "solo", brand: "Carres", state: "Johor", venue: "Paradigm Mall", startDate: "2026-12-04", endDate: "2026-12-06" });
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.op === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ code: "2026-12-SOLO-JOHOR-PARADIGM-MALL-CARRES-2", name: "JOHOR [Carres] SOLO @ Paradigm Mall" });
  });

  it("refuses a status change on an archived project", async () => {
    results.projects = [{ data: { archived_at: "2026-11-01T00:00:00Z" }, error: null }];
    const res = await post("/projects/p1", { status: "confirmed" }, "PATCH");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "archived" });
  });

  it("saves a stage change and answers 404 for a project it cannot see", async () => {
    results.projects = [{ data: { ...row, stage: "setup" }, error: null }];
    expect(await (await post("/projects/p1", { stage: "setup" }, "PATCH")).json()).toMatchObject({ project: { stage: "setup" } });
    results.projects = [{ data: null, error: null }];
    expect((await post("/projects/p9", { stage: "setup" }, "PATCH")).status).toBe(404);
  });

  it("reads the masters, not a project called masters (0751)", async () => {
    results.project_masters = [{ data: [{ id: "m1", kind: "venue", name: "MITEC", state: "Kuala Lumpur", address: null, notes: null, active: true }], error: null }];
    const res = await app().request("/projects/masters");
    expect(await res.json()).toEqual({ masters: [{ id: "m1", kind: "venue", name: "MITEC", state: "Kuala Lumpur", address: null, notes: null, active: true }] });
    expect(calls.some((c) => c.table === "projects")).toBe(false);
  });

  it("refuses a master of an unknown kind and adds a team member", async () => {
    expect((await post("/projects/masters", { kind: "colour", name: "Red" })).status).toBe(422);
    const res = await post("/projects/p1/team", { userId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", role: "onsite" });
    expect(res.status).toBe(201);
    expect(calls.find((c) => c.op === "insert")!.args[0]).toEqual({ project_id: "p1", user_id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", role: "onsite" });
  });

  it("reads the templates, not a project called checklist-templates (0752)", async () => {
    results.project_checklist_templates = [{ data: [{ id: "t1", name: "Solo", event_type: "solo", active: true, items: [{ id: "i2", section: null, seq: 2, title: "B", due_offset_days: 1 }, { id: "i1", section: null, seq: 1, title: "A", due_offset_days: -7 }] }], error: null }];
    const res = await app().request("/projects/checklist-templates");
    expect(await res.json()).toMatchObject({ templates: [{ id: "t1", eventType: "solo", items: [{ id: "i1" }, { id: "i2" }] }] });
    expect(calls.some((c) => c.table === "projects")).toBe(false);
  });

  it("copies the event type's default template onto a new project (0752)", async () => {
    results.projects = [{ data: [], error: null }, { data: row, error: null }];
    results.project_checklist_templates = [{ data: { id: "t1" }, error: null }];
    results.project_checklist_template_items = [{ data: [{ section: "Before", seq: 1, title: "Book the lorry", due_offset_days: -7 }], error: null }];
    const res = await post("/projects", { eventType: "solo", brand: "Carres", state: "Johor", venue: "Paradigm Mall", startDate: "2026-12-04", endDate: "2026-12-06" });
    expect(res.status).toBe(201);
    const copy = calls.find((c) => c.table === "project_checklist" && c.op === "insert")!.args[0];
    expect(copy).toEqual([{ project_id: "p1", section: "Before", seq: 1, title: "Book the lorry", due_offset_days: -7 }]);
  });

  it("stamps who finished a task, and clears it when reopened (0752)", async () => {
    results.project_checklist = [{ data: { id: "k1" }, error: null }, { data: { id: "k1" }, error: null }];
    expect((await post("/projects/checklist/k1/status", { status: "na" })).status).toBe(200);
    expect(calls.find((c) => c.op === "update")!.args[0]).toMatchObject({ status: "na", completed_by: "u1" });
    calls.length = 0;
    await post("/projects/checklist/k1/status", { status: "pending" });
    expect(calls.find((c) => c.op === "update")!.args[0]).toMatchObject({ status: "pending", completed_by: null, completed_at: null });
    expect((await post("/projects/checklist/k1/status", { status: "late" })).status).toBe(422);
  });

  it("prices linked orders with orderMoney and leaves cancelled ones out of the totals (0753)", async () => {
    results.orders = [{ data: [
      { id: "o1", so: "SO-1", status: "confirmed", customer_name: "A", placed_at: null, paid: 300, credited: 0, order_lines: [{ qty: 2, unit_price: 500 }], order_addons: [], ops_order_control: null },
      { id: "o2", so: "SO-2", status: "cancelled", customer_name: "B", placed_at: null, paid: 0, credited: 0, order_lines: [{ qty: 1, unit_price: 900 }], order_addons: [], ops_order_control: null },
    ], error: null }];
    const res = await app().request("/projects/p1/sales-orders");
    expect(await res.json()).toMatchObject({
      orders: [{ id: "o1", total: 1000, paid: 300, balance: 700 }, { id: "o2", total: 900 }],
      totals: { count: 1, total: 1000, paid: 300, balance: 700 },
    });
  });

  it("refuses an order on another project, and unlinks only from this one (0753)", async () => {
    results.orders = [{ data: { id: "o1", project_id: "p2" }, error: null }];
    expect(await (await post("/projects/p1/sales-orders", { so: "SO-1" })).json()).toMatchObject({ code: "other_project" });
    results.orders = [{ data: null, error: null }];
    expect((await post("/projects/p1/sales-orders/o1", undefined, "DELETE")).status).toBe(404);
    expect(calls.some((c) => c.table === "rpc")).toBe(false);
    results.orders = [{ data: { id: "o1", project_id: null }, error: null }];
    expect((await post("/projects/p1/sales-orders", { so: "SO-1" })).status).toBe(201);
    expect(calls.find((c) => c.table === "rpc")).toEqual({ table: "rpc", op: "project_link_order", args: [{ p_order: "o1", p_project: "p1" }] });
  });

  const PID = "11111111-2222-4333-8444-555555555555";
  it("adds a stock transfer with today left to the database, and refuses a file from another project (0757)", async () => {
    results.project_stock_transfers = [{ data: { id: "x1" }, error: null }];
    const res = await post(`/projects/${PID}/stock-transfers`, { direction: "out", notes: "Sofa set" });
    expect(res.status).toBe(201);
    expect(calls.find((c) => c.op === "insert")!.args[0]).toEqual({
      project_id: PID, direction: "out", record_path: null, file_name: null, mime_type: null, notes: "Sofa set",
    });
    const other = "99999999-2222-4333-8444-555555555555";
    expect((await post(`/projects/${PID}/stock-transfers`, { direction: "return", recordPath: `${other}/${other}.pdf`, mimeType: "application/pdf" })).status).toBe(422);
    expect((await post(`/projects/${PID}/stock-transfers`, { direction: "sideways" })).status).toBe(422);
  });

  it("confirms, unconfirms and archives only a live transfer (0757)", async () => {
    results.project_stock_transfers = [{ data: { id: "x1" }, error: null }, { data: { id: "x1" }, error: null }, { data: null, error: null }];
    expect((await post("/projects/stock-transfers/x1/confirm", {})).status).toBe(200);
    expect(calls.find((c) => c.op === "update")!.args[0]).toMatchObject({ confirmed_at: expect.any(String) });
    calls.length = 0;
    expect((await post("/projects/stock-transfers/x1/unconfirm", {})).status).toBe(200);
    expect(calls.find((c) => c.op === "update")!.args[0]).toEqual({ confirmed_at: null });
    expect(calls).toContainEqual({ table: "project_stock_transfers", op: "is", args: ["archived_at", null] });
    expect((await post("/projects/stock-transfers/x9", undefined, "DELETE")).status).toBe(404);
    expect(calls.some((c) => c.table === "projects")).toBe(false);
  });

  it("lists a project's live transfers on its detail read (0757)", async () => {
    results.projects = [{ data: row, error: null }];
    results.project_stock_transfers = [{ data: [{ id: "x1", direction: "out", transferred_at: "2026-12-02", record_path: null, file_name: null, notes: null, confirmed_at: null, created_at: "2026-11-03T00:00:00Z", by: { name: "Ali" }, checker: null }], error: null }];
    const res = await app().request("/projects/p1");
    expect(await res.json()).toMatchObject({ stockTransfers: [{ id: "x1", direction: "out", transferredAt: "2026-12-02", createdByName: "Ali", confirmedByName: null }] });
  });

  it("names the record key itself and refuses a bad file path (0757)", async () => {
    expect((await post(`/projects/${PID}/stock-transfers/sign`, { mimeType: "text/plain", sizeBytes: 10 })).status).toBe(422);
    expect((await app().request("/projects/stock-transfers/file?path=../x.pdf")).status).toBe(422);
  });
});
