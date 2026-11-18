import { describe, expect, it } from "vitest";
import { columnFloor, fitWidths } from "./ListTable";

const sum = (ws: number[]) => ws.reduce((a, w) => a + w, 0);

describe("a list fits the window (UI MASTER, proportional table fit)", () => {
  it("keeps the design's widths when they fit, and when the window is not measured yet", () => {
    const cols = [{ width: 140, floor: 140 }, { width: 200, floor: 140 }];
    expect(fitWidths(cols, 400)).toEqual([140, 200]);
    expect(fitWidths(cols, 340)).toEqual([140, 200]);
    expect(fitWidths(cols, 0)).toEqual([140, 200]);
  });

  it("gives way in proportion to what each column can spare, and then fits exactly", () => {
    // Collections on a ~1670px window: 1740px of columns in 1620px.
    const cols = [
      { width: 140, floor: 138 }, // the order number: never under its widest number
      { width: 200, floor: 140 }, // the customer: free text, to 70%
      { width: 240, floor: 168 }, // the item: free text, to 70%
      { width: 150, floor: 150 }, // the term: no room to spare
      { width: 170, floor: 104 }, // the status: down to its widest badge
      { width: 840, floor: 840 }, // the amounts: never cut
    ];
    const out = fitWidths(cols, 1620);
    expect(sum(out)).toBeLessThanOrEqual(1620);
    expect(sum(out)).toBeGreaterThan(1620 - cols.length);
    out.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(cols[i]!.floor));
    expect(out[3]).toBe(150);
    expect(out[5]).toBe(840);
    // The status had the most to spare above its floor, so it gave up the most.
    expect(170 - out[4]!).toBeGreaterThan(200 - out[1]!);
  });

  it("stops at every column's floor when even that is too wide, and the table then scrolls inside its frame", () => {
    const cols = [{ width: 200, floor: 140 }, { width: 100, floor: 90 }];
    expect(fitWidths(cols, 100)).toEqual([140, 90]);
  });

  it("changes nothing when no column can spare anything", () => {
    expect(fitWidths([{ width: 120, floor: 120 }, { width: 80, floor: 80 }], 100)).toEqual([120, 80]);
  });
});

describe("how narrow a column may go", () => {
  it("a column a person dragged keeps exactly that width", () => {
    expect(columnFloor(260, { resized: true, shrink: true, natural: 60 })).toBe(260);
  });

  it("free text goes to 70% of its width, never under 52px", () => {
    expect(columnFloor(200, { resized: false, shrink: true, natural: null })).toBe(140);
    expect(columnFloor(60, { resized: false, shrink: true, natural: null })).toBe(52);
    expect(columnFloor(40, { resized: false, shrink: true, natural: null })).toBe(40);
  });

  it("anything else keeps the width of the widest thing it shows, between 70% and its own width", () => {
    expect(columnFloor(170, { resized: false, shrink: false, natural: 104 })).toBe(119);
    expect(columnFloor(170, { resized: false, shrink: false, natural: 150.2 })).toBe(151);
    expect(columnFloor(120, { resized: false, shrink: false, natural: 131 })).toBe(120);
  });

  it("a column whose cells cannot be measured keeps its width", () => {
    expect(columnFloor(150, { resized: false, shrink: false, natural: null })).toBe(150);
  });
});
