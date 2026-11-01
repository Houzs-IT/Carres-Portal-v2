import { describe, expect, it } from "vitest";
import { floorPlan, MAX_SEED_BINS, seedBins } from "./warehouse-rack-tools";

describe("seedBins", () => {
  it("makes racks with levels, or one rack of bins", () => {
    expect(seedBins({ series: "L", count: 2, levels: 2 }).map((b) => `${b.rack}.${b.bin}`)).toEqual(["L1.1", "L1.2", "L2.1", "L2.2"]);
    expect(seedBins({ series: "", count: 2, levels: 1 })).toEqual([{ rack: "Rack", bin: "1" }, { rack: "Rack", bin: "2" }]);
  });
  it("stops at the cap", () => expect(seedBins({ series: "L", count: 500, levels: 3 })).toHaveLength(MAX_SEED_BINS));
});

describe("floorPlan", () => {
  it("groups by series and sorts L2 before L10", () => {
    const plan = floorPlan([{ rack: "L10", bin: "1" }, { rack: "R1", bin: "2" }, { rack: "L2", bin: "10" }, { rack: "L2", bin: "2" }]);
    expect(plan.map((b) => b.series)).toEqual(["L", "R"]);
    expect(plan[0]!.racks.map((r) => r.rack)).toEqual(["L2", "L10"]);
    expect(plan[0]!.racks[0]!.bins.map((b) => b.bin)).toEqual(["2", "10"]);
  });
});
