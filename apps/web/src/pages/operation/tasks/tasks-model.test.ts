import { describe, expect, it } from "vitest";
import type { WorkRow } from "../use-open-work";
import { taskRowWords } from "./tasks-model";

const TODAY = "2026-10-05"; // a Monday
const row = (over: Partial<WorkRow> & { id: string }): WorkRow => ({
  module: "delivery",
  ruleKey: "confirm_delivery_date",
  dueIso: TODAY,
  timingBucket: "today",
  line: "Call AL",
  problem: "Get the scheduled delivery date",
  ownerId: "me",
  ownerState: "primary",
  normalOwner: null,
  source: { object: { kind: "delivery_scope", id: "o1", label: "SO-1368" } },
  ...over,
} as unknown as WorkRow);

describe("tasks words", () => {
  it("row words: the act on line 1, the document on line 2", () => {
    expect(taskRowWords(row({ id: "x" }))).toMatchObject({ act: "Call AL", detail: "SO-1368", missedDate: null, noDate: null });
    expect(taskRowWords(row({ id: "y", dueIso: null, timingBucket: "no_date" })).noDate).toBe("No date · set by Delivery");
    expect(taskRowWords(row({ id: "z", dueIso: "2026-10-02", timingBucket: "overdue" })).missedDate).toBe("Fri, 2 Oct");
  });
});
