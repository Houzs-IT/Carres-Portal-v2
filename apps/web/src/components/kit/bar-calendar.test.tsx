/**
 * BarCalendar and its lane model (Houzs calendarModel.ts, ported for the kit).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BarCalendar from "./BarCalendar";
import { barCalendarWeeks, mondayOf, type BarCalendarItem } from "./bar-calendar-model";

const item = (id: string, start: string, end: string): BarCalendarItem => ({ id, start, end, label: `Fair ${id}`, tone: "success" });

describe("bar calendar lane model", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });

  it("a month shows only the weeks that hold its days, and blanks the other month's days", () => {
    const weeks = barCalendarWeeks({ mode: "month", month: "2026-11", weekStart: "2026-11-02", items: [], maxLanes: 3 });
    expect(weeks.map((w) => w.days[0])).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(weeks[0].inPeriod).toEqual([false, false, false, false, false, false, true]);
  });

  it("a bar wraps at the week edge and is cut to the month", () => {
    const [first, second] = barCalendarWeeks({ mode: "month", month: "2026-11", weekStart: "", items: [item("a", "2026-10-30", "2026-11-03")], maxLanes: 3 });
    expect(first.segments[0]).toMatchObject({ startCol: 6, endCol: 6, clipLeft: true, clipRight: true });
    expect(second.segments[0]).toMatchObject({ startCol: 0, endCol: 1, clipLeft: true, clipRight: false });
  });

  it("packs bars into the first free lane and folds lanes past the cap into overflow per day", () => {
    const items = [
      item("a", "2026-11-02", "2026-11-04"),
      item("b", "2026-11-05", "2026-11-06"), // fits beside a in lane 0
      item("c", "2026-11-03", "2026-11-03"),
      item("d", "2026-11-03", "2026-11-05"),
      item("e", "2026-11-03", "2026-11-03"),
    ];
    const week = barCalendarWeeks({ mode: "month", month: "2026-11", weekStart: "", items, maxLanes: 3 })[1];
    expect(week.segments.map((s) => [s.item.id, s.lane])).toEqual([["a", 0], ["b", 0], ["c", 1], ["d", 2]]);
    expect(week.overflow).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(week.lanes).toBe(3);
  });

  it("week view never folds a bar away", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => item(id, "2026-11-03", "2026-11-03"));
    const [week] = barCalendarWeeks({ mode: "week", month: "2026-11", weekStart: "2026-11-04", items, maxLanes: 3 });
    expect(week.days[0]).toBe("2026-11-02");
    expect(week.segments).toHaveLength(5);
    expect(week.overflow.every((n) => n === 0)).toBe(true);
    expect(week.lanes).toBe(5);
  });
});

describe("BarCalendar", () => {
  const items = ["a", "b", "c", "d"].map((id) => item(id, "2026-11-10", "2026-11-11"));

  it("draws each bar as a named button that opens its item", () => {
    const open = vi.fn();
    render(<BarCalendar month="2026-11" onMonthChange={() => {}} items={[{ ...items[0], detail: "Confirmed" }]} onItemClick={open} label="Projects" />);
    fireEvent.click(screen.getByRole("button", { name: "Fair a, Confirmed" }));
    expect(open).toHaveBeenCalledWith("a");
  });

  it("folds the fourth lane into +N more, which opens that week with every bar", () => {
    render(<BarCalendar month="2026-11" onMonthChange={() => {}} items={items} onItemClick={() => {}} label="Projects" />);
    expect(screen.queryByTestId("bar-d")).not.toBeInTheDocument();
    const more = screen.getAllByRole("button", { name: /^1 more, / });
    expect(more[0]).toHaveTextContent("+1 more");
    expect(more[0].textContent).not.toMatch(/[-–—]/);
    fireEvent.click(more[0]);
    expect(screen.getByTestId("bar-d")).toBeInTheDocument();
    expect(screen.getByTestId("bar-week-2026-11-09")).toBeInTheDocument();
  });

  it("the month arrows move one month", () => {
    const onMonth = vi.fn();
    render(<BarCalendar month="2026-12" onMonthChange={onMonth} items={[]} onItemClick={() => {}} label="Projects" />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onMonth).toHaveBeenLastCalledWith("2027-01");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(onMonth).toHaveBeenLastCalledWith("2026-11");
  });
});
