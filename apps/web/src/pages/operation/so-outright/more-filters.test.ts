import { describe, expect, it } from "vitest";
import { isMoreFilterParam, matchesMoreFilters, moreFilterChips, presetRange } from "./more-filters";
import type { RegisterRow } from "../sales-order-columns";

const row = (over: Record<string, unknown> = {}, o: Record<string, unknown> = {}) =>
  ({
    so: 1200,
    phoneDigits: "60123456789",
    total: { kind: "amount", value: 500 },
    balance: { kind: "amount", value: 100 },
    o: { customer_email: "Tan@Mail.com", delivery_date: "2026-10-01", order_lines: [], amendment_documents: [], ...o },
    ...over,
  }) as unknown as RegisterRow;
const at = (query: string) => new URLSearchParams(query);
const TODAY = "2026-11-04";

describe("matchesMoreFilters", () => {
  it("holds a number range at both ends, and a missing value fails", () => {
    expect(matchesMoreFilters(row(), at("min.so=1200&max.so=1200"), TODAY)).toBe(true);
    expect(matchesMoreFilters(row(), at("min.so=1201"), TODAY)).toBe(false);
    expect(matchesMoreFilters(row(), at("max.balance=99"), TODAY)).toBe(false);
    expect(matchesMoreFilters(row({ total: { kind: "unknown" } }), at("min.total=1"), TODAY)).toBe(false);
  });
  it("reads a settled balance as zero", () => {
    expect(matchesMoreFilters(row({ balance: { kind: "settled" } }), at("max.balance=0"), TODAY)).toBe(true);
  });
  it("matches contact digits however they are typed, and email in any case", () => {
    expect(matchesMoreFilters(row(), at("has.contact=012-345"), TODAY)).toBe(true);
    expect(matchesMoreFilters(row(), at("has.contact=999"), TODAY)).toBe(false);
    expect(matchesMoreFilters(row(), at("has.email=tan@"), TODAY)).toBe(true);
  });
  it("reads a pending amendment only from a submitted one", () => {
    const pending = row({}, { amendment_documents: [{ id: "a", status: "submitted" }] });
    const done = row({}, { amendment_documents: [{ id: "a", status: "approved" }] });
    expect(matchesMoreFilters(pending, at("is.amendment=yes"), TODAY)).toBe(true);
    expect(matchesMoreFilters(done, at("is.amendment=yes"), TODAY)).toBe(false);
    expect(matchesMoreFilters(done, at("is.amendment=no"), TODAY)).toBe(true);
  });
  it("calls an undelivered order overdue only after its delivery date", () => {
    expect(matchesMoreFilters(row(), at("is.overdue=yes"), TODAY)).toBe(true);
    expect(matchesMoreFilters(row({}, { delivery_date: "2026-11-04" }), at("is.overdue=yes"), TODAY)).toBe(false);
    expect(matchesMoreFilters(row({}, { delivery_date: null }), at("is.overdue=yes"), TODAY)).toBe(false);
  });
});

describe("moreFilterChips", () => {
  it("gives each filter one chip that names the params it clears", () => {
    const chips = moreFilterChips(at("min.so=10&max.so=20&has.email=x&is.amendment=yes"));
    expect(chips.map((c) => c.label)).toEqual(["Sales order no.: 10 to 20", "Email: x", "Pending amendment: Has a pending amendment"]);
    expect(chips[0]!.params).toEqual(["min.so", "max.so"]);
    expect(chips.flatMap((c) => c.params).every(isMoreFilterParam)).toBe(true);
  });
});

describe("presetRange", () => {
  it("starts weeks on Monday, including from a Sunday", () => {
    expect(presetRange("this_week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(presetRange("this_week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(presetRange("last_week", "2026-11-04")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
  it("crosses month and year ends", () => {
    expect(presetRange("last_month", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("next_month", "2026-01-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("yesterday", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });
  it("answers nothing for an unknown preset", () => {
    expect(presetRange("nope", TODAY)).toBeNull();
  });
});
