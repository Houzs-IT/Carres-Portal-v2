/**
 * POS-parity (MAINTAIN → Sales analysis) — pure client-side summarizers over
 * the flattened /api/analytics/sales feed (2990s pattern: server flattens,
 * page aggregates). No React, no IO — unit-testable.
 */

export interface AnalyticsOrder {
  so: number;
  placedAt: string;
  channel: string;
  revenue: number;
  deliveryFee: number;
  paid: number;
  /** Full-order COGS, or null when any line lacks a known cost. */
  cogs: number | null;
  race: string | null;
  gender: string | null;
  birthday: string | null;
}

export interface AnalyticsLine {
  so: number;
  placedAt: string;
  sku: string;
  model: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number | null;
  race: string | null;
  gender: string | null;
  birthday: string | null;
}

export interface SalesAnalyticsResponse {
  months: number;
  orders: AnalyticsOrder[];
  lines: AnalyticsLine[];
}

/** Below this many demographic-carrying orders, distributions get a
 *  thin-sample warning (2990s MIN_SAMPLE). */
export const MIN_SAMPLE = 10;

export const AGE_BANDS = ["<25", "25 to 34", "35 to 44", "45 to 54", "55+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Precise age from the birthday (2990s: no stored bucket — banded at render). */
export function ageOf(birthdayIso: string, at: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdayIso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = at.getFullYear() - y;
  const birthdayPassed =
    at.getMonth() + 1 > mo || (at.getMonth() + 1 === mo && at.getDate() >= d);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function ageBandOf(birthdayIso: string | null, at: Date): AgeBand | null {
  if (!birthdayIso) return null;
  const age = ageOf(birthdayIso, at);
  if (age === null) return null;
  if (age < 25) return "<25";
  if (age < 35) return "25 to 34";
  if (age < 45) return "35 to 44";
  if (age < 55) return "45 to 54";
  return "55+";
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface OverviewKpis {
  orders: number;
  revenue: number;
  aov: number;
  avgDeliveryFee: number;
  /** Gross margin % over the cogs-complete orders only; null when none. */
  grossMarginPct: number | null;
  /** How many orders the margin figure is actually based on. */
  cogsCompleteOrders: number;
}

export function summarizeOverview(orders: AnalyticsOrder[]): OverviewKpis {
  const n = orders.length;
  const revenue = orders.reduce((s, o) => s + o.revenue, 0);
  const delivery = orders.reduce((s, o) => s + o.deliveryFee, 0);
  const withCogs = orders.filter((o) => o.cogs !== null);
  const cogsRevenue = withCogs.reduce((s, o) => s + o.revenue, 0);
  const cogsTotal = withCogs.reduce((s, o) => s + (o.cogs ?? 0), 0);
  return {
    orders: n,
    revenue,
    aov: n > 0 ? revenue / n : 0,
    avgDeliveryFee: n > 0 ? delivery / n : 0,
    grossMarginPct:
      withCogs.length > 0 && cogsRevenue > 0
        ? ((cogsRevenue - cogsTotal) / cogsRevenue) * 100
        : null,
    cogsCompleteOrders: withCogs.length,
  };
}

export interface MonthBar {
  /** "2026-03" sortable key. */
  key: string;
  /** "Mar 26" axis label. */
  label: string;
  revenue: number;
  orders: number;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthlyRevenue(orders: AnalyticsOrder[]): MonthBar[] {
  const byMonth = new Map<string, MonthBar>();
  for (const o of orders) {
    const d = new Date(o.placedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bar =
      byMonth.get(key) ??
      ({
        key,
        label: `${MONTH_LABEL[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
        revenue: 0,
        orders: 0,
      } as MonthBar);
    bar.revenue += o.revenue;
    bar.orders += 1;
    byMonth.set(key, bar);
  }
  return [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ── Customer data ───────────────────────────────────────────────────────────

export interface DistributionRow {
  label: string;
  count: number;
  pct: number;
}

export interface Distribution {
  rows: DistributionRow[];
  /** Orders that carried the field (the denominator). */
  known: number;
  total: number;
}

function distributionOf(values: Array<string | null>): Distribution {
  const total = values.length;
  const counts = new Map<string, number>();
  let known = 0;
  for (const v of values) {
    if (!v) continue;
    known += 1;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: known > 0 ? (count / known) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
  return { rows, known, total };
}

export function raceDistribution(orders: AnalyticsOrder[]): Distribution {
  return distributionOf(orders.map((o) => o.race));
}

export function genderDistribution(orders: AnalyticsOrder[]): Distribution {
  return distributionOf(orders.map((o) => o.gender));
}

export function ageDistribution(orders: AnalyticsOrder[], at: Date): Distribution {
  const dist = distributionOf(orders.map((o) => ageBandOf(o.birthday, at)));
  // Keep band order stable (not by count) — an age axis reads oldest→youngest
  // poorly when sorted by popularity.
  dist.rows.sort(
    (a, b) => AGE_BANDS.indexOf(a.label as AgeBand) - AGE_BANDS.indexOf(b.label as AgeBand),
  );
  return dist;
}

export interface SegmentSpend {
  label: string;
  orders: number;
  revenue: number;
  aov: number;
}

export function spendBySegment(
  orders: AnalyticsOrder[],
  key: "race" | "gender",
): SegmentSpend[] {
  const bySeg = new Map<string, SegmentSpend>();
  for (const o of orders) {
    const label = o[key];
    if (!label) continue;
    const seg = bySeg.get(label) ?? { label, orders: 0, revenue: 0, aov: 0 };
    seg.orders += 1;
    seg.revenue += o.revenue;
    bySeg.set(label, seg);
  }
  const out = [...bySeg.values()];
  for (const seg of out) seg.aov = seg.orders > 0 ? seg.revenue / seg.orders : 0;
  return out.sort((a, b) => b.revenue - a.revenue);
}

// ── Products ────────────────────────────────────────────────────────────────

/** Buyer demographics per category — one distribution trio per category. */
export function buyerDemographics(
  lines: AnalyticsLine[],
  at: Date,
): Array<{ category: string; race: Distribution; gender: Distribution; age: Distribution }> {
  const byCat = new Map<string, AnalyticsLine[]>();
  for (const l of lines) {
    const bucket = byCat.get(l.category) ?? [];
    bucket.push(l);
    byCat.set(l.category, bucket);
  }
  return [...byCat.entries()].map(([category, ls]) => ({
    category,
    race: distributionOf(ls.map((l) => l.race)),
    gender: distributionOf(ls.map((l) => l.gender)),
    age: (() => {
      const dist = distributionOf(ls.map((l) => ageBandOf(l.birthday, at)));
      dist.rows.sort(
        (a, b) => AGE_BANDS.indexOf(a.label as AgeBand) - AGE_BANDS.indexOf(b.label as AgeBand),
      );
      return dist;
    })(),
  }));
}

/* ── Product Profit (Houzs Finance › Reports › Product Profit, owner 2026-10-05) ──
 * One row per model. A price-0 line of a model the same order also sells is part
 * of that product (its cost is the product's own); any other price-0 line is a
 * GIFT, and an order's gifts are shared among the products it paid for by their
 * sales, in whole sen. Whether gifts count is the screen's switch. */

export type ProfitSort = "gp" | "units" | "sales" | "margin";

export interface ProfitRow {
  model: string;
  category: string;
  units: number;
  orders: number;
  sales: number;
  /** The product's own cost; lines with no cost add nothing (see noCostLines). */
  cost: number;
  /** Its share of the gifts on the orders that bought it. */
  gift: number;
  gp: number;
  marginPct: number | null;
  /** Priced lines with no cost on the SKU — the margin reads high. */
  noCostLines: number;
}

/** The month (YYYY-MM) of a placed_at instant, in Malaysia time. */
export const myMonthOf = (iso: string): string =>
  new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 7);

/** Share whole sen by weight, largest remainder first, so the shares add back exactly. */
export function shareSen(totalSen: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (totalSen === 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalSen * Math.max(0, w)) / sum);
  const out = raw.map(Math.floor);
  let left = totalSen - out.reduce((a, v) => a + v, 0);
  const order = raw.map((r, i) => ({ f: r - Math.floor(r), i })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k].i] += 1;
  return out;
}

export function productProfit(
  lines: AnalyticsLine[],
  opts: { month: string | null; categories: ReadonlySet<string>; gifts: boolean; sort: ProfitSort },
): { rows: ProfitRow[]; unallocatedGift: number } {
  const sen = (rm: number) => Math.round(rm * 100);
  const byOrder = new Map<number, AnalyticsLine[]>();
  for (const l of lines) {
    if (opts.month && myMonthOf(l.placedAt) !== opts.month) continue;
    byOrder.set(l.so, [...(byOrder.get(l.so) ?? []), l]);
  }
  const acc = new Map<string, ProfitRow & { so: Set<number> }>();
  const rowOf = (l: AnalyticsLine) => {
    const r = acc.get(l.model) ?? { model: l.model, category: l.category, units: 0, orders: 0, sales: 0, cost: 0, gift: 0, gp: 0, marginPct: null, noCostLines: 0, so: new Set<number>() };
    acc.set(l.model, r);
    return r;
  };
  let unallocated = 0;
  for (const [so, ls] of byOrder) {
    const sold = new Set(ls.filter((l) => l.revenue > 0).map((l) => l.model));
    let giftSen = 0;
    const paid = new Map<string, number>();
    for (const l of ls) {
      if (l.revenue <= 0 && !sold.has(l.model)) { giftSen += sen(l.cost ?? 0); continue; }
      const r = rowOf(l);
      r.so.add(so);
      if (l.revenue > 0) { r.units += l.qty; paid.set(l.model, (paid.get(l.model) ?? 0) + sen(l.revenue)); }
      r.sales += l.revenue;
      if (l.cost === null) { if (l.revenue > 0) r.noCostLines += 1; } else r.cost += l.cost;
    }
    const models = [...paid.keys()];
    if (models.length === 0) { unallocated += giftSen / 100; continue; }
    shareSen(giftSen, models.map((m) => paid.get(m)!)).forEach((s, i) => { acc.get(models[i])!.gift += s / 100; });
  }
  const rows = [...acc.values()]
    .filter((r) => opts.categories.size === 0 || opts.categories.has(r.category))
    .map(({ so, ...r }) => {
      const gp = r.sales - r.cost - (opts.gifts ? r.gift : 0);
      return { ...r, orders: so.size, gp, marginPct: r.sales > 0 ? (gp / r.sales) * 100 : null };
    });
  const key: Record<ProfitSort, (r: ProfitRow) => number> = {
    gp: (r) => r.gp, units: (r) => r.units, sales: (r) => r.sales, margin: (r) => r.marginPct ?? -Infinity,
  };
  return { rows: rows.sort((a, b) => key[opts.sort](b) - key[opts.sort](a) || a.model.localeCompare(b.model)), unallocatedGift: unallocated };
}
