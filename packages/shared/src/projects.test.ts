import { describe, expect, it } from "vitest";
import { checklistDueDate, projectSalesTotals, checklistItemInput, checklistProgress, deriveProjectCode, deriveProjectName, projectCreateInput, projectDurationDays, uniqueProjectCode } from "./projects";

/** Houzs project-naming.ts:25-60 and deriveProjectName, ported for 0750. */
describe("project code and name", () => {
  const base = { startDate: "2026-12-04", organizer: "Kai Hao (KL Chen)", state: "Johor", venue: "Paradigm Mall", brand: "Carres" };

  it("derives the code from month, organizer, state, venue and brand", () => {
    expect(deriveProjectCode(base)).toBe("2026-12-KAI-HAO-KL-CHEN-JOHOR-PARADIGM-MALL-CARRES");
  });

  it("puts SOLO in the organizer slot for a solo event or no organizer", () => {
    expect(deriveProjectCode({ ...base, eventType: "solo" })).toBe("2026-12-SOLO-JOHOR-PARADIGM-MALL-CARRES");
    expect(deriveProjectCode({ ...base, organizer: null })).toBe("2026-12-SOLO-JOHOR-PARADIGM-MALL-CARRES");
  });

  it("adds -2, -3 on a clash", () => {
    expect(uniqueProjectCode("A", [])).toBe("A");
    expect(uniqueProjectCode("A", ["A", "A-2"])).toBe("A-3");
  });

  it("names the event STATE [BRAND] ORGANIZER @ VENUE", () => {
    expect(deriveProjectName(base)).toBe("JOHOR [Carres] Kai Hao (KL Chen) @ Paradigm Mall");
    expect(deriveProjectName({ ...base, organizer: " " })).toBe("JOHOR [Carres] SOLO @ Paradigm Mall");
  });

  it("counts both ends of the event", () => {
    expect(projectDurationDays("2026-12-04", "2026-12-06")).toBe(3);
  });

  it("refuses an end date before the start date", () => {
    expect(projectCreateInput.safeParse({ ...base, endDate: "2026-12-01" }).success).toBe(false);
    expect(projectCreateInput.safeParse({ ...base, endDate: "2026-12-06" }).success).toBe(true);
  });
});

/** Houzs 054 due offset and the done/na progress rule, ported for 0752. */
describe("project checklist", () => {
  it("counts the due day from the start day, across a month end", () => {
    expect(checklistDueDate("2026-12-04", -7)).toBe("2026-11-27");
    expect(checklistDueDate("2026-12-04", 30)).toBe("2027-01-03");
    expect(checklistDueDate("2026-12-04", null)).toBeNull();
  });
  it("counts done and not needed as finished", () => {
    expect(checklistProgress([{ status: "done" }, { status: "na" }, { status: "pending" }, { status: "blocked" }])).toBe(50);
    expect(checklistProgress([])).toBe(0);
  });
  it("refuses an offset past a year", () => {
    expect(checklistItemInput.safeParse({ title: "Book the lorry", dueOffsetDays: 400 }).success).toBe(false);
    expect(checklistItemInput.safeParse({ title: "Book the lorry", dueOffsetDays: -7 }).success).toBe(true);
  });
});

/** Houzs project SO totals: cancelled left out, summed in sen (0753). */
describe("project sales totals", () => {
  it("leaves cancelled orders out and keeps sen exact", () => {
    const o = (status: string, total: number | null, paid: number, balance: number) => ({ id: "x", so: "SO", status, customerName: null, placedAt: null, total, paid, balance });
    expect(projectSalesTotals([o("confirmed", 0.1, 0.1, 0), o("confirmed", 0.2, 0, 0.2), o("cancelled", 500, 0, 500), o("confirmed", null, 0, 0)]))
      .toEqual({ count: 3, total: 0.3, paid: 0.1, balance: 0.2 });
  });
});
