import { describe, it, expect } from "vitest";
import { dueBuckets, monthsOf, notClosed, openOrders, periodFigures, weeksOf } from "./logistic-overview";
import type { DoRegisterRow } from "./delivery-orders-register";
import type { PlanRow } from "./delivery-planning";

const plan = (over: Partial<PlanRow>): PlanRow =>
  ({ key: "k", orderId: "o1", leg: 0, day: null, requested: null, scheduled: false, amount: 100, ...over }) as PlanRow;
const doc = (kind: string, issuedAt: string, over: Partial<DoRegisterRow> = {}): DoRegisterRow =>
  ({ orderId: "o1", issuedAt, amount: 100, status: { kind }, ...over }) as unknown as DoRegisterRow;

describe("logistic overview", () => {
  it("counts an order once, on its last leg, and drops one already delivered", () => {
    const rows = [
      plan({ leg: 0 }),
      plan({ leg: 2, day: "2026-11-03" }),
      plan({ orderId: "o2" }),
    ];
    const open = openOrders(rows, [doc("delivered", "2026-11-01", { orderId: "o2" })]);
    expect(open.map((r) => [r.orderId, r.leg])).toEqual([["o1", 2]]);
  });

  it("keeps an order open while only a warehouse leg has arrived", () => {
    const open = openOrders([plan({})], [doc("delivered", "2026-11-01", { intermediateLeg: true })]);
    expect(open).toHaveLength(1);
  });

  it("sorts open orders into the due buckets at their edges", () => {
    const today = "2026-11-10";
    const rows = [
      plan({ orderId: "a", day: "2026-11-09" }),
      plan({ orderId: "b", day: "2026-11-13", scheduled: true }),
      plan({ orderId: "c", requested: "2026-11-14" }),
      plan({ orderId: "d" }),
    ];
    const b = Object.fromEntries(dueBuckets(rows, today).map((x) => [x.key, x]));
    expect(b.overdue!.rows.map((r) => r.orderId)).toEqual(["a"]);
    expect(b.d3!.rows.map((r) => r.orderId)).toEqual(["b"]);
    expect(b.d3!.agreed).toBe(1);
    expect(b.d7!.rows.map((r) => r.orderId)).toEqual(["c"]);
    expect(b.none!.amount).toBe(100);
  });

  it("leaves cancelled documents out of the period and the months", () => {
    const dos = [doc("delivered", "2026-11-02T01:00:00Z"), doc("cancelled", "2026-11-02T01:00:00Z"), doc("created", "2026-10-02T01:00:00Z")];
    const p = periodFigures(dos, "2026-11-01", "2026-11-30");
    expect([p.issued, p.amount, p.delivered]).toEqual([1, 100, 1]);
    expect(monthsOf(dos).map((m) => [m.month, m.issued])).toEqual([["2026-11", 1], ["2026-10", 1]]);
  });

  it("gives a month its weeks of the month, with a short February W5 left out", () => {
    const feb = weeksOf([], "2027-02-01", "2027-02-28", "2027-02-10");
    expect(feb.map((w) => w.label)).toEqual(["W1", "W2", "W3", "W4"]);
    expect(feb[1]!.current).toBe(true);
    const span = weeksOf([], "2026-11-01", "2026-12-31", "2026-11-01");
    expect(span[0]!.label).toBe("2026-11 · W1");
    expect(span.at(-1)!.to).toBe("2026-12-31");
  });

  it("flags a document out over 7 days as not closed", () => {
    const dos = [doc("out_for_delivery", "2026-11-01T00:00:00Z"), doc("out_for_delivery", "2026-11-05T00:00:00Z")];
    expect(notClosed(dos, "2026-11-10")).toHaveLength(1);
  });
});
