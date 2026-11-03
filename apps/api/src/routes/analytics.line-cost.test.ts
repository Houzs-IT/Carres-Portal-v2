import { describe, expect, it } from "vitest";
import { lineUnitCost } from "./analytics";

describe("lineUnitCost", () => {
  it("reads the cost written when the line was priced, not today's catalog cost", () => {
    expect(lineUnitCost({ unit_cost: "120.50" }, 200)).toBe(120.5);
  });
  it("keeps a priced line with no cost as no cost", () => {
    expect(lineUnitCost({ unit_cost: null }, 200)).toBeNull();
  });
  it("falls back to the catalog cost for a line from before the cost was written", () => {
    expect(lineUnitCost(null, 200)).toBe(200);
    expect(lineUnitCost(null, null)).toBeNull();
  });
});
