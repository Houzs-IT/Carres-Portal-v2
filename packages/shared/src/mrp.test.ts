import { describe, expect, it } from "vitest";
import { buildMrpLines, mrpExportSheets, mrpRows, type MrpSourceLine } from "./mrp";
import { buildToOrder, type ToOrderLine } from "./to-order";

const src = (over: Partial<MrpSourceLine> = {}): MrpSourceLine => ({
  lineId: "L1",
  orderId: "O1",
  so: 101,
  customer: "TEST",
  sku: "SKU-A",
  model: "Haven",
  variant: "King",
  category: "mattress",
  supplierName: "Test Supplier",
  delivery: "2026-11-20",
  placedAt: "2026-10-01",
  needed: 1,
  heldInStock: 0,
  heldOnPo: 0,
  ...over,
});

const ALL = { category: null, month: null, shortagesOnly: false };
const TODAY = "2026-10-30";

describe("the four MRP numbers", () => {
  it("Needed less In Stock less On PO is Shortage", () => {
    const lines = buildMrpLines([src({ needed: 10, heldInStock: 2, heldOnPo: 1 })], { "SKU-A": 3 }, TODAY);
    expect(mrpRows(lines, {}, ALL)[0]).toMatchObject({
      needed: 10, inStock: 2, onPo: 4, shortage: 4,
    });
  });

  it("an open PO bigger than the need leaves no Shortage and On PO stops at the need", () => {
    const lines = buildMrpLines([src({ needed: 2 })], { "SKU-A": 9 }, TODAY);
    expect(mrpRows(lines, {}, ALL)[0]).toMatchObject({ onPo: 2, shortage: 0 });
  });

  it("Free Stock is shown and does not lower Shortage", () => {
    const lines = buildMrpLines([src({ needed: 5 })], {}, TODAY);
    expect(mrpRows(lines, { "SKU-A": 5 }, ALL)[0]).toMatchObject({ freeStock: 5, shortage: 5 });
  });

  it("one open PO covers the earliest delivery once, never two orders", () => {
    const lines = buildMrpLines(
      [
        src({ lineId: "late", orderId: "O2", delivery: "2026-12-01", needed: 2 }),
        src({ lineId: "soon", orderId: "O1", delivery: "2026-11-01", needed: 2 }),
      ],
      { "SKU-A": 3 },
      TODAY,
    );
    expect(lines.find((l) => l.lineId === "soon")).toMatchObject({ onPo: 2, shortage: 0 });
    expect(lines.find((l) => l.lineId === "late")).toMatchObject({ onPo: 1, shortage: 1 });
    expect(mrpRows(lines, {}, ALL)[0]).toMatchObject({ needed: 4, onPo: 3, shortage: 1 });
  });

  it("a filter never moves PO cover between orders", () => {
    const lines = buildMrpLines(
      [
        src({ lineId: "nov", delivery: "2026-11-01", needed: 2 }),
        src({ lineId: "dec", delivery: "2026-12-01", needed: 2 }),
      ],
      { "SKU-A": 2 },
      TODAY,
    );
    expect(mrpRows(lines, {}, { ...ALL, month: "2026-12" })[0]).toMatchObject({ needed: 2, onPo: 0, shortage: 2 });
  });

  it("a line with no delivery date still counts and has its own filter", () => {
    const lines = buildMrpLines([src({ delivery: null, needed: 3 })], {}, TODAY);
    expect(mrpRows(lines, {}, { ...ALL, month: "none" })[0]).toMatchObject({ shortage: 3 });
  });

  it("Shortages hides a covered item, and the biggest Shortage comes first", () => {
    const lines = buildMrpLines(
      [
        src({ lineId: "a", sku: "SKU-A", needed: 1 }),
        src({ lineId: "b", sku: "SKU-B", needed: 4 }),
        src({ lineId: "c", sku: "SKU-C", needed: 1, heldInStock: 1 }),
      ],
      {},
      TODAY,
    );
    expect(mrpRows(lines, {}, { ...ALL, shortagesOnly: true }).map((r) => r.sku)).toEqual(["SKU-B", "SKU-A"]);
  });

  it("Shortage is the same number SO Batch Purchase has left to buy", () => {
    const sources = [
      src({ lineId: "a", needed: 3 }),
      src({ lineId: "b", orderId: "O2", needed: 2, delivery: "2026-12-01" }),
    ];
    const openPoBySku = { "SKU-A": 4 };
    const toOrderLines: ToOrderLine[] = sources.map((s) => ({
      lineId: s.lineId, orderId: s.orderId, sku: s.sku, category: s.category, supplierId: "S",
      qty: s.needed, deadline: s.delivery, leadDays: 0, placedAt: s.placedAt, committed: true,
      so: s.so, customerName: s.customer, modelName: s.model, variant: s.variant, variantKind: "size",
      buildKey: null, fabricName: null, legHeight: null, itemHeight: null, cost: null,
    }));
    const toBuy = buildToOrder({
      lines: toOrderLines, suppliers: [{ id: "S", name: "S" }],
      supply: { openPoBySku }, options: { today: TODAY },
    }).flatMap((p) => p.rows).flatMap((r) => r.builds).filter((b) => !b.fullyOnPo)
      .reduce((n, b) => n + b.qty, 0);
    expect(mrpRows(buildMrpLines(sources, openPoBySku, TODAY), {}, ALL)[0].shortage).toBe(toBuy);
    expect(toBuy).toBe(1);
  });
});

