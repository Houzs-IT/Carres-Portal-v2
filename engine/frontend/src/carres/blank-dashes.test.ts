import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { blankDashes, isDashOnly } from "./blank-dashes";

describe("an empty Sales Orders cell stays blank (owner, 23 Nov 2026)", () => {
  it("knows a dash on its own, bare or in one element", () => {
    expect(isDashOnly("—")).toBe(true);
    expect(isDashOnly(createElement("span", null, "—"))).toBe(true);
    expect(isDashOnly("CR-SO-1")).toBe(false);
    expect(isDashOnly(createElement("span", null, "RM 0.00"))).toBe(false);
    expect(isDashOnly(null)).toBe(false);
  });
  it("wraps a column's render and leaves the rest of the column alone", () => {
    const col = { key: "ref", render: (r: { ref: string }) => r.ref || "—", getValue: (r: { ref: string }) => r.ref };
    const out = blankDashes(col);
    expect(out.render({ ref: "" })).toBeNull();
    expect(out.render({ ref: "A1" })).toBe("A1");
    expect(out.getValue).toBe(col.getValue);
  });
});
