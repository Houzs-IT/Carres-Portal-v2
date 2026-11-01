import { describe, expect, it } from "vitest";
import { countFigures } from "./stock-moves";

const units = [{ found: true }, { found: false }, { found: null }];

describe("countFigures", () => {
  it("gives nothing away on a blind count that is still open", () => {
    expect(countFigures({ blind: true, status: "open", extras: [], stock_count_units: units })).toEqual({ lines: null, counted: null, variance: null });
  });

  it("variance is extras less Units recorded as not found; untouched Units do not count yet", () => {
    expect(countFigures({ blind: false, status: "open", extras: [{ qty: 3 }], stock_count_units: units })).toEqual({ lines: 3, counted: 1, variance: 2 });
    expect(countFigures({ blind: true, status: "posted", extras: null, stock_count_units: units })).toEqual({ lines: 3, counted: 1, variance: -1 });
  });
});
