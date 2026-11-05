/**
 * The lane model behind `BarCalendar`: which bar sits in which week, column and
 * lane, and how many bars each day folds into "+N more". Ported from Houzs
 * frontend/src/pages/projects/calendarModel.ts (buildCalendarWindow :66-126,
 * lane packing :214-302) and made generic: an item is any dated thing with a
 * start, an end and a tone. Pure, so the tests pin it without a render.
 *
 * Weeks start on Monday, as in Houzs. A month shows only the weeks that hold
 * one of its days, and a bar is cut to the month's own columns.
 */
import type { OrderActionTone } from "@carres/shared";

export interface BarCalendarItem {
  id: string;
  /** First day, `YYYY-MM-DD`. */
  start: string;
  /** Last day, `YYYY-MM-DD`, counted. */
  end: string;
  /** The words on the bar. */
  label: string;
  /** Extra words for the bar's spoken name and hover, e.g. its status and dates. */
  detail?: string;
  tone: OrderActionTone;
}

export type BarCalendarMode = "month" | "week";

export interface BarSegment {
  item: BarCalendarItem;
  startCol: number;
  endCol: number;
  /** The item runs on before / after what this week shows. */
  clipLeft: boolean;
  clipRight: boolean;
  lane: number;
}

export interface BarWeek {
  /** The seven days, Monday first. */
  days: string[];
  /** False for a day of the next or last month in month view. */
  inPeriod: boolean[];
  /** Bars inside the lane cap. */
  segments: BarSegment[];
  /** Per day: bars past the lane cap. */
  overflow: number[];
  /** Lane rows to draw. */
  lanes: number;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday on or before the day. */
export function mondayOf(iso: string): string {
  return addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7));
}

const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

export function barCalendarWeeks({ mode, month, weekStart, items, maxLanes }: {
  mode: BarCalendarMode;
  /** `YYYY-MM`, read in month view. */
  month: string;
  /** Any day of the week to show, read in week view. */
  weekStart: string;
  /** Packed in this order: the caller sorts. */
  items: readonly BarCalendarItem[];
  maxLanes: number;
}): BarWeek[] {
  const first = mondayOf(mode === "week" ? weekStart : `${month}-01`);
  // Houzs :215: week view never folds a bar away.
  const cap = mode === "week" ? Infinity : maxLanes;
  const weeks: BarWeek[] = [];
  for (let w = 0; w < (mode === "week" ? 1 : 6); w++) {
    const days = Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d));
    const inPeriod = days.map((d) => mode === "week" || d.startsWith(month));
    if (!inPeriod.includes(true)) continue;
    const firstCol = inPeriod.indexOf(true);
    const lastCol = inPeriod.lastIndexOf(true);
    const shownFrom = days[firstCol];
    const shownTo = days[lastCol];

    const segments: BarSegment[] = [];
    for (const item of items) {
      const end = item.end < item.start ? item.start : item.end;
      if (end < shownFrom || item.start > shownTo) continue;
      const clipLeft = item.start < shownFrom;
      const clipRight = end > shownTo;
      segments.push({
        item,
        startCol: clipLeft ? firstCol : daysBetween(days[0], item.start),
        endCol: clipRight ? lastCol : daysBetween(days[0], end),
        clipLeft,
        clipRight,
        lane: 0,
      });
    }

    // Houzs :264-276: each bar takes the first lane where it touches no other bar.
    const lanes: BarSegment[][] = [];
    for (const seg of segments) {
      let lane = lanes.findIndex((row) => row.every((o) => o.endCol < seg.startCol || o.startCol > seg.endCol));
      if (lane === -1) {
        lanes.push([seg]);
        lane = lanes.length - 1;
      } else {
        lanes[lane].push(seg);
      }
      seg.lane = lane;
    }

    const overflow = Array<number>(7).fill(0);
    const shown: BarSegment[] = [];
    for (const seg of segments) {
      if (seg.lane < cap) shown.push(seg);
      else for (let c = seg.startCol; c <= seg.endCol; c++) overflow[c] += 1;
    }
    // Houzs :288-293: month keeps the capped height on every week; week grows to fit.
    const used = shown.reduce((m, s) => Math.max(m, s.lane + 1), 0);
    weeks.push({ days, inPeriod, segments: shown, overflow, lanes: mode === "week" ? Math.max(used, 1) : maxLanes });
  }
  return weeks;
}
