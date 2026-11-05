import { describe, it, expect } from "vitest";
import {
  ageBandOf,
  ageOf,
  buyerDemographics,
  genderDistribution,
  monthlyRevenue,
  raceDistribution,
  spendBySegment,
  summarizeOverview,
  productProfit,
  shareSen,
  type AnalyticsLine,
  type AnalyticsOrder,
} from "./sales-analysis";

const AT = new Date("2026-07-03T00:00:00Z");

function order(over: Partial<AnalyticsOrder> = {}): AnalyticsOrder {
  return {
    so: 1301,
    placedAt: "2026-06-15T10:00:00Z",
    channel: "dealer",
    revenue: 1000,
    deliveryFee: 0,
    paid: 0,
    cogs: null,
    race: null,
    gender: null,
    birthday: null,
    ...over,
  };
}

function line(over: Partial<AnalyticsLine> = {}): AnalyticsLine {
  return {
    so: 1301,
    placedAt: "2026-06-15T10:00:00Z",
    sku: "CLOUD-QUEEN",
    model: "Carres Cloud",
    category: "mattress",
    qty: 1,
    revenue: 1000,
    cost: null,
    race: null,
    gender: null,
    birthday: null,
    ...over,
  };
}

describe("ageOf / ageBandOf", () => {
  it("computes precise age, respecting whether the birthday has passed", () => {
    expect(ageOf("1990-07-03", AT)).toBe(36); // birthday today → already turned
    expect(ageOf("1990-07-04", AT)).toBe(35); // tomorrow → not yet
  });
  it("bands correctly and returns null for missing/garbage", () => {
    expect(ageBandOf("2005-01-01", AT)).toBe("<25");
    expect(ageBandOf("1995-01-01", AT)).toBe("25 to 34");
    expect(ageBandOf("1985-01-01", AT)).toBe("35 to 44");
    expect(ageBandOf("1975-01-01", AT)).toBe("45 to 54");
    expect(ageBandOf("1960-01-01", AT)).toBe("55+");
    expect(ageBandOf(null, AT)).toBeNull();
    expect(ageBandOf("not-a-date", AT)).toBeNull();
  });
});

describe("summarizeOverview", () => {
  it("computes orders / revenue / AOV / delivery / margin over cogs-complete orders only", () => {
    const kpis = summarizeOverview([
      order({ revenue: 1000, deliveryFee: 100, cogs: 600 }),
      order({ revenue: 3000, deliveryFee: 0, cogs: null }), // no cost → excluded from margin
    ]);
    expect(kpis.orders).toBe(2);
    expect(kpis.revenue).toBe(4000);
    expect(kpis.aov).toBe(2000);
    expect(kpis.avgDeliveryFee).toBe(50);
    expect(kpis.cogsCompleteOrders).toBe(1);
    expect(kpis.grossMarginPct).toBeCloseTo(40); // (1000-600)/1000
  });
  it("empty set → zeros + null margin", () => {
    const kpis = summarizeOverview([]);
    expect(kpis.orders).toBe(0);
    expect(kpis.grossMarginPct).toBeNull();
  });
});

describe("monthlyRevenue", () => {
  it("groups by placed month, sorted ascending", () => {
    const bars = monthlyRevenue([
      order({ placedAt: "2026-05-01T00:00:00Z", revenue: 100 }),
      order({ placedAt: "2026-06-15T00:00:00Z", revenue: 200 }),
      order({ placedAt: "2026-06-20T00:00:00Z", revenue: 50 }),
    ]);
    expect(bars.map((b) => b.key)).toEqual(["2026-05", "2026-06"]);
    expect(bars[1]).toMatchObject({ revenue: 250, orders: 2 });
  });
});

