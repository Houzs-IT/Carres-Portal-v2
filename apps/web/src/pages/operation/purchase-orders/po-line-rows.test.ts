import { describe, expect, it } from "vitest";
import { poLineRowsOf } from "./po-line-rows";

describe("poLineRowsOf", () => {
  it("gives one row per line and works out what is pending", () => {
    const rows = poLineRowsOf([{
      id: "PO-1", facts: { version: 1 },
      po: { promises: [], purchase_order_lines: [
        { id: "a", qty: 5, received_qty: 2, cancelled_qty: 1 },
        { id: "b", qty: 3, received_qty: 3 },
      ] },
    }]);
    expect(rows.map((r) => [r.key, r.row.id, r.pendingQty, r.supplierDates])).toEqual([["a", "PO-1", 2, []], ["b", "PO-1", 0, []]]);
  });
  it("a PO with no line read gives no rows", () => {
    expect(poLineRowsOf([{ id: "PO-2", facts: { version: 1 }, po: {} }])).toEqual([]);
  });
});
