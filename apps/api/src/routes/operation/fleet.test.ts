import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../types";
vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { userClient } from "../../lib/supabase";
import router, { stopFacts } from "./fleet";

/** 0724 — Carres' own lorries (Weisiang's decision 2026-10-22). The router is
 *  thin: the SQL door decides; its refusal tag reaches the page as `code`. */
const rpc = vi.fn();
function app(role = "operation") {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => { c.set("auth", { role, jwt: "t", id: "u" } as never); await next(); });
  a.route("/fleet", router);
  return a;
}
const company = { data: null as unknown, error: null };
beforeEach(() => {
  vi.clearAllMocks();
  company.data = null;
  vi.mocked(userClient).mockReturnValue({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => company }) }) }),
  } as never);
});

describe("/api/operation/fleet", () => {
  it("refuses a non-operation caller and a bad range", async () => {
    expect((await app("finance").request("/fleet?from=2026-11-02")).status).toBe(403);
    expect((await app().request("/fleet?from=2026-11-05&to=2026-11-01")).status).toBe(422);
  });

  it("answers an empty fleet before Carres Lorries exists", async () => {
    const res = await app().request("/fleet?from=2026-11-02");
    expect(await res.json()).toMatchObject({ company: null, lorries: [], stops: [] });
  });

  it("forwards the crew door's refusal tag", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "crew member on leave", details: "on_leave" } });
    const res = await app().request("/fleet/crew", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-11-02", vehicleId: "11111111-1111-4111-8111-111111111111", driverId: "22222222-2222-4222-8222-222222222222", helperId: null }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "on_leave" });
    expect(rpc).toHaveBeenCalledWith("fleet_confirm_crew", expect.objectContaining({ p_day: "2026-11-02", p_helper_id: null }));
  });
});

describe("stopFacts — the Last Mile board's DO and result per stop (Houzs #5094)", () => {
  /** A client whose `from(table)` chain answers `rows[table]` whatever the filters. */
  const fake = (rows: Record<string, unknown[]>) => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok) };
      for (const m of ["select", "in", "is", "gte"]) chain[m] = () => chain;
      return chain;
    },
  }) as never;

  it("takes the newest live DO and the newest attempt per order and leg; no attempt reads Scheduled", async () => {
    const facts = await stopFacts(fake({
      ops_delivery_orders: [
        { order_id: "o1", leg: 0, do_number: "DO-1", issued_at: "2026-10-30T01:00:00Z" },
        { order_id: "o1", leg: 0, do_number: "DO-2", issued_at: "2026-11-01T01:00:00Z" },
      ],
      delivery_attempts: [
        { order_id: "o1", leg: 0, result: "failed", recorded_at: "2026-11-02T03:00:00Z" },
        { order_id: "o1", leg: 0, result: "delivered", recorded_at: "2026-11-02T06:00:00Z" },
      ],
    }), [{ order_id: "o1", leg: 0 }, { order_id: "o2", leg: 1 }], "2026-11-02");
    expect(facts instanceof Map && [...facts.entries()]).toEqual([
      ["o1|0", { doNumber: "DO-2", status: "delivered" }],
      ["o2|1", { doNumber: null, status: "scheduled" }],
    ]);
  });

  it("reads nothing for a day with no stops", async () => {
    expect(await stopFacts(fake({}), [], "2026-11-02")).toEqual(new Map());
  });
});
