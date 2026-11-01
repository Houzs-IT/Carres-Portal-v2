import { describe, expect, it } from "vitest";
import { breakdownOf, latenessOf, openLinesOf } from "./OperationProcurementOverview";

const po = (id: string, date: string | null, qty: number, received: number, status = "open") => ({
  id, status, eta_date: date, suppliers: { name: "Ohana" }, purchase_order_lines: [{ sku: "S1", qty, received_qty: received }],
});

describe("Procurement Overview figures", () => {
  it("keeps only goods still to come on POs that are not cancelled", () => {
    const lines = openLinesOf([po("A", "2026-11-01", 5, 2), po("B", "2026-11-01", 5, 5), po("C", "2026-11-01", 5, 0, "cancelled")], "2026-11-03");
    expect(lines).toEqual([{ poId: "A", supplier: "Ohana", sku: "S1", pending: 3, date: "2026-11-01", daysLate: 2 }]);
  });

  it("the official date beats the ETA", () => {
    const [line] = openLinesOf([{ ...po("A", "2026-11-01", 1, 0), official_delivery_date: "2026-11-10" }], "2026-11-03");
    expect(line.date).toBe("2026-11-10");
  });

  it("sorts Units into the four Houzs lateness buckets, at each edge", () => {
    const line = (daysLate: number | null, pending = 1) => ({ poId: "A", supplier: "", sku: "", pending, date: null, daysLate });
    const qty = latenessOf([line(5), line(4), line(-1), line(-2), line(-7), line(-8), line(null)]).map((b) => b.qty);
    expect(qty).toEqual([1, 2, 2, 1]);
  });

  it("breaks down by supplier and leaves cancelled lines out", () => {
    const base = { supplierId: "s1", supplierName: "Ohana", month: "2026-11", category: "sofa", cancelled: false };
    const rows = breakdownOf([
      { ...base, poId: "A", ordered: 5, received: 2 },
      { ...base, poId: "B", ordered: 1, received: 0 },
      { ...base, poId: "C", ordered: 9, received: 0, cancelled: true },
    ], "supplier");
    expect(rows).toHaveLength(1);
    expect([rows[0].label, rows[0].pos.size, rows[0].ordered, rows[0].received]).toEqual(["Ohana", 2, 6, 2]);
  });
});
