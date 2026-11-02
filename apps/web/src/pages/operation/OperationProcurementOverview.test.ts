import { describe, expect, it } from "vitest";
import { billedIn, breakdownOf, drillPos, latenessOf, leadTimesOf, openLinesOf, stockRowsOf } from "./OperationProcurementOverview";

const po = (id: string, date: string | null, qty: number, received: number, status = "open") => ({
  id, status, eta_date: date, suppliers: { name: "Ohana" }, purchase_order_lines: [{ sku: "S1", qty, received_qty: received }],
});

describe("Lead time & stock, Supplier billed and the drills", () => {
  const got = (id: string, placed: string, inAt: string, eta: string | null) => ({
    id, status: "received", supplier_id: "s1", suppliers: { name: "Ohana" }, placed_at: placed, do_uploaded_at: inAt, eta_date: eta,
    purchase_order_lines: [{ sku: "S1", qty: 1, received_qty: 1, category: "sofa" }],
  });
  it("counts days from PO to goods in, on time against the ETA, in the month the goods came in", () => {
    const rows = leadTimesOf([
      got("A", "2026-10-01T02:00:00Z", "2026-10-11T02:00:00Z", "2026-10-11"),
      got("B", "2026-10-01T02:00:00Z", "2026-10-21T02:00:00Z", "2026-10-11"),
      got("C", "2026-09-01T02:00:00Z", "2026-09-02T02:00:00Z", null),
    ], "supplier", "2026-10");
    expect(rows).toEqual([{ key: "s1", label: "Ohana", receipts: 2, avgDays: 15, midDays: 10, onTimePct: 50, avgLate: 10 }]);
  });
  it("files a receipt stamped 9pm UTC under the next MYT day", () => {
    expect(leadTimesOf([got("A", "2026-10-01T02:00:00Z", "2026-10-31T21:00:00Z", null)], "category", "2026-11")[0].receipts).toBe(1);
  });
  it("splits stock into for an order and for no order, and counts 90+ days only on the latter", () => {
    const unit = (availability: string, qty: number, dateIn: string | null) => ({ availability, qty, dateIn, siteName: "Klang", category: "sofa" }) as never;
    const [row] = stockRowsOf([unit("available", 2, "2026-01-01"), unit("available", 1, "2026-10-30"), unit("reserved", 4, "2026-01-01"), unit("incoming", 9, null)], "warehouse", "2026-11-01");
    expect(row).toMatchObject({ label: "Klang", forOrder: 4, forNoOrder: 3, idle90: 2 });
  });
  it("Supplier billed leaves cancelled bills out and follows the month", () => {
    const bill = (id: string, status: string, bill_date: string) => ({ id, bill_no: id, status, supplier_name: "", bill_date, total_amount: 1 });
    expect(billedIn([bill("a", "confirmed", "2026-10-02"), bill("b", "cancelled", "2026-10-02"), bill("c", "draft", "2026-09-02")], "2026-10").map((r) => r.id)).toEqual(["a"]);
  });
  it("a drill lists the POs its tile added up, one row per PO", () => {
    const base = { supplierId: "s1", supplierName: "Ohana", month: "2026-11", category: "sofa", cancelled: false };
    expect(drillPos([{ ...base, poId: "A", ordered: 2, received: 1 }, { ...base, poId: "A", ordered: 3, received: 0 }, { ...base, poId: "B", ordered: 1, received: 0, cancelled: true }], () => true))
      .toMatchObject([{ poId: "A", ordered: 5, received: 1 }]);
  });
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
