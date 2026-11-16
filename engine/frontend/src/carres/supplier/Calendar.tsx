// Carres only (not part of Houzs's code): the calendar for asking a new pickup day (owner's design, 17 Nov 2026).
//
// It replaces the browser's own date box: a month at a time, past days greyed and closed, today ringed, the pickup's
// current day marked with a small amber dot, and three quick picks. The month slides the way it moved.
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { fmtDay, play } from "./ui";

/* The month heading over the grid only ("November 2026"): it names the month being shown, not a day. Every day the
   calendar writes goes through the engine's one date format (fmtDay). */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM-DD. */
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

/** "Sun 2026/11/22": the weekday is a word; the day itself is the engine's one date format. */
export function prettyDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${DOW[new Date(y, m - 1, d).getDay()]} ${fmtDay(iso)}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d + n);
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export function Calendar({ today, current, value, onChange }: {
  /** Today in Kuala Lumpur, YYYY-MM-DD: days before it cannot be picked. */
  today: string;
  /** The pickup's day now: the amber dot. */
  current: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [vy, vm] = value.split("-").map(Number) as [number, number];
  const [view, setView] = useState<{ y: number; m: number; dir: number }>({ y: vy, m: vm, dir: 0 });
  const grid = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (view.dir) play(grid.current, [{ opacity: 0, transform: `translateX(${view.dir * 12}px)` }, { opacity: 1, transform: "none" }], 220);
  }, [view]);

  const pick = (iso: string) => {
    const [y, m] = iso.split("-").map(Number) as [number, number];
    if (y !== view.y || m !== view.m) setView({ y, m, dir: y * 12 + m > view.y * 12 + view.m ? 1 : -1 });
    onChange(iso);
  };
  const step = (dir: number) => setView((v) => {
    const t = v.y * 12 + (v.m - 1) + dir;
    return { y: Math.floor(t / 12), m: (t % 12) + 1, dir };
  });

  const first = new Date(view.y, view.m - 1, 1).getDay();
  const dim = new Date(view.y, view.m, 0).getDate();
  const t0 = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const nextMon = addDays(today, ((8 - t0.getDay()) % 7) || 7);

  return (
    <div className="rounded-[10px] border border-border bg-surface px-2.5 pb-2 pt-2.5 shadow-[0_8px_24px_-16px_rgba(17,24,16,.3)]">
      <div className="flex items-center justify-between px-0.5 pb-1.5">
        <button type="button" onClick={() => step(-1)} title="Previous month" aria-label="Previous month" className="flex h-7 w-7 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-border-subtle hover:text-ink">
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className="whitespace-nowrap text-[13px] font-bold text-ink">{MONTHS[view.m - 1]} {view.y}</span>
        <button type="button" onClick={() => step(1)} title="Next month" aria-label="Next month" className="flex h-7 w-7 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-border-subtle hover:text-ink">
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 pb-0.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span key={i} className="text-center text-[10.5px] font-semibold text-[#9AA0A8]">{w}</span>
        ))}
      </div>
      <div ref={grid} className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: first }, (_, i) => <span key={`b${i}`} className="h-8" />)}
        {Array.from({ length: dim }, (_, i) => {
          const d = i + 1;
          const key = ymd(view.y, view.m, d);
          const sel = key === value;
          const isToday = key === today;
          const past = key < today;
          const orig = key === current && !sel;
          return (
            <button
              key={key}
              type="button"
              disabled={past}
              onClick={() => pick(key)}
              aria-label={prettyDay(key)}
              aria-pressed={sel}
              className={cn("group relative flex h-8 items-center justify-center border-0 bg-transparent p-0", past ? "cursor-not-allowed" : "cursor-pointer")}
            >
              <span
                className={cn(
                  "flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12.5px] transition-[background-color,color,transform] duration-[180ms]",
                  sel ? "bg-primary text-white" : past ? "text-[#C4C8CE]" : "text-ink group-hover:bg-accent-soft",
                )}
                style={{ fontWeight: sel || isToday ? 700 : 500, boxShadow: isToday && !sel ? "inset 0 0 0 1px rgb(var(--hz-primary))" : "none" }}
              >
                {d}
              </span>
              <span className="absolute bottom-0.5 left-1/2 -ml-0.5 h-1 w-1 rounded-full" style={{ background: orig ? "#C98A1B" : "transparent" }} />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 border-t border-border-subtle pt-2">
        {[
          { label: "Tomorrow", day: addDays(today, 1) },
          { label: "+3 days", day: addDays(today, 3) },
          { label: "Next Mon", day: nextMon },
        ].map((q) => (
          <button key={q.label} type="button" onClick={() => pick(q.day)} className="flex-1 rounded-full border border-border bg-surface px-1.5 py-1 text-[11.5px] font-semibold text-ink-secondary transition-all duration-150 hover:border-primary hover:text-primary">
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const fromToText = (current: string, value: string) => ({
  from: `Now ${fmtDay(current)}`,
  to: value === current ? "Pick a new day" : `→ ${prettyDay(value)}`,
});
