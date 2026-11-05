import { describe, expect, it } from "vitest";
import { caseStageDwell } from "./service-case-stage-clock";

describe("caseStageDwell", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("counts whole days in the stage", () => {
    expect(caseStageDwell("2026-11-07T18:00:00Z", null, now)).toEqual({ days: 2, overTarget: false });
  });

  it("is over target at the target, not before", () => {
    expect(caseStageDwell("2026-11-08T12:00:01Z", 2, now).overTarget).toBe(false);
    expect(caseStageDwell("2026-11-08T12:00:00Z", 2, now).overTarget).toBe(true);
  });

  it("has no target when the stage has none", () => {
    expect(caseStageDwell("2026-01-01T00:00:00Z", null, now).overTarget).toBe(false);
  });

  it("never counts below zero for a clock ahead of this one", () => {
    expect(caseStageDwell("2026-11-11T00:00:00Z", 1, now)).toEqual({ days: 0, overTarget: false });
  });
});
