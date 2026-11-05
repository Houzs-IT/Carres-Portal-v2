import { describe, expect, it } from "vitest";
import { fleetPositionInput, groupRuns, lorryCapacity, lorryCards, proposeCrew, runStatusOf, stopMatches, workingDays, type FleetCrew, type FleetLorry, type FleetStop } from "./fleet";

// Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): Houzs Fleet Day / Lorry Capacity.
const lorry = (id: string, plate: string): FleetLorry => ({ id, plate, vehicleType: "Lorry", capacity: null, active: true });
const person = (id: string, name: string, role: "driver" | "helper", active = true): FleetCrew => ({ id, name, phone: null, role, active });
const stop = (day: string, vehicleId: string | null, so: number, revenue: number, eta: string | null = null): FleetStop => ({
  day, vehicleId, plate: vehicleId ? `P-${vehicleId}` : "typed", orderId: `o${so}`, leg: 0, so, customerName: "C",
  customerPhone: null, customerAddress: null, confirmedTime: null, expectedArrival: eta, revenue,
});

describe("proposeCrew", () => {
  const lorries = [lorry("L1", "AAA 1"), lorry("L2", "BBB 2")];
  const crew = [person("d1", "Ali", "driver"), person("d2", "Bala", "driver"), person("d3", "Zul", "driver", false),
    person("h1", "Chong", "helper"), person("h2", "Dev", "helper")];

  it("brings back each lorry's last crew, skips leave, and never reuses a person", () => {
    const picks = proposeCrew({
      day: "2026-11-03", lorries, crew,
      leave: [{ id: "x", crewId: "h2", fromDate: "2026-11-01", toDate: "2026-11-05", reason: "MC" }],
      confirmed: [],
      history: [
        { day: "2026-11-02", vehicleId: "L2", driverId: "d1", helperId: "h2" },
        { day: "2026-11-01", vehicleId: "L1", driverId: "d1", helperId: "h1" },
      ],
    });
    // L1's last driver Ali is free first; L2's last driver Ali is then taken → Bala.
    expect(picks.get("L1")).toEqual({ driverId: "d1", helperId: "h1", confirmed: false });
    // Dev is on leave and Chong is on L1, so L2 has no helper.
    expect(picks.get("L2")).toEqual({ driverId: "d2", helperId: null, confirmed: false });
  });

  it("keeps a confirmed lorry and does not give its crew to another", () => {
    const picks = proposeCrew({
      day: "2026-11-03", lorries, crew, leave: [], history: [],
      confirmed: [{ day: "2026-11-03", vehicleId: "L2", driverId: "d1", helperId: "h1" }],
    });
    expect(picks.get("L2")).toEqual({ driverId: "d1", helperId: "h1", confirmed: true });
    expect(picks.get("L1")).toEqual({ driverId: "d2", helperId: "h2", confirmed: false });
  });

  it("uses the lorry's Settings template driver when there is no history", () => {
    const picks = proposeCrew({
      day: "2026-11-03", lorries: [lorry("L1", "AAA 1")], crew, leave: [], history: [], confirmed: [],
      templateDriverName: new Map([["L1", " bala "]]),
    });
    expect(picks.get("L1")?.driverId).toBe("d2");
  });
});

describe("groupRuns and lorryCapacity", () => {
  it("groups one run per lorry per day in arrival order, and counts Houzs utilisation", () => {
    const stops = [
      stop("2026-11-02", "L1", 12, 300, "14:00"), stop("2026-11-02", "L1", 11, 200, "10:00"),
      stop("2026-11-03", "L1", 13, 500), stop("2026-11-02", null, 14, 100),
    ];
    const runs = groupRuns(stops);
    expect(runs.map((r) => [r.day, r.vehicleId, r.stops.map((s) => s.so), r.revenue])).toEqual([
      ["2026-11-02", "L1", [11, 12], 500],
      ["2026-11-02", null, [14], 100],
      ["2026-11-03", "L1", [13], 500],
    ]);
    // 2026-11-01 is a Sunday: Mon 2 – Sat 7 = 6 working days.
    expect(workingDays("2026-11-01", "2026-11-07")).toBe(6);
    const [l1, l2] = lorryCapacity("2026-11-01", "2026-11-07", [lorry("L1", "AAA 1"), lorry("L2", "BBB 2")], stops);
    expect(l1).toMatchObject({ trips: 2, stops: 3, revenue: 1000, revenuePerTrip: 500, stopsPerTrip: 1.5 });
    expect(l1.utilisation).toBeCloseTo(2 / 6);
    expect(l2).toMatchObject({ trips: 0, utilisation: 0, revenuePerTrip: null });
  });
});

describe("Last Mile board: lorryCards, runStatusOf, stopMatches (Houzs #5094/#5107)", () => {
  const day = "2026-11-02";
  it("pins every active lorry, adds an unmatched card last, and rolls up each run", () => {
    const off = { ...lorry("L3", "CCC 3"), active: false };
    const stops: FleetStop[] = [
      { ...stop(day, "L1", 11, 200, "10:00"), status: "delivered" },
      { ...stop(day, "L1", 12, 300, "14:00"), status: "failed" },
      { ...stop(day, "L3", 15, 50), status: "scheduled" },
      stop(day, null, 14, 100),
      stop("2026-11-03", "L2", 13, 500),
    ];
    const cards = lorryCards(day, [lorry("L1", "AAA 1"), lorry("L2", "BBB 2"), off], stops);
    expect(cards.map((c) => [c.vehicleId, c.plate, c.stops.map((s) => s.so), c.status, c.delivered, c.failed, c.revenue])).toEqual([
      ["L1", "AAA 1", [11, 12], "completed", 1, 1, 500],
      ["L2", "BBB 2", [], "scheduled", 0, 0, 0],
      ["L3", "CCC 3", [15], "scheduled", 0, 0, 50],
      [null, null, [14], "scheduled", 0, 0, 100],
    ]);
  });

  it("a run is On the way once one stop has an attempt, Completed when all have", () => {
    expect(runStatusOf([])).toBe("scheduled");
    expect(runStatusOf([{ status: "partial" }, {}])).toBe("on_the_way");
    expect(runStatusOf([{ status: "partial" }, { status: "delivered" }])).toBe("completed");
  });

  it("finds a stop by customer, SO, DO or phone digits", () => {
    const s: FleetStop = { ...stop(day, "L1", 1372, 0), customerName: "Tan Ah Kow", customerPhone: "012-345 6789", doNumber: "DO-20261102-0004" };
    expect(stopMatches(s, "ah kow")).toBe(true);
    expect(stopMatches(s, "SO-1372")).toBe(true);
    expect(stopMatches(s, "0004")).toBe(true);
    expect(stopMatches(s, "3456")).toBe(true);
    expect(stopMatches(s, "lee")).toBe(false);
    expect(stopMatches(s, "x")).toBe(true);
  });
});

describe("fleetPositionInput", () => {
  const fix = { vehicleId: "11111111-1111-4111-8111-111111111111", lat: 3.1, lng: 101.6 };
  it("refuses a fix from the future, which would stay the latest on the Live Map", () => {
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(fleetPositionInput.safeParse({ ...fix, recordedAt: later }).success).toBe(false);
    expect(fleetPositionInput.safeParse({ ...fix, recordedAt: new Date().toISOString() }).success).toBe(true);
    expect(fleetPositionInput.safeParse(fix).success).toBe(true);
  });
});
