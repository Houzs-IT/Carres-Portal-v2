/* Carres: one company, so the Service Case print offers no 2990 / Both letterhead. */
import { describe, expect, it } from "vitest";
import { printEntityOptions } from "../pages/ServiceCases";

describe("Service Case letterhead options", () => {
  it("one company: only the company's own letterhead (the picker is hidden)", () => {
    expect(printEntityOptions(["HOUZS"])).toEqual(["houzs"]);
    expect(printEntityOptions([])).toEqual(["houzs"]);
  });
  it("Houzs's two companies keep Carres / 2990 / Both", () => {
    expect(printEntityOptions(["HOUZS", "2990"])).toEqual(["2990", "houzs", "both"]) // object-key order, as before;
  });
});
