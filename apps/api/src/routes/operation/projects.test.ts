import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../types";
vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { userClient } from "../../lib/supabase";
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
  for (const op of ["select", "insert", "update", "delete", "eq", "is", "not", "in", "gte", "lte", "or", "like", "order", "limit"]) {
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
  vi.mocked(userClient).mockReturnValue({ from } as never);
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
});
