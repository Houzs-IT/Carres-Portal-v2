/** Projects slice 5 (0754): the fair's money follows Houzs event-books.ts and eventPnl.ts. */
import { describe, expect, it } from "vitest";
import { applyBooks, projectCategoryLabel, projectPnl, rowOfLeg, type BooksLeg, type MoneyLine } from "./project-money";

const typed = (category: string, amount: number, kind: "cost" | "income" = "cost"): MoneyLine =>
  ({ id: `t-${category}-${amount}`, kind, category, description: category, amount, occurredAt: null, source: null });
const leg = (over: Partial<BooksLeg>): BooksLeg => ({
  legId: "l1", accountCode: "900-R001", accountName: "Booth rental", accountKind: "EXPENSE", projectRow: "rental",
  debit: 0, credit: 0, memo: null, docNo: "PV-1", entryDate: "2026-12-01", checked: false, ...over,
});

describe("the books on a project", () => {
  it("a row the books pay replaces that row's typed lines, never both", () => {
    const r = applyBooks([typed("rental", 5000), typed("setup", 800)], [leg({ debit: 4800 })]);
    expect(r.rows).toEqual(["rental"]);
    expect(r.replaced.map((l) => l.category)).toEqual(["rental"]);
    expect(r.lines.filter((l) => l.category === "rental").map((l) => l.amount)).toEqual([4800]);
  });

  it("money only coming back on a summed row is taken off, the typed figure stays", () => {
    const r = applyBooks([typed("rental", 45900)], [leg({ credit: 22950 })]);
    expect(r.rows).toEqual([]);
    expect(r.lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([-22950, 45900]);
  });

  it("an expense account with no row fills Others Costing; any other kind is not a cost", () => {
    expect(rowOfLeg({ projectRow: null, accountKind: "EXPENSE" })).toBe("others");
    expect(rowOfLeg({ projectRow: null, accountKind: "ASSET" })).toBeNull();
  });

  it("a checked voucher says so on its document number", () => {
    const r = applyBooks([], [leg({ debit: 100, checked: true, docNo: "PV-9" })]);
    expect(r.lines[0]?.docNo).toBe("PV-9 (checked)");
  });

  it("no category label carries a dash", () => {
    expect(projectCategoryLabel("cogs_matt_sofa")).toBe("COGS · Matt/Sofa");
    expect(projectCategoryLabel("misc")).toBe("Misc");
  });
});

describe("the two P&Ls", () => {
  const rate = { transportPct: 3, merchandisePct: 1, commissionNormalPct: 5, commissionBoostPct: 7, boostMinGpPct: 40, boostMinSales: null };

  it("by Total Sales reads the box; the % rows come from the brand's rate card", () => {
    const p = projectPnl({ lines: [typed("rental", 1000), typed("cogs", 4000)], booksRows: new Set(), lumpSales: 10000, so: null, rate });
    expect(p.bySales.salesFrom).toBe("box");
    expect(p.bySales.transportFee).toEqual({ amount: 300, from: "rate", pct: 3 });
    // GP 60% ≥ 40%: the boost rate.
    expect(p.bySales.commission).toMatchObject({ amount: 700, from: "rate", boost: true });
    expect(p.bySales.totalCost).toBe(4000 + 1000 + 300 + 700 + 100);
    expect(p.bySales.netProfit).toBe(10000 - 6100);
    expect(p.bySo).toBeNull();
  });

  it("a % row the books fill is Finance's figure, not the rate card", () => {
    const books: MoneyLine = { ...typed("transport_fee", 250), id: "b", source: "books" };
    const p = projectPnl({ lines: [books], booksRows: new Set(["transport_fee"]), lumpSales: 10000, so: null, rate });
    expect(p.bySales.transportFee).toEqual({ amount: 250, from: "books", pct: null });
  });

  it("with no box and no sales lines, sales are the orders' total, and By Sales Orders shows", () => {
    const p = projectPnl({ lines: [], booksRows: new Set(), lumpSales: null, so: { count: 2, salesRm: 3000.1 }, rate: null });
    expect(p.bySales).toMatchObject({ sales: 3000.1, salesFrom: "so" });
    expect(p.bySo?.sales).toBe(3000.1);
    expect(p.soCount).toBe(2);
  });
});