describe("distributions + segments", () => {
  const orders = [
    order({ race: "Chinese", gender: "Female", birthday: "1990-01-01", revenue: 1000 }),
    order({ race: "Chinese", gender: "Male", birthday: "1960-01-01", revenue: 3000 }),
    order({ race: "Malay", gender: "Female", birthday: null, revenue: 2000 }),
    order({ race: null, gender: null, birthday: null, revenue: 500 }), // pre-0200 row
  ];
  it("race distribution uses only rows that carry the field", () => {
    const d = raceDistribution(orders);
    expect(d.total).toBe(4);
    expect(d.known).toBe(3);
    expect(d.rows[0]).toMatchObject({ label: "Chinese", count: 2 });
    expect(d.rows[0].pct).toBeCloseTo((2 / 3) * 100);
  });
  it("gender distribution mirrors", () => {
    expect(genderDistribution(orders).rows[0]).toMatchObject({ label: "Female", count: 2 });
  });
  it("spendBySegment ranks by revenue with AOV", () => {
    const segs = spendBySegment(orders, "race");
    expect(segs[0]).toMatchObject({ label: "Chinese", orders: 2, revenue: 4000, aov: 2000 });
    expect(segs[1]).toMatchObject({ label: "Malay", revenue: 2000 });
  });
});

describe("buyerDemographics", () => {
  it("buyerDemographics groups distributions per category", () => {
    const demo = buyerDemographics(
      [
        line({ race: "Chinese", gender: "Female", birthday: "1990-01-01" }),
        line({ race: "Malay", gender: "Female", birthday: "1995-01-01" }),
      ],
      AT,
    );
    expect(demo).toHaveLength(1);
    expect(demo[0].category).toBe("mattress");
    expect(demo[0].gender.rows[0]).toMatchObject({ label: "Female", count: 2 });
  });
});

describe("productProfit (Houzs Product Profit)", () => {
  const line = (so: number, model: string, revenue: number, cost: number | null, over: Partial<AnalyticsLine> = {}): AnalyticsLine => ({
    so, placedAt: "2026-10-10T02:00:00Z", sku: model, model, category: "mattress", qty: 1, revenue, cost,
    race: null, gender: null, birthday: null, ...over,
  });
  const all = { month: null, categories: new Set<string>(), gifts: true, sort: "gp" as const };

  it("shares an order's gifts among its paid products by sales and takes them off gross profit", () => {
    const { rows } = productProfit([
      line(1, "A", 300, 100), line(1, "B", 100, 50), line(1, "Pillow", 0, 40, { category: "other" }),
    ], all);
    const a = rows.find((r) => r.model === "A")!;
    const b = rows.find((r) => r.model === "B")!;
    expect(a.gift).toBe(30);
    expect(b.gift).toBe(10);
    expect(a.gp).toBe(170);
    expect(rows.some((r) => r.model === "Pillow")).toBe(false);
  });

  it("keeps a price-0 line of a model the order also sells as that product's own cost", () => {
    const { rows } = productProfit([line(1, "Sofa", 1000, 400), line(1, "Sofa", 0, 100)], all);
    expect(rows[0]).toMatchObject({ units: 1, cost: 500, gift: 0, gp: 500 });
  });

  it("leaves gifts out when switched off, filters month and category, and counts no-cost lines", () => {
    const ls = [line(1, "A", 300, 100), line(1, "G", 0, 30), line(2, "C", 500, null, { category: "sofa", placedAt: "2026-09-30T17:00:00Z" })];
    expect(productProfit(ls, { ...all, gifts: false }).rows.find((r) => r.model === "A")!.gp).toBe(200);
    expect(productProfit(ls, { ...all, month: "2026-09" }).rows.map((r) => r.model)).toEqual([]);
    const oct = productProfit(ls, { ...all, month: "2026-10" }).rows;
    expect(oct.map((r) => r.model)).toEqual(["C", "A"]);
    expect(oct.find((r) => r.model === "C")!.noCostLines).toBe(1);
    expect(productProfit(ls, { ...all, categories: new Set(["sofa"]) }).rows.map((r) => r.model)).toEqual(["C"]);
  });

  it("reports gifts on an order that paid for no product as unallocated", () => {
    expect(productProfit([line(1, "G", 0, 25)], all).unallocatedGift).toBe(25);
  });

  it("shareSen adds back to the total", () => {
    expect(shareSen(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});
