/**
 * BarCalendar — dated items as one coloured bar each across a month or week
 * grid (YH 3 Nov 2026: the Houzs project calendar joins the kit first, then
 * the Projects page uses it). The THIRD calendar surface beside DatePicker
 * (a field) and MonthCalendar (a rail filter): this one SHOWS spans, so it is a
 * plain grid, not a day picker.
 *
 * Follows Houzs frontend/src/pages/projects/ProjectsCalendarView.tsx: Monday
 * first, Previous · Today · Next, a Month / Week switch, one bar per item from
 * its first to its last day, wrapping at the week edge with a square corner,
 * stacked in lanes. Month view keeps `maxLanes` lanes and folds the rest into
 * `+N more` per day; that button opens the day's week, where every bar shows.
 * The lane model lives in `bar-calendar-model.ts`.
 *
 * Colour is the StatusPill pair for the item's tone: no colour of its own.
 * Each bar is a button named by its label and detail.
 */
import { useMemo, useState } from "react";
import { appTodayIso, fmtDate, fmtDateShort, fmtMonth } from "@/lib/fmt-date";
import Button from "./Button";
import Tabs from "./Tabs";
import { SELECT_PILL_CLASS, STATUS_PILL_CLASS } from "./tokens";
import { addDays, barCalendarWeeks, mondayOf, type BarCalendarItem, type BarCalendarMode } from "./bar-calendar-model";

export type { BarCalendarItem } from "./bar-calendar-model";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** One lane row; the bar fills it. */
const LANE_PX = 20;

const shiftMonth = (month: string, n: number) => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default function BarCalendar({
  month,
  onMonthChange,
  items,
  onItemClick,
  maxLanes = 3,
  moreWord = "more",
  label,
  testId,
}: {
  /** The month shown in month view, `YYYY-MM`. */
  month: string;
  onMonthChange: (isoMonth: string) => void;
  /** Packed into lanes in this order. */
  items: readonly BarCalendarItem[];
  onItemClick: (id: string) => void;
  /** Lanes a month week shows before `+N more`. Week view shows every bar. */
  maxLanes?: number;
  /** The word after `+N`. */
  moreWord?: string;
  /** What the calendar shows, for a screen reader. */
  label: string;
  testId?: string;
}) {
  const today = appTodayIso();
  const [mode, setMode] = useState<BarCalendarMode>("month");
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const weeks = useMemo(
    () => barCalendarWeeks({ mode, month, weekStart, items, maxLanes }),
    [mode, month, weekStart, items, maxLanes],
  );
  const isWeek = mode === "week";
  const period = isWeek ? `${fmtDateShort(weekStart)} to ${fmtDateShort(addDays(weekStart, 6))}` : fmtMonth(month);
  const step = (n: number) => (isWeek ? setWeekStart(addDays(weekStart, n * 7)) : onMonthChange(shiftMonth(month, n)));
  const openWeek = (day: string) => {
    setWeekStart(mondayOf(day));
    setMode("week");
  };

  return (
    <section aria-label={label} data-kit="bar-calendar" data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button iconOnly icon="previous" aria-label={isWeek ? "Previous week" : "Previous month"} onClick={() => step(-1)} />
        <Button size="sm" onClick={() => (isWeek ? setWeekStart(mondayOf(today)) : onMonthChange(today.slice(0, 7)))}>Today</Button>
        <Button iconOnly icon="forward" aria-label={isWeek ? "Next week" : "Next month"} onClick={() => step(1)} />
        <h3 className="text-strong text-c-ink" aria-live="polite">{period}</h3>
        <span className="ml-auto">
          <Tabs variant="segmented" label="Calendar view" value={mode} onValueChange={(v) => setMode(v as BarCalendarMode)}
            tabs={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]} />
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-c-card-border bg-c-card">
        {!isWeek ? (
          <div className="grid grid-cols-7 border-b border-c-section-line" aria-hidden>
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-label uppercase text-c-secondary">{d}</div>)}
          </div>
        ) : null}
        {weeks.map((week) => (
          <div key={week.days[0]} data-testid={`bar-week-${week.days[0]}`}
            className="grid grid-cols-7 gap-y-0.5 border-b border-c-section-line pb-1 last:border-b-0"
            style={{ gridTemplateRows: `auto repeat(${week.lanes}, ${LANE_PX}px)${isWeek ? "" : " 16px"}` }}>
            {week.days.map((day, c) => (
              <div key={`bg-${day}`} aria-hidden
                className={`${c < 6 ? "border-r border-c-section-line" : ""} ${week.inPeriod[c] ? "" : "bg-c-hover"}`}
                style={{ gridColumn: c + 1, gridRow: "1 / -1" }} />
            ))}
            {week.days.map((day, c) =>
              week.inPeriod[c] ? (
                <div key={`n-${day}`} className="px-1.5 pt-1 text-body" style={{ gridColumn: c + 1, gridRow: 1 }}>
                  <span className={day === today ? `rounded-full px-1.5 font-semibold ${SELECT_PILL_CLASS}` : "text-c-ink"}>
                    {isWeek ? fmtDate(day) : Number(day.slice(8, 10))}
                  </span>
                </div>
              ) : null,
            )}
            {week.segments.map((s) => {
              const name = s.item.detail ? `${s.item.label}, ${s.item.detail}` : s.item.label;
              return (
                <button key={`${s.item.id}-${s.startCol}`} type="button" aria-label={name} title={name}
                  data-testid={`bar-${s.item.id}`} onClick={() => onItemClick(s.item.id)}
                  className={`mx-1 truncate px-1.5 text-left text-label hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kit-blue-9 ${STATUS_PILL_CLASS[s.item.tone]} ${s.clipLeft ? "" : "rounded-l-control"} ${s.clipRight ? "" : "rounded-r-control"}`}
                  style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 2 }}>
                  {s.item.label}
                </button>
              );
            })}
            {week.overflow.map((n, c) =>
              n > 0 ? (
                <button key={`more-${week.days[c]}`} type="button" aria-label={`${n} ${moreWord}, ${fmtDate(week.days[c])}`}
                  onClick={() => openWeek(week.days[c])}
                  className="justify-self-end pr-1.5 text-label font-medium text-c-select-fg hover:underline"
                  style={{ gridColumn: c + 1, gridRow: week.lanes + 2 }}>
                  +{n} {moreWord}
                </button>
              ) : null,
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