describe("mrpExportSheets", () => {
  it("prints one row per SKU and one per line, with the line's PO and ETA", () => {
    const lines = buildMrpLines([src({ needed: 2, warehouse: "Klang" })], { "SKU-A": 1 }, TODAY, {
      refs: { "SKU-A": [{ poId: "PO-1", qty: 1 }] }, eta: { "PO-1": "2026-11-05" },
    });
    const sheets = mrpExportSheets(mrpRows(lines, { "SKU-A": 3 }, ALL), (d) => d);
    expect(sheets.items[1]).toEqual(["Klang", "SKU-A", "Haven King", "Mattress", "Test Supplier", 2, 0, 1, 1, 3]);
    expect(sheets.lines[1].at(-1)).toBe("PO-1 · 1 · ETA 2026-11-05");
  });
});

describe("per-line PO cover", () => {
  it("names the POs in the engine's draw order, earliest delivery first", () => {
    const lines = buildMrpLines(
      [
        src({ lineId: "late", orderId: "O2", delivery: "2026-12-01", needed: 2 }),
        src({ lineId: "soon", orderId: "O1", delivery: "2026-11-01", needed: 2 }),
      ],
      { "SKU-A": 3 },
      TODAY,
      { refs: { "SKU-A": [{ poId: "PO-1", qty: 1 }, { poId: "PO-2", qty: 2 }] }, eta: { "PO-1": "2026-11-05", "PO-2": null } },
    );
    expect(lines.find((l) => l.lineId === "soon")?.poCover).toEqual([
      { poId: "PO-1", qty: 1, eta: "2026-11-05" }, { poId: "PO-2", qty: 1, eta: null },
    ]);
    expect(lines.find((l) => l.lineId === "late")?.poCover).toEqual([{ poId: "PO-2", qty: 1, eta: null }]);
  });

  it("names a reserved PO first, and its cover always adds up to On PO", () => {
    const [line] = buildMrpLines(
      [src({ needed: 5, heldOnPo: 2, poHeld: [{ poId: "PO-9", qty: 2 }] })],
      { "SKU-A": 1 }, TODAY, { refs: { "SKU-A": [{ poId: "PO-1", qty: 1 }] } },
    );
    expect(line.poCover?.map((p) => p.poId)).toEqual(["PO-9", "PO-1"]);
    expect(line.poCover?.reduce((n, p) => n + p.qty, 0)).toBe(line.onPo);
  });
});

describe("warehouse and date filters", () => {
  const lines = buildMrpLines(
    [
      src({ lineId: "a", warehouse: "Klang", soDate: "2026-10-01", needed: 2 }),
      src({ lineId: "b", warehouse: null, soDate: null, needed: 3 }),
    ],
    {}, TODAY,
  );
  it("filters by warehouse, and `none` finds the line with none", () => {
    expect(mrpRows(lines, {}, { ...ALL, warehouse: "Klang" })[0]).toMatchObject({ needed: 2, warehouses: ["Klang"] });
    expect(mrpRows(lines, {}, { ...ALL, warehouse: "none" })[0].needed).toBe(3);
  });
  it("reads From and To on the chosen date, and a line with no such date is out", () => {
    expect(mrpRows(lines, {}, { ...ALL, basis: "so", from: "2026-10-01", to: "2026-10-01" })[0].needed).toBe(2);
    expect(mrpRows(lines, {}, { ...ALL, basis: "so", from: "2026-10-02" })).toEqual([]);
  });
});
