/**
 * Logistic Overview arithmetic. Follows Houzs LogisticOverview.tsx:94-148
 * (Weisiang's decision 2026-11-01: Carres follows Houzs). PURE: it reads the
 * Delivery Orders register rows and the Delivery Planning rows, stores nothing.
 */
import type { DoRegisterRow } from "./delivery-orders-register";
import type { PlanRow } from "./delivery-planning";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const issuedDay = (r: DoRegisterRow) => r.issuedAt.slice(0, 10);
const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);

/** One open order: its last leg's plan, unless a document of it was delivered. */
export function openOrders(plan: readonly PlanRow[], dos: readonly DoRegisterRow[]): PlanRow[] {
  const delivered = new Set(
    dos.filter((d) => d.status.kind === "delivered" && !d.intermediateLeg).map((d) => d.orderId),
  );
  const last = new Map<string, PlanRow>();
  for (const r of plan) {
    if (delivered.has(r.orderId)) continue;
    const seen = last.get(r.orderId);
    if (!seen || r.leg > seen.leg) last.set(r.orderId, r);
  }
  return [...last.values()];
}

/** The date an order is due: the trip day when there is one, else what the customer asked for. */
export const dueOf = (r: PlanRow) => r.day ?? r.requested;

export type DueBucket = { key: string; label: string; rows: PlanRow[]; amount: number; agreed: number };

export function dueBuckets(open: readonly PlanRow[], today: string): DueBucket[] {
  const d = (n: number) => addDays(today, n);
  const defs: Array<[string, string, (e: string | null) => boolean]> = [
    ["overdue", "Past delivery date", (e) => !!e && e < today],
    ["d3", "Within 3 days", (e) => !!e && e >= today && e <= d(3)],
    ["d7", "4 to 7 days", (e) => !!e && e > d(3) && e <= d(7)],
    ["d14", "8 to 14 days", (e) => !!e && e > d(7) && e <= d(14)],
    ["d30", "15 to 30 days", (e) => !!e && e > d(14) && e <= d(30)],
    ["later", "After 30 days", (e) => !!e && e > d(30)],
    ["none", "No date yet", (e) => !e],
  ];
  return defs.map(([key, label, test]) => {
    const rows = open.filter((r) => test(dueOf(r)));
    return { key, label, rows, amount: sum(rows, (r) => r.amount), agreed: rows.filter((r) => r.scheduled).length };
  });
}

export type PeriodFigures = { rows: DoRegisterRow[]; issued: number; amount: number; delivered: number };

const figures = (rows: DoRegisterRow[]): PeriodFigures => ({
  rows,
  issued: rows.length,
  amount: sum(rows, (r) => r.amount ?? 0),
  delivered: rows.filter((r) => r.status.kind === "delivered").length,
});

/** Documents issued in the window. A cancelled document was never a delivery. */
export function periodFigures(dos: readonly DoRegisterRow[], from: string, to: string): PeriodFigures {
  return figures(dos.filter((r) => r.status.kind !== "cancelled" && issuedDay(r) >= from && issuedDay(r) <= to));
}

/** Houzs week of the month: W1 = 1st to 7th, ... W5 = 29th to the month's end. */
export function weeksOf(dos: readonly DoRegisterRow[], from: string, to: string, today: string) {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
  return months.flatMap((m) => {
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    return [[1, 7], [8, 14], [15, 21], [22, 28], [29, last]]
      .filter(([a]) => a! <= last)
      .map(([a, b], i) => {
        const start = `${m}-${String(a).padStart(2, "0")}`;
        const end = `${m}-${String(b).padStart(2, "0")}`;
        return {
          key: start,
          label: months.length > 1 ? `${m} · W${i + 1}` : `W${i + 1}`,
          from: start,
          to: end,
          current: today >= start && today <= end,
          ...periodFigures(dos, start, end),
        };
      });
  });
}

/** Houzs daily section: each day of the window that issued a document, newest first. */
export function daysOf(dos: readonly DoRegisterRow[], from: string, to: string) {
  const by = new Map<string, DoRegisterRow[]>();
  for (const r of periodFigures(dos, from, to).rows) by.set(issuedDay(r), [...(by.get(issuedDay(r)) ?? []), r]);
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, rows]) => ({ key: day, day, ...figures(rows) }));
}

export function monthsOf(dos: readonly DoRegisterRow[]) {
  const by = new Map<string, DoRegisterRow[]>();
  for (const r of dos) {
    if (r.status.kind === "cancelled") continue;
    const m = issuedDay(r).slice(0, 7);
    by.set(m, [...(by.get(m) ?? []), r]);
  }
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, rows]) => ({ month, ...figures(rows) }));
}

/** A breakdown of the period's documents, largest first. */
export function groupFigures(rows: readonly DoRegisterRow[], keyOf: (r: DoRegisterRow) => string) {
  const by = new Map<string, DoRegisterRow[]>();
  for (const r of rows) by.set(keyOf(r), [...(by.get(keyOf(r)) ?? []), r]);
  return [...by.entries()]
    .map(([key, xs]) => ({ key, ...figures(xs) }))
    .sort((a, b) => b.issued - a.issued);
}

/** Houzs process gap: out with the driver over 7 days and never closed. */
export function notClosed(dos: readonly DoRegisterRow[], today: string): DoRegisterRow[] {
  const line = addDays(today, -7);
  return dos.filter((r) => r.status.kind === "out_for_delivery" && issuedDay(r) < line);
}
